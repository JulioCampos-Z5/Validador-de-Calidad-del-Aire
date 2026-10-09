package usuarios

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"validador-api/internal/platform/auth"
	"validador-api/internal/platform/db"
)

// Los usuarios en SQLite (app de escritorio): migracion, alta, correo
// repetido, sesiones y bitacora con fechas.
func TestUsuariosEnSQLite(t *testing.T) {
	ctx := context.Background()
	base, err := db.Abrir(ctx, db.PrefijoSQLite+filepath.Join(t.TempDir(), "usuarios.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	if err := db.Migrar(ctx, base, Migraciones()); err != nil {
		t.Fatal(err)
	}
	// Una segunda vez no hace nada: la migracion ya quedo anotada.
	if err := db.Migrar(ctx, base, Migraciones()); err != nil {
		t.Fatal(err)
	}
	r := NewRepository(base)

	id, err := r.Crear(ctx, NuevoUsuario{Nombre: "Julio Campos", Correo: "julio@ejemplo.mx", Rol: "root"}, "hash")
	if err != nil || id == 0 {
		t.Fatalf("crear: id = %d, err = %v", id, err)
	}
	if _, err := r.Crear(ctx, NuevoUsuario{Nombre: "Otro", Correo: "julio@ejemplo.mx", Rol: "user"}, "h"); !errors.Is(err, ErrDuplicado) {
		t.Errorf("correo repetido: err = %v, quiero ErrDuplicado", err)
	}
	u, err := r.PorCorreo(ctx, "julio@ejemplo.mx")
	if err != nil || u == nil || u.Nombre != "Julio Campos" || u.Creado.IsZero() {
		t.Fatalf("por correo: %+v, err = %v", u, err)
	}

	ses, err := r.AbrirSesion(ctx, id, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := r.SesionActiva(ctx, ses); !ok || err != nil {
		t.Errorf("sesion recien abierta: activa = %v, err = %v", ok, err)
	}
	if err := r.CerrarSesion(ctx, ses, time.Now()); err != nil {
		t.Fatal(err)
	}
	if ok, _ := r.SesionActiva(ctx, ses); ok {
		t.Error("la sesion cerrada no debe seguir activa")
	}

	antes := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	_ = r.Anotar(ctx, &id, antes, "primero", map[string]any{"a": 1})
	_ = r.Anotar(ctx, &id, antes.Add(1500*time.Millisecond), "segundo", nil)
	regs, err := r.Bitacora(ctx, 10)
	if err != nil || len(regs) != 2 || regs[0].Accion != "segundo" {
		t.Fatalf("bitacora (mas reciente primero): %+v, err = %v", regs, err)
	}
	if !regs[1].Fecha.Equal(antes) || fmt.Sprintf("%s", regs[1].Detalle) != `{"a":1}` {
		t.Errorf("registro = %+v", regs[1])
	}
}

// El usuario principal de la app de escritorio: solo con la base vacia, una
// vez, desde un hash bcrypt, y con el se puede entrar.
func TestAsegurarInicial(t *testing.T) {
	ctx := context.Background()
	base, err := db.Abrir(ctx, db.PrefijoSQLite+filepath.Join(t.TempDir(), "usuarios.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	if err := db.Migrar(ctx, base, Migraciones()); err != nil {
		t.Fatal(err)
	}
	svc := NewService(NewRepository(base), auth.NuevoEmisor([]byte("una-llave-de-prueba-de-32-caracteres!!"), time.Hour))

	if err := svc.AsegurarInicial(ctx, "Julio", "julio@ejemplo.mx", "no-es-bcrypt"); err == nil {
		t.Error("un hash que no es bcrypt debe rechazarse")
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte("secreta-de-prueba"), bcrypt.MinCost)
	for i := 0; i < 2; i++ { // la segunda vez no hace nada
		if err := svc.AsegurarInicial(ctx, "Julio Campos", " Julio@Ejemplo.MX ", string(hash)); err != nil {
			t.Fatal(err)
		}
	}
	us, _ := svc.Listar(ctx)
	if len(us) != 1 || us[0].Rol != auth.Root || us[0].Correo != "julio@ejemplo.mx" {
		t.Fatalf("usuarios = %+v", us)
	}
	if _, err := svc.Entrar(ctx, Login{Correo: "julio@ejemplo.mx", Contrasena: "secreta-de-prueba"}, "127.0.0.1"); err != nil {
		t.Errorf("entrar con el usuario inicial: %v", err)
	}
}

// «Mantener la sesión iniciada»: el token dura más, pero sigue siendo una
// sesión de la base y «Salir» la corta antes de que venza.
func TestRecordarSesion(t *testing.T) {
	ctx := context.Background()
	base, err := db.Abrir(ctx, db.PrefijoSQLite+filepath.Join(t.TempDir(), "usuarios.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	if err := db.Migrar(ctx, base, Migraciones()); err != nil {
		t.Fatal(err)
	}
	emisor := auth.NuevoEmisor([]byte("una-llave-de-prueba-de-32-caracteres!!"), 12*time.Hour).ConRecordar(30 * 24 * time.Hour)
	svc := NewService(NewRepository(base), emisor)
	hash, _ := bcrypt.GenerateFromPassword([]byte("secreta-de-prueba"), bcrypt.MinCost)
	if err := svc.AsegurarInicial(ctx, "Julio", "julio@ejemplo.mx", string(hash)); err != nil {
		t.Fatal(err)
	}

	corta, err := svc.Entrar(ctx, Login{Correo: "julio@ejemplo.mx", Contrasena: "secreta-de-prueba"}, "")
	if err != nil {
		t.Fatal(err)
	}
	larga, err := svc.Entrar(ctx, Login{Correo: "julio@ejemplo.mx", Contrasena: "secreta-de-prueba", Recordar: true}, "")
	if err != nil {
		t.Fatal(err)
	}
	if d := time.Until(corta.Expira); d > 13*time.Hour || d < 11*time.Hour {
		t.Errorf("sin recordar vence en %v, quiero ~12 h", d)
	}
	if d := time.Until(larga.Expira); d < 29*24*time.Hour {
		t.Errorf("recordando vence en %v, quiero ~30 días", d)
	}

	ses, err := emisor.Verificar(ctx, larga.Token)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Salir(ctx, ses); err != nil {
		t.Fatal(err)
	}
	if _, err := emisor.Verificar(ctx, larga.Token); err == nil {
		t.Error("después de salir, el token recordado no debe servir")
	}
}
