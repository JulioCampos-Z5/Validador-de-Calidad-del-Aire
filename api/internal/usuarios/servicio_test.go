package usuarios

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"validador-api/internal/platform/auth"
	"validador-api/internal/platform/db"
)

const contrasena = "secreta-de-prueba"

type entorno struct {
	svc    *Service
	emisor *auth.Emisor
	mux    *http.ServeMux
	root   *Usuario
}

func nuevoEntorno(t *testing.T) *entorno {
	t.Helper()
	ctx := context.Background()
	base, err := db.Abrir(ctx, db.PrefijoSQLite+filepath.Join(t.TempDir(), "usuarios.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { base.Close() })
	if err := db.Migrar(ctx, base, Migraciones()); err != nil {
		t.Fatal(err)
	}
	emisor := auth.NuevoEmisor([]byte("una-llave-de-prueba-de-32-caracteres!!"), time.Hour)
	svc := NewService(NewRepository(base), emisor)
	root, err := svc.Crear(ctx, 0, NuevoUsuario{Nombre: "Root", Correo: "root@ejemplo.mx", Contrasena: contrasena, Rol: auth.Root})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	NewHandler(svc, emisor).Rutas(mux)
	return &entorno{svc: svc, emisor: emisor, mux: mux, root: root}
}

func (e *entorno) entrar(t *testing.T, correo string) string {
	t.Helper()
	r, err := e.svc.Entrar(context.Background(), Login{Correo: correo, Contrasena: contrasena}, "127.0.0.1")
	if err != nil {
		t.Fatalf("entrar %s: %v", correo, err)
	}
	return r.Token
}

func (e *entorno) pedir(metodo, ruta, cuerpo, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	e.mux.ServeHTTP(w, r)
	return w
}

func TestEntrar(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()

	// El correo se normaliza: mayusculas y espacios no importan.
	r, err := e.svc.Entrar(ctx, Login{Correo: "  ROOT@Ejemplo.mx ", Contrasena: contrasena}, "1.2.3.4")
	if err != nil || r.Token == "" || r.Usuario.Rol != auth.Root || !r.Expira.After(time.Now()) {
		t.Fatalf("entrar: %+v %v", r, err)
	}
	for nombre, l := range map[string]Login{
		"contraseña mala":    {Correo: "root@ejemplo.mx", Contrasena: "otra-contraseña"},
		"correo inexistente": {Correo: "nadie@ejemplo.mx", Contrasena: contrasena},
	} {
		if _, err := e.svc.Entrar(ctx, l, ""); !errors.Is(err, ErrCredenciales) {
			t.Errorf("%s: err = %v", nombre, err)
		}
	}
	regs, _ := e.svc.Bitacora(ctx, 0)
	var fallidos int
	for _, r := range regs {
		if r.Accion == "login_fallido" {
			fallidos++
		}
	}
	if fallidos != 2 {
		t.Errorf("login_fallido en bitacora = %d, quiero 2", fallidos)
	}
}

func TestCrearValida(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()
	casos := map[string]NuevoUsuario{
		"sin nombre":        {Nombre: " ", Correo: "a@b.mx", Contrasena: contrasena, Rol: auth.User},
		"correo invalido":   {Nombre: "A", Correo: "no-es-correo", Contrasena: contrasena, Rol: auth.User},
		"rol inventado":     {Nombre: "A", Correo: "a@b.mx", Contrasena: contrasena, Rol: "dios"},
		"contraseña corta":  {Nombre: "A", Correo: "a@b.mx", Contrasena: "corta", Rol: auth.User},
		"contraseña de +72": {Nombre: "A", Correo: "a@b.mx", Contrasena: strings.Repeat("x", 73), Rol: auth.User},
	}
	for nombre, n := range casos {
		if _, err := e.svc.Crear(ctx, 1, n); !errors.Is(err, ErrEntrada) {
			t.Errorf("%s: err = %v", nombre, err)
		}
	}
	if _, err := e.svc.Crear(ctx, 1, NuevoUsuario{Nombre: "Otro", Correo: "ROOT@ejemplo.mx", Contrasena: contrasena, Rol: auth.User}); !errors.Is(err, ErrDuplicado) {
		t.Errorf("correo repetido (sin importar mayusculas): %v", err)
	}
}

func TestActualizarCortaSesiones(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()
	tecnico, err := e.svc.Crear(ctx, e.root.ID, NuevoUsuario{Nombre: "Tec", Correo: "tec@ejemplo.mx", Contrasena: contrasena, Rol: auth.Tecnico})
	if err != nil {
		t.Fatal(err)
	}
	vivo := func(tok string) bool {
		_, err := e.emisor.Verificar(ctx, tok)
		return err == nil
	}

	tok := e.entrar(t, "tec@ejemplo.mx")
	nombre := "  Técnico  "
	u, err := e.svc.Actualizar(ctx, e.root.ID, tecnico.ID, Cambios{Nombre: &nombre})
	if err != nil || u.Nombre != "Técnico" || !vivo(tok) {
		t.Fatalf("cambiar el nombre no corta la sesion: %+v %v vivo=%v", u, err, vivo(tok))
	}

	rol := auth.User
	if _, err := e.svc.Actualizar(ctx, e.root.ID, tecnico.ID, Cambios{Rol: &rol}); err != nil || vivo(tok) {
		t.Errorf("cambiar el rol corta la sesion (el rol va en el token): err %v vivo=%v", err, vivo(tok))
	}

	tok = e.entrar(t, "tec@ejemplo.mx")
	nueva := "otra-contraseña-larga"
	if _, err := e.svc.Actualizar(ctx, e.root.ID, tecnico.ID, Cambios{Contrasena: &nueva}); err != nil || vivo(tok) {
		t.Errorf("cambiar la contraseña corta la sesion: err %v vivo=%v", err, vivo(tok))
	}
	if _, err := e.svc.Entrar(ctx, Login{Correo: "tec@ejemplo.mx", Contrasena: nueva}, ""); err != nil {
		t.Errorf("la contraseña nueva entra: %v", err)
	}

	inactivo := Inactivo
	if _, err := e.svc.Actualizar(ctx, e.root.ID, tecnico.ID, Cambios{Estatus: &inactivo}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Entrar(ctx, Login{Correo: "tec@ejemplo.mx", Contrasena: nueva}, ""); !errors.Is(err, ErrCredenciales) {
		t.Errorf("un usuario inactivo no entra: %v", err)
	}
}

func TestActualizarValida(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()
	vacio, rol, estatus, inactivo := "", auth.Rol("dios"), "borrado", Inactivo
	for nombre, c := range map[string]Cambios{
		"nombre vacio":     {Nombre: &vacio},
		"rol inventado":    {Rol: &rol},
		"estatus raro":     {Estatus: &estatus},
		"desactivarse":     {Estatus: &inactivo},
		"contraseña corta": {Contrasena: &vacio},
	} {
		if _, err := e.svc.Actualizar(ctx, e.root.ID, e.root.ID, c); !errors.Is(err, ErrEntrada) {
			t.Errorf("%s: err = %v", nombre, err)
		}
	}
	if _, err := e.svc.Actualizar(ctx, e.root.ID, 9999, Cambios{}); !errors.Is(err, ErrNoExiste) {
		t.Errorf("inexistente: %v", err)
	}
}

func TestSalirInvalidaElToken(t *testing.T) {
	e := nuevoEntorno(t)
	tok := e.entrar(t, "root@ejemplo.mx")
	if w := e.pedir("POST", "/api/auth/salir", "", tok); w.Code != http.StatusNoContent {
		t.Fatalf("salir: %d", w.Code)
	}
	if w := e.pedir("GET", "/api/auth/yo", "", tok); w.Code != http.StatusUnauthorized {
		t.Errorf("token tras salir: %d, quiero 401", w.Code)
	}
}

func TestRutas(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()
	if _, err := e.svc.Crear(ctx, e.root.ID, NuevoUsuario{Nombre: "Lectora", Correo: "user@ejemplo.mx", Contrasena: contrasena, Rol: auth.User}); err != nil {
		t.Fatal(err)
	}

	// Login por HTTP.
	w := e.pedir("POST", "/api/auth/login", `{"correo":"root@ejemplo.mx","contrasena":"`+contrasena+`"}`, "")
	var login RespuestaLogin
	if err := json.Unmarshal(w.Body.Bytes(), &login); w.Code != 200 || err != nil || login.Token == "" {
		t.Fatalf("login: %d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "hash") || strings.Contains(w.Body.String(), "$2a$") {
		t.Error("el hash de la contraseña no sale nunca")
	}
	if w := e.pedir("POST", "/api/auth/login", `{"correo":"root@ejemplo.mx","contrasena":"mala-mala-mala"}`, ""); w.Code != 401 {
		t.Errorf("login malo: %d", w.Code)
	}
	if w := e.pedir("POST", "/api/auth/login", `{"correo":`, ""); w.Code != 400 {
		t.Errorf("login con JSON roto: %d", w.Code)
	}

	root := login.Token
	user := e.entrar(t, "user@ejemplo.mx")

	if w := e.pedir("GET", "/api/auth/yo", "", user); w.Code != 200 || !strings.Contains(w.Body.String(), "Lectora") {
		t.Errorf("yo: %d %s", w.Code, w.Body.String())
	}
	// Solo root y admin administran usuarios y ven la bitacora.
	for _, ruta := range []string{"/api/usuarios", "/api/bitacora"} {
		if w := e.pedir("GET", ruta, "", user); w.Code != 403 {
			t.Errorf("user en %s: %d, quiero 403", ruta, w.Code)
		}
		if w := e.pedir("GET", ruta, "", root); w.Code != 200 {
			t.Errorf("root en %s: %d", ruta, w.Code)
		}
	}
	if w := e.pedir("GET", "/api/usuarios", "", root); !strings.Contains(w.Body.String(), `"usuarios"`) {
		t.Errorf("listar: %s", w.Body.String())
	}

	w = e.pedir("POST", "/api/usuarios", `{"nombre":"Nuevo","correo":"nuevo@ejemplo.mx","contrasena":"`+contrasena+`","rol":"tecnico"}`, root)
	if w.Code != 201 {
		t.Fatalf("crear: %d %s", w.Code, w.Body.String())
	}
	if w := e.pedir("POST", "/api/usuarios", `{"nombre":"Nuevo","correo":"nuevo@ejemplo.mx","contrasena":"`+contrasena+`","rol":"tecnico"}`, root); w.Code != 409 {
		t.Errorf("crear repetido: %d", w.Code)
	}
	if w := e.pedir("POST", "/api/usuarios", `{"nombre":"X","correo":"x","contrasena":"corta","rol":"user"}`, root); w.Code != 400 {
		t.Errorf("crear invalido: %d", w.Code)
	}
	if w := e.pedir("PATCH", "/api/usuarios/abc", `{}`, root); w.Code != 400 {
		t.Errorf("id invalido: %d", w.Code)
	}
	if w := e.pedir("PATCH", "/api/usuarios/9999", `{"nombre":"X"}`, root); w.Code != 404 {
		t.Errorf("inexistente: %d", w.Code)
	}
	if w := e.pedir("PATCH", "/api/usuarios/1", `{"nombre":"Root 2"}`, root); w.Code != 200 || !strings.Contains(w.Body.String(), "Root 2") {
		t.Errorf("actualizar: %d %s", w.Code, w.Body.String())
	}
	if w := e.pedir("GET", "/api/bitacora?limite=5", "", root); w.Code != 200 || !strings.Contains(w.Body.String(), `"registros"`) {
		t.Errorf("bitacora: %d", w.Code)
	}
}

func TestBitacoraLimite(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		e.svc.Anotar(ctx, 0, "prueba", nil)
	}
	if regs, _ := e.svc.Bitacora(ctx, 2); len(regs) != 2 {
		t.Errorf("limite 2: %d", len(regs))
	}
	// Fuera de rango: el limite por defecto (200), no "todo".
	if regs, _ := e.svc.Bitacora(ctx, 99999); len(regs) != 6 {
		t.Errorf("limite fuera de rango: %d registros, quiero los 6", len(regs))
	}
}
