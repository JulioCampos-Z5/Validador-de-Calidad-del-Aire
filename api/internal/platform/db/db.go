// Package db abre las conexiones (MySQL en el servidor, SQLite en la app de
// escritorio) y aplica las migraciones de cada modulo. Una conexion por base:
// cada modulo recibe solo la suya.
package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

// PrefijoSQLite marca un DSN de SQLite: "sqlite:C:/ruta/base.sqlite". La app
// de escritorio no tiene servidor de MySQL; cada modulo guarda en su archivo.
const PrefijoSQLite = "sqlite:"

// Abrir conecta y comprueba que la base responde. En MySQL fuerza parseTime y
// UTC sin importar lo que traiga el DSN: todo se guarda en UTC y solo se pasa
// a hora de Guadalajara al mostrarlo.
func Abrir(ctx context.Context, dsn string) (*sql.DB, error) {
	if ruta, ok := strings.CutPrefix(dsn, PrefijoSQLite); ok {
		return abrirSQLite(ctx, ruta)
	}
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		return nil, fmt.Errorf("DSN invalido: %w", err)
	}
	cfg.ParseTime = true
	cfg.Loc = time.UTC

	conector, err := mysql.NewConnector(cfg)
	if err != nil {
		return nil, err
	}
	base := sql.OpenDB(conector)
	base.SetMaxOpenConns(20)
	base.SetMaxIdleConns(5)
	base.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancelar := context.WithTimeout(ctx, 10*time.Second)
	defer cancelar()
	if err := base.PingContext(ctx); err != nil {
		base.Close()
		return nil, fmt.Errorf("sin conexion a %s: %w", cfg.DBName, err)
	}
	return base, nil
}

// abrirSQLite abre (o crea) el archivo. WAL deja leer mientras el sondeo
// escribe; busy_timeout espera en vez de fallar si otra escritura tiene el
// candado; y las llaves foraneas en SQLite vienen apagadas si no se piden.
// Las fechas se guardan como texto en UTC, que ordena igual que la fecha.
func abrirSQLite(ctx context.Context, ruta string) (*sql.DB, error) {
	if ruta == "" {
		return nil, fmt.Errorf("DSN de SQLite sin ruta")
	}
	if err := os.MkdirAll(filepath.Dir(ruta), 0o755); err != nil {
		return nil, fmt.Errorf("carpeta de la base: %w", err)
	}
	q := url.Values{}
	for _, p := range []string{"foreign_keys(1)", "journal_mode(WAL)", "busy_timeout(5000)", "synchronous(NORMAL)"} {
		q.Add("_pragma", p)
	}
	q.Set("_time_format", "sqlite")
	base, err := sql.Open("sqlite", "file:"+filepath.ToSlash(ruta)+"?"+q.Encode())
	if err != nil {
		return nil, err
	}
	// Un solo escritor a la vez es lo que SQLite admite de todas formas; con
	// una conexion no hay "database is locked" entre la API y el sondeo.
	base.SetMaxOpenConns(1)

	ctx, cancelar := context.WithTimeout(ctx, 10*time.Second)
	defer cancelar()
	if err := base.PingContext(ctx); err != nil {
		base.Close()
		return nil, fmt.Errorf("sin acceso a %s: %w", ruta, err)
	}
	return base, nil
}

// EsSQLite dice si la conexion es de SQLite: los repositorios lo usan para
// las pocas sentencias que cambian entre motores.
func EsSQLite(base *sql.DB) bool {
	_, ok := base.Driver().(*sqlite.Driver)
	return ok
}

// EsDuplicado: la insercion choco con una llave unica, en cualquiera de los dos motores.
func EsDuplicado(err error) bool {
	var em *mysql.MySQLError
	if errors.As(err, &em) {
		return em.Number == 1062
	}
	var es *sqlite.Error
	if errors.As(err, &es) {
		return es.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE || es.Code() == sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY
	}
	return false
}

// Migrar aplica en orden los .sql de archivos que aun no se hayan aplicado.
// Cada modulo trae sus migraciones embebidas, asi que encender un modulo
// nuevo crea sus tablas solo, sin tocar a los demas. Las de MySQL van en la
// raiz y las de SQLite en sqlite/: un modulo sin esa carpeta no corre en SQLite.
func Migrar(ctx context.Context, base *sql.DB, archivos fs.FS) error {
	tabla := `
		CREATE TABLE IF NOT EXISTS migraciones (
			archivo  VARCHAR(200) PRIMARY KEY,
			aplicada DATETIME(3) NOT NULL
		) ENGINE=InnoDB`
	if EsSQLite(base) {
		sub, err := fs.Sub(archivos, "sqlite")
		if err != nil {
			return err
		}
		if hay, _ := fs.Glob(sub, "*.sql"); len(hay) == 0 {
			return fmt.Errorf("este modulo no tiene migraciones para SQLite")
		}
		archivos = sub
		tabla = strings.TrimSuffix(strings.TrimSpace(tabla), "ENGINE=InnoDB")
	}
	if _, err := base.ExecContext(ctx, tabla); err != nil {
		return err
	}

	nombres, err := fs.Glob(archivos, "*.sql")
	if err != nil {
		return err
	}
	sort.Strings(nombres)

	for _, nombre := range nombres {
		var hecha int
		if err := base.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM migraciones WHERE archivo = ?`, nombre).Scan(&hecha); err != nil {
			return err
		}
		if hecha > 0 {
			continue
		}
		contenido, err := fs.ReadFile(archivos, nombre)
		if err != nil {
			return err
		}
		// MySQL hace commit implicito con cada CREATE TABLE, asi que una
		// transaccion no protege aqui: si algo falla a la mitad, la migracion
		// no se marca y hay que revisarla a mano.
		for _, sentencia := range sentencias(string(contenido)) {
			if _, err := base.ExecContext(ctx, sentencia); err != nil {
				return fmt.Errorf("%s: %w", nombre, err)
			}
		}
		if _, err := base.ExecContext(ctx,
			`INSERT INTO migraciones (archivo, aplicada) VALUES (?, ?)`, nombre, time.Now().UTC()); err != nil {
			return err
		}
		slog.Info("migracion aplicada", "archivo", nombre)
	}
	return nil
}

// sentencias parte un archivo SQL en sentencias: terminan en ";" al final de
// la linea. Las lineas de comentario "--" se descartan.
func sentencias(sql string) []string {
	var res []string
	var actual strings.Builder
	for _, linea := range strings.Split(sql, "\n") {
		t := strings.TrimSpace(linea)
		if t == "" || strings.HasPrefix(t, "--") {
			continue
		}
		actual.WriteString(linea)
		actual.WriteString("\n")
		if strings.HasSuffix(t, ";") {
			res = append(res, strings.TrimSpace(actual.String()))
			actual.Reset()
		}
	}
	if s := strings.TrimSpace(actual.String()); s != "" {
		res = append(res, s)
	}
	return res
}
