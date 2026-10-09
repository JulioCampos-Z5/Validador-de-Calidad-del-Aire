package validacion

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"validador-api/internal/platform/auth"
)

type bitacora struct {
	mu       sync.Mutex
	acciones []map[string]string
	usuarios []int64
}

func (b *bitacora) Anotar(_ context.Context, id int64, accion string, detalle any) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if accion != "analisis" {
		return
	}
	b.usuarios = append(b.usuarios, id)
	b.acciones = append(b.acciones, detalle.(map[string]string))
}

type montaje struct {
	mux      *http.ServeMux
	bitacora *bitacora
	token    string
	recibido *http.Request
	cuerpo   string
}

func montar(t *testing.T) *montaje {
	t.Helper()
	m := &montaje{bitacora: &bitacora{}}
	flask := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		m.recibido, m.cuerpo = r, string(b)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(flask.Close)

	emisor := auth.NuevoEmisor([]byte("llave-de-prueba-de-32-caracteres-o-mas"), time.Hour)
	h, err := New(flask.URL+"/", emisor, m.bitacora)
	if err != nil {
		t.Fatal(err)
	}
	m.mux = http.NewServeMux()
	h.Rutas(m.mux)
	m.token, _ = emisor.Firmar(auth.Sesion{IDUsuario: 9, IDSesion: 1, Nombre: "J", Rol: auth.User}, time.Now().Add(time.Hour))
	return m
}

func (m *montaje) pedir(metodo, ruta, cuerpo, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	m.mux.ServeHTTP(w, r)
	return w
}

func TestReenviaAFlaskSinElToken(t *testing.T) {
	m := montar(t)
	w := m.pedir(http.MethodGet, "/api/analisis/ias/mide?x=1", "", m.token)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"ok":true`) {
		t.Fatalf("respuesta %d %s", w.Code, w.Body.String())
	}
	if m.recibido.URL.Path != "/api/ias/mide" || m.recibido.URL.RawQuery != "x=1" {
		t.Errorf("Flask recibio %s?%s, quiero /api/ias/mide?x=1", m.recibido.URL.Path, m.recibido.URL.RawQuery)
	}
	if m.recibido.Header.Get("Authorization") != "" {
		t.Error("el token de la API no debe llegar a Flask")
	}
	if len(m.bitacora.acciones) != 0 {
		t.Error("un GET no se anota en la bitacora")
	}
}

func TestSinSesionNoPasa(t *testing.T) {
	m := montar(t)
	if w := m.pedir(http.MethodGet, "/api/analisis/ias/mide", "", ""); w.Code != http.StatusUnauthorized {
		t.Errorf("sin token: %d", w.Code)
	}
	if m.recibido != nil {
		t.Error("sin sesion no debe llegar nada a Flask")
	}
}

func TestLasEscriturasQuedanEnBitacora(t *testing.T) {
	m := montar(t)
	w := m.pedir(http.MethodPost, "/api/analisis/validate/full", `{"filename":"BD.xlsx"}`, m.token)
	if w.Code != 200 || m.cuerpo != `{"filename":"BD.xlsx"}` {
		t.Fatalf("POST: %d, Flask recibio %q", w.Code, m.cuerpo)
	}
	if len(m.bitacora.acciones) != 1 || m.bitacora.usuarios[0] != 9 {
		t.Fatalf("bitacora = %+v", m.bitacora)
	}
	if a := m.bitacora.acciones[0]; a["metodo"] != "POST" || a["ruta"] != "validate/full" {
		t.Errorf("accion = %v", a)
	}
}

func TestFlaskCaidoDa502(t *testing.T) {
	emisor := auth.NuevoEmisor([]byte("llave-de-prueba-de-32-caracteres-o-mas"), time.Hour)
	// Un puerto donde no escucha nadie.
	h, err := New("http://127.0.0.1:1", emisor, &bitacora{})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	h.Rutas(mux)
	tok, _ := emisor.Firmar(auth.Sesion{IDUsuario: 1, IDSesion: 1, Rol: auth.User}, time.Now().Add(time.Hour))
	r := httptest.NewRequest(http.MethodGet, "/api/analisis/resumen", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	if w.Code != http.StatusBadGateway || !strings.Contains(w.Body.String(), "no responde") {
		t.Errorf("Flask caido: %d %s", w.Code, w.Body.String())
	}
}

func TestNombreYURLInvalida(t *testing.T) {
	if _, err := New("://mal", nil, nil); err == nil {
		t.Error("una URL invalida debe fallar al crear")
	}
	h, _ := New("http://x", nil, nil)
	if h.Nombre() != "validacion" {
		t.Error(h.Nombre())
	}
	h.Iniciar(context.Background()) // no arranca nada
}
