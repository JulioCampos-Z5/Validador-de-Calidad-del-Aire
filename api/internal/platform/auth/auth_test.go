package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var llave = []byte("llave-de-prueba-de-32-caracteres-o-mas")

func sesion(rol Rol) Sesion {
	return Sesion{IDUsuario: 7, IDSesion: 42, Nombre: "Julio", Rol: rol}
}

func TestFirmarYVerificar(t *testing.T) {
	e := NuevoEmisor(llave, time.Hour)
	tok, err := e.Firmar(sesion(Tecnico), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	s, err := e.Verificar(context.Background(), tok)
	if err != nil {
		t.Fatal(err)
	}
	if s != sesion(Tecnico) {
		t.Errorf("sesion = %+v, quiero %+v", s, sesion(Tecnico))
	}
}

func TestVerificarRechaza(t *testing.T) {
	e := NuevoEmisor(llave, time.Hour)
	ctx := context.Background()

	vencido, _ := e.Firmar(sesion(User), time.Now().Add(-time.Minute))
	otraLlave, _ := NuevoEmisor([]byte("otra-llave-distinta-de-32-caracteres!!"), time.Hour).
		Firmar(sesion(User), time.Now().Add(time.Hour))
	rolInventado, _ := e.Firmar(sesion("dios"), time.Now().Add(time.Hour))

	// Sin vencimiento: un token eterno no se acepta.
	sinVence, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims{
		Rol: User, Sesion: 1, RegisteredClaims: jwt.RegisteredClaims{Subject: "1"},
	}).SignedString(llave)
	// Otro algoritmo (none): no se acepta aunque las claims sean validas.
	ninguno, _ := jwt.NewWithClaims(jwt.SigningMethodNone, claims{
		Rol: Root, Sesion: 1, RegisteredClaims: jwt.RegisteredClaims{
			Subject: "1", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}).SignedString(jwt.UnsafeAllowNoneSignatureType)
	sujetoMalo, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims{
		Rol: User, Sesion: 1, RegisteredClaims: jwt.RegisteredClaims{
			Subject: "abc", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}).SignedString(llave)

	casos := map[string]string{
		"vacio": "", "basura": "no.es.jwt", "vencido": vencido, "otra llave": otraLlave,
		"rol inventado": rolInventado, "sin vencimiento": sinVence, "alg none": ninguno,
		"sujeto no numerico": sujetoMalo,
	}
	for nombre, tok := range casos {
		if _, err := e.Verificar(ctx, tok); !errors.Is(err, ErrToken) {
			t.Errorf("%s: err = %v, quiero ErrToken", nombre, err)
		}
	}
}

func TestSesionCerradaInvalidaElToken(t *testing.T) {
	e := NuevoEmisor(llave, time.Hour)
	activa := true
	e.SesionActiva = func(_ context.Context, id int64) (bool, error) {
		if id != 42 {
			t.Errorf("id de sesion = %d, quiero 42", id)
		}
		return activa, nil
	}
	tok, _ := e.Firmar(sesion(Admin), time.Now().Add(time.Hour))
	if _, err := e.Verificar(context.Background(), tok); err != nil {
		t.Fatalf("activa: %v", err)
	}
	activa = false
	if _, err := e.Verificar(context.Background(), tok); !errors.Is(err, ErrToken) {
		t.Errorf("cerrada: err = %v, quiero ErrToken", err)
	}

	// Si la base falla no es "token invalido": el error sube tal cual.
	caida := errors.New("base caida")
	e.SesionActiva = func(context.Context, int64) (bool, error) { return false, caida }
	if _, err := e.Verificar(context.Background(), tok); !errors.Is(err, caida) {
		t.Errorf("base caida: err = %v", err)
	}
}

func TestDuracionDe(t *testing.T) {
	e := NuevoEmisor(llave, 12*time.Hour)
	if e.DuracionDe(true) != 12*time.Hour {
		t.Error("sin ConRecordar, recordar no alarga la sesion")
	}
	e.ConRecordar(720 * time.Hour)
	if e.DuracionDe(false) != 12*time.Hour || e.DuracionDe(true) != 720*time.Hour {
		t.Errorf("duraciones = %v / %v", e.DuracionDe(false), e.DuracionDe(true))
	}
	// Recordar nunca acorta.
	if NuevoEmisor(llave, 12*time.Hour).ConRecordar(time.Hour).DuracionDe(true) != 12*time.Hour {
		t.Error("recordar mas corto que la sesion normal la acorto")
	}
	if e.Duracion() != 12*time.Hour {
		t.Error("Duracion")
	}
}

func TestRequiere(t *testing.T) {
	e := NuevoEmisor(llave, time.Hour)
	var vista Sesion
	h := e.Requiere(Administran)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		vista, _ = SesionDe(r.Context())
		w.WriteHeader(http.StatusNoContent)
	}))
	pedir := func(token string) int {
		r := httptest.NewRequest(http.MethodGet, "/x", nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	admin, _ := e.Firmar(sesion(Admin), time.Now().Add(time.Hour))
	tecnico, _ := e.Firmar(sesion(Tecnico), time.Now().Add(time.Hour))

	if c := pedir(""); c != http.StatusUnauthorized {
		t.Errorf("sin token: %d", c)
	}
	if c := pedir(tecnico); c != http.StatusForbidden {
		t.Errorf("rol sin permiso: %d", c)
	}
	if c := pedir(admin); c != http.StatusNoContent {
		t.Errorf("admin: %d", c)
	}
	if vista.Rol != Admin || vista.IDUsuario != 7 {
		t.Errorf("sesion en el contexto = %+v", vista)
	}

	e.SesionActiva = func(context.Context, int64) (bool, error) { return false, errors.New("caida") }
	if c := pedir(admin); c != http.StatusInternalServerError {
		t.Errorf("base caida: %d, quiero 500", c)
	}
}

func TestSesionDeSinSesion(t *testing.T) {
	if _, ok := SesionDe(context.Background()); ok {
		t.Error("un contexto vacio no tiene sesion")
	}
}

func TestBearer(t *testing.T) {
	casos := map[string]string{
		"Bearer abc":     "abc",
		"bearer abc ":    "abc",
		"BEARER  abc":    "abc",
		"Basic abc":      "",
		"Bearer":         "",
		"":               "",
		"Token abcdefgh": "",
	}
	for cabecera, quiero := range casos {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.Header.Set("Authorization", cabecera)
		if got := Bearer(r); got != quiero {
			t.Errorf("Bearer(%q) = %q, quiero %q", cabecera, got, quiero)
		}
	}
}

func TestRolValido(t *testing.T) {
	for _, r := range Todos {
		if !RolValido(r) {
			t.Errorf("%s deberia ser valido", r)
		}
	}
	for _, r := range []Rol{"", "Root", "dios"} {
		if RolValido(r) {
			t.Errorf("%q no deberia ser valido", r)
		}
	}
	// Los grupos de permisos solo usan roles validos.
	for _, g := range [][]Rol{Inventario, Administran} {
		for _, r := range g {
			if !RolValido(r) {
				t.Errorf("grupo con rol invalido %q", r)
			}
		}
	}
}

func TestHashYTokenAleatorio(t *testing.T) {
	if Hash("a") == Hash("b") || Hash("a") != Hash("a") || len(Hash("a")) != 64 {
		t.Error("Hash: sha256 en hex, determinista")
	}
	a, err := TokenAleatorio()
	b, _ := TokenAleatorio()
	if err != nil || len(a) != 64 || a == b || strings.Trim(a, "0123456789abcdef") != "" {
		t.Errorf("TokenAleatorio = %q, %q, err %v", a, b, err)
	}
}
