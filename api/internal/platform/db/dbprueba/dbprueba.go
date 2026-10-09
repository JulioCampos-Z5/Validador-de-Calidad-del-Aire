// Package dbprueba da a las pruebas una base MySQL propia y desechable, para
// los modulos que solo corren en MySQL (inventario y puertos).
//
// Necesita un usuario que pueda crear bases:
//
//	PRUEBAS_MYSQL_DSN="root:<contraseña>@tcp(127.0.0.1:3307)/" go test ./...
//
// Sin la variable, la prueba se salta. Cada prueba crea su base con un nombre
// unico, la migra y la borra al terminar: la de desarrollo no se toca.
package dbprueba

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"

	"validador-api/internal/platform/db"
)

const Variable = "PRUEBAS_MYSQL_DSN"

func MySQL(t testing.TB, prefijo string, migraciones fs.FS) *sql.DB {
	t.Helper()
	dsn := os.Getenv(Variable)
	if dsn == "" {
		t.Skipf("sin %s: se salta la prueba contra MySQL", Variable)
	}
	ctx := context.Background()
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		t.Fatal(err)
	}
	nombre := fmt.Sprintf("%s_prueba_%d", strings.ToLower(prefijo), time.Now().UnixNano())

	cfg.DBName = ""
	servidor, err := db.Abrir(ctx, cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := servidor.ExecContext(ctx, "CREATE DATABASE "+nombre+" CHARACTER SET utf8mb4"); err != nil {
		servidor.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = servidor.ExecContext(context.Background(), "DROP DATABASE "+nombre)
		servidor.Close()
	})

	cfg.DBName = nombre
	base, err := db.Abrir(ctx, cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { base.Close() })
	if err := db.Migrar(ctx, base, migraciones); err != nil {
		t.Fatal(err)
	}
	return base
}
