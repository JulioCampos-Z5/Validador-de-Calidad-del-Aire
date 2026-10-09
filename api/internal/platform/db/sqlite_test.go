package db

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/go-sql-driver/mysql"
)

// Ruta en una subcarpeta que no existe: Abrir la crea.
func abrirPrueba(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "sub", "base.sqlite")
}

func TestAbrirSQLiteCreaLaCarpeta(t *testing.T) {
	ruta := abrirPrueba(t)
	base, err := Abrir(context.Background(), PrefijoSQLite+ruta)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	if !EsSQLite(base) {
		t.Error("EsSQLite")
	}
	if _, err := os.Stat(ruta); err != nil {
		t.Errorf("el archivo deberia existir: %v", err)
	}
	var fk int
	if err := base.QueryRow("PRAGMA foreign_keys").Scan(&fk); err != nil || fk != 1 {
		t.Errorf("las llaves foraneas deben ir encendidas: %d %v", fk, err)
	}
}

func TestAbrirFalla(t *testing.T) {
	ctx := context.Background()
	if _, err := Abrir(ctx, PrefijoSQLite); err == nil {
		t.Error("SQLite sin ruta")
	}
	if _, err := Abrir(ctx, "esto no es un dsn"); err == nil || !strings.Contains(err.Error(), "DSN invalido") {
		t.Errorf("DSN de MySQL invalido: %v", err)
	}
	// Un MySQL donde no escucha nadie: falla con contexto, no se cuelga.
	ctx, cancelar := context.WithTimeout(ctx, 15*time.Second)
	defer cancelar()
	if _, err := Abrir(ctx, "u:p@tcp(127.0.0.1:1)/base?timeout=1s"); err == nil || !strings.Contains(err.Error(), "sin conexion") {
		t.Errorf("MySQL caido: %v", err)
	}
}

func TestMigrarSQLite(t *testing.T) {
	ctx := context.Background()
	ruta := abrirPrueba(t)
	base, err := Abrir(ctx, PrefijoSQLite+ruta)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()

	archivos := fstest.MapFS{
		"001.sql":        {Data: []byte("CREATE TABLE solo_mysql (id INT) ENGINE=InnoDB;")},
		"sqlite/002.sql": {Data: []byte("-- segunda\nCREATE TABLE b (id INTEGER PRIMARY KEY, n TEXT UNIQUE);")},
		"sqlite/001.sql": {Data: []byte("CREATE TABLE a (id INTEGER);\nINSERT INTO a VALUES (1);")},
	}
	if err := Migrar(ctx, base, archivos); err != nil {
		t.Fatal(err)
	}
	// Otra vez: ya estan anotadas y no se repiten (el INSERT no se duplica).
	if err := Migrar(ctx, base, archivos); err != nil {
		t.Fatal(err)
	}
	var filas, migradas int
	_ = base.QueryRow("SELECT COUNT(*) FROM a").Scan(&filas)
	_ = base.QueryRow("SELECT COUNT(*) FROM migraciones").Scan(&migradas)
	if filas != 1 || migradas != 2 {
		t.Errorf("filas = %d, migraciones = %d; quiero 1 y 2", filas, migradas)
	}
	var existe int
	_ = base.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE name = 'solo_mysql'").Scan(&existe)
	if existe != 0 {
		t.Error("en SQLite solo corren las de sqlite/")
	}

	// EsDuplicado reconoce la llave unica de SQLite.
	_, _ = base.Exec("INSERT INTO b (n) VALUES ('x')")
	_, err = base.Exec("INSERT INTO b (n) VALUES ('x')")
	if !EsDuplicado(err) {
		t.Errorf("duplicado en SQLite no reconocido: %v", err)
	}
}

func TestMigrarSinCarpetaSQLite(t *testing.T) {
	ctx := context.Background()
	ruta := abrirPrueba(t)
	base, _ := Abrir(ctx, PrefijoSQLite+ruta)
	defer base.Close()
	err := Migrar(ctx, base, fstest.MapFS{"001.sql": {Data: []byte("SELECT 1;")}})
	if err == nil || !strings.Contains(err.Error(), "no tiene migraciones para SQLite") {
		t.Errorf("modulo solo MySQL en SQLite: %v", err)
	}
}

func TestMigrarSentenciaRotaNoSeAnota(t *testing.T) {
	ctx := context.Background()
	ruta := abrirPrueba(t)
	base, _ := Abrir(ctx, PrefijoSQLite+ruta)
	defer base.Close()
	err := Migrar(ctx, base, fstest.MapFS{"sqlite/001.sql": {Data: []byte("CREATE TABLA mal;")}})
	if err == nil || !strings.Contains(err.Error(), "001.sql") {
		t.Fatalf("debe fallar nombrando el archivo: %v", err)
	}
	var n int
	_ = base.QueryRow("SELECT COUNT(*) FROM migraciones").Scan(&n)
	if n != 0 {
		t.Error("una migracion que fallo no se marca como aplicada")
	}
}

func TestEsDuplicado(t *testing.T) {
	if !EsDuplicado(&mysql.MySQLError{Number: 1062}) {
		t.Error("1062 de MySQL")
	}
	if EsDuplicado(&mysql.MySQLError{Number: 1452}) || EsDuplicado(errors.New("otro")) || EsDuplicado(nil) {
		t.Error("solo los de llave unica")
	}
}

func TestSentenciasSinPuntoYComaFinal(t *testing.T) {
	got := sentencias("CREATE TABLE a (id INT);\nINSERT INTO a VALUES (1)")
	if len(got) != 2 || got[1] != "INSERT INTO a VALUES (1)" {
		t.Errorf("la ultima sin ';' tambien cuenta: %q", got)
	}
}
