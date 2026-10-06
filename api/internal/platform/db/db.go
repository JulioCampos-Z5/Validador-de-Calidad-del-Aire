// Package db abre las conexiones a MySQL y aplica las migraciones de cada
// modulo. Una conexion por base: cada modulo recibe solo la suya.
package db

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

// Abrir conecta y comprueba que la base responde. Fuerza parseTime y UTC sin
// importar lo que traiga el DSN: todo se guarda en UTC y solo se pasa a hora
// de Guadalajara al mostrarlo.
func Abrir(ctx context.Context, dsn string) (*sql.DB, error) {
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

// Migrar aplica en orden los .sql de archivos que aun no se hayan aplicado.
// Cada modulo trae sus migraciones embebidas, asi que encender un modulo
// nuevo crea sus tablas solo, sin tocar a los demas.
func Migrar(ctx context.Context, base *sql.DB, archivos fs.FS) error {
	if _, err := base.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS migraciones (
			archivo  VARCHAR(200) PRIMARY KEY,
			aplicada DATETIME(3) NOT NULL
		) ENGINE=InnoDB`); err != nil {
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
