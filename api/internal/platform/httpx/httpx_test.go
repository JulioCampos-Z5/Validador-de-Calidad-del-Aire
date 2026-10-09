package httpx

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestJSONyError(t *testing.T) {
	w := httptest.NewRecorder()
	JSON(w, http.StatusCreated, map[string]int{"id": 3})
	if w.Code != http.StatusCreated || !strings.HasPrefix(w.Header().Get("Content-Type"), "application/json") {
		t.Errorf("JSON: %d %q", w.Code, w.Header().Get("Content-Type"))
	}
	if strings.TrimSpace(w.Body.String()) != `{"id":3}` {
		t.Errorf("cuerpo = %s", w.Body.String())
	}

	w = httptest.NewRecorder()
	Error(w, http.StatusBadRequest, "mal")
	var e map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &e)
	if w.Code != 400 || e["error"] != "mal" {
		t.Errorf("Error: %d %v", w.Code, e)
	}
}

func TestInternoNoFiltraElDetalle(t *testing.T) {
	w := httptest.NewRecorder()
	Interno(w, "prueba", errors.New("contraseña de la base: 1234"))
	if w.Code != 500 || strings.Contains(w.Body.String(), "1234") || !strings.Contains(w.Body.String(), "error interno") {
		t.Errorf("Interno: %d %s", w.Code, w.Body.String())
	}
}

func TestLeer(t *testing.T) {
	type cuerpo struct {
		Nombre string `json:"nombre"`
	}
	leer := func(texto string, max int64) (cuerpo, error) {
		var c cuerpo
		r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(texto))
		return c, Leer(httptest.NewRecorder(), r, max, &c)
	}
	if c, err := leer(`{"nombre":"CEN"}`, 1024); err != nil || c.Nombre != "CEN" {
		t.Errorf("valido: %+v %v", c, err)
	}
	if _, err := leer(`{"nombre":"CEN","sobra":1}`, 1024); err == nil {
		t.Error("un campo desconocido debe fallar (contrato viejo)")
	}
	if _, err := leer(`{nombre}`, 1024); err == nil || !strings.Contains(err.Error(), "JSON invalido") {
		t.Errorf("roto: %v", err)
	}
	if _, err := leer(`{"nombre":"`+strings.Repeat("x", 100)+`"}`, 20); err == nil || !strings.Contains(err.Error(), "20 bytes") {
		t.Errorf("demasiado grande: %v", err)
	}
}

func TestIP(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "10.0.0.5:51234"
	r.Header.Set("X-Forwarded-For", "1.2.3.4")
	if IP(r) != "10.0.0.5" {
		t.Errorf("IP = %q: X-Forwarded-For se ignora", IP(r))
	}
	r.RemoteAddr = "sin-puerto"
	if IP(r) != "sin-puerto" {
		t.Errorf("sin puerto = %q", IP(r))
	}
}

func TestRegistroConvierteElPanicEn500(t *testing.T) {
	h := Registro(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("ups") }))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))
	if w.Code != 500 || !strings.Contains(w.Body.String(), "error interno") {
		t.Errorf("panic: %d %s", w.Code, w.Body.String())
	}
}

func TestRegistroDejaPasarLaRespuesta(t *testing.T) {
	var flusher, unwrap bool
	h := Registro(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, flusher = w.(http.Flusher)
		_, unwrap = w.(interface{ Unwrap() http.ResponseWriter })
		w.WriteHeader(http.StatusTeapot)
		w.(http.Flusher).Flush()
	}))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))
	if w.Code != http.StatusTeapot || !flusher || !unwrap || !w.Flushed {
		t.Errorf("estado %d, flusher %v, unwrap %v, flushed %v", w.Code, flusher, unwrap, w.Flushed)
	}
}

func TestRegistroNoReescribeTrasPanicConRespuestaEmpezada(t *testing.T) {
	h := Registro(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		panic("a medias")
	}))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))
	if w.Code != http.StatusAccepted || w.Body.Len() != 0 {
		t.Errorf("estado %d, cuerpo %q", w.Code, w.Body.String())
	}
}
