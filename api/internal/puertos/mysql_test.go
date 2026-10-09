package puertos

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"validador-api/internal/platform/auth"
	"validador-api/internal/platform/db/dbprueba"
)

type bitacora struct{ acciones []string }

func (b *bitacora) Anotar(_ context.Context, _ int64, accion string, _ any) {
	b.acciones = append(b.acciones, accion)
}

type montaje struct {
	svc   *Service
	mux   *http.ServeMux
	admin string
	user  string
	reloj time.Time
	bitac *bitacora
}

// Puertos solo corre en MySQL: base propia y desechable (ver dbprueba).
func montar(t *testing.T) *montaje {
	t.Helper()
	base := dbprueba.MySQL(t, "puertos", Migraciones())
	m := &montaje{bitac: &bitacora{}, reloj: time.Now().UTC().Truncate(time.Second)}
	m.svc = NewService(NewRepository(base), m.bitac, umbralesPrueba, 3*time.Minute)
	m.svc.ahora = func() time.Time { return m.reloj }
	emisor := auth.NuevoEmisor([]byte("llave-de-prueba-de-32-caracteres-o-mas"), time.Hour)
	m.mux = http.NewServeMux()
	NewHandler(m.svc, emisor, time.Minute).Rutas(m.mux)
	m.admin, _ = emisor.Firmar(auth.Sesion{IDUsuario: 1, IDSesion: 1, Rol: auth.Admin}, time.Now().Add(time.Hour))
	m.user, _ = emisor.Firmar(auth.Sesion{IDUsuario: 2, IDSesion: 2, Rol: auth.User}, time.Now().Add(time.Hour))
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

func (m *montaje) estado(t *testing.T) []EstadoEstacion {
	t.Helper()
	w := m.pedir("GET", "/api/puertos/estado", "", m.user)
	var r struct {
		Estaciones []EstadoEstacion `json:"estaciones"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &r); w.Code != 200 || err != nil {
		t.Fatalf("estado: %d %s", w.Code, w.Body.String())
	}
	return r.Estaciones
}

func evento(uuid, tipo, clave string, momento time.Time) string {
	b, _ := json.Marshal(EnvioEventos{Eventos: []Evento{{UUID: uuid, Tipo: tipo, Clave: clave, Nombre: "Analizador", Momento: momento}}})
	return string(b)
}

func TestFlujoDelDetector(t *testing.T) {
	m := montar(t)

	// Solo admin crea estaciones; el token se ve una sola vez.
	if w := m.pedir("POST", "/api/puertos/estaciones", `{"nombre":"Centro"}`, m.user); w.Code != 403 {
		t.Errorf("user crea estacion: %d", w.Code)
	}
	w := m.pedir("POST", "/api/puertos/estaciones", `{"nombre":"Centro"}`, m.admin)
	var creada struct {
		ID    int64  `json:"id"`
		Token string `json:"token"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &creada); w.Code != 201 || err != nil || len(creada.Token) != 64 {
		t.Fatalf("crear: %d %s", w.Code, w.Body.String())
	}
	if w := m.pedir("POST", "/api/puertos/estaciones", `{"nombre":"Centro"}`, m.admin); w.Code != 409 {
		t.Errorf("nombre repetido: %d", w.Code)
	}
	if w := m.pedir("POST", "/api/puertos/estaciones", `{"nombre":"  "}`, m.admin); w.Code != 400 {
		t.Errorf("sin nombre: %d", w.Code)
	}
	if w := m.pedir("GET", "/api/puertos/estaciones", "", m.admin); !strings.Contains(w.Body.String(), "Centro") ||
		strings.Contains(w.Body.String(), creada.Token) {
		t.Errorf("listar estaciones no expone el token: %s", w.Body.String())
	}
	tok := creada.Token

	// Los endpoints del detector solo aceptan el token de estacion.
	if w := m.pedir("POST", "/api/puertos/latido", `{}`, ""); w.Code != 401 {
		t.Errorf("latido sin token: %d", w.Code)
	}
	if w := m.pedir("POST", "/api/puertos/latido", `{}`, m.admin); w.Code != 401 {
		t.Errorf("latido con token de persona: %d", w.Code)
	}

	// Latido: dos puertos arriba.
	if w := m.pedir("POST", "/api/puertos/latido",
		`{"arriba":["tcp:502","com:COM3"],"nombres":{"tcp:502":"T400"}}`, tok); w.Code != 200 {
		t.Fatalf("latido: %d %s", w.Code, w.Body.String())
	}
	if w := m.pedir("POST", "/api/puertos/latido", `{"arriba":["http:80"]}`, tok); w.Code != 400 {
		t.Errorf("clave invalida: %d", w.Code)
	}
	est := m.estado(t)
	if len(est) != 1 || len(est[0].Puertos) != 2 || est[0].SinComunicacion {
		t.Fatalf("estado tras latido: %+v", est)
	}
	for _, p := range est[0].Puertos {
		if p.Estado != "arriba" {
			t.Errorf("puerto %s = %s", p.Clave, p.Estado)
		}
		if p.Clave == "tcp:502" && p.Nombre != "T400" {
			t.Errorf("nombre del latido: %q", p.Nombre)
		}
	}

	// Evento de caida, despues del latido: el puerto queda caido. Reenviarlo
	// (la bandeja del detector) no lo duplica.
	m.reloj = m.reloj.Add(30 * time.Second)
	caida := evento("11111111-2222-4333-8444-555555555555", PuertoCaido, "tcp:502", m.reloj)
	w = m.pedir("POST", "/api/puertos/eventos", caida, tok)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"nuevos":1`) {
		t.Fatalf("evento: %d %s", w.Code, w.Body.String())
	}
	if w := m.pedir("POST", "/api/puertos/eventos", caida, tok); !strings.Contains(w.Body.String(), `"duplicados":1`) {
		t.Errorf("reenvio: %s", w.Body.String())
	}
	est = m.estado(t)
	if est[0].Puertos[0].Clave != "tcp:502" || est[0].Puertos[0].Estado != "caido" || est[0].Puertos[0].Desde == nil {
		t.Errorf("los caidos van primero: %+v", est[0].Puertos)
	}

	// Eventos invalidos.
	for nombre, cuerpo := range map[string]string{
		"uuid":      evento("no-es-uuid", PuertoCaido, "tcp:502", m.reloj),
		"tipo":      evento("21111111-2222-4333-8444-555555555555", "explotó", "tcp:502", m.reloj),
		"futuro":    evento("31111111-2222-4333-8444-555555555555", PuertoCaido, "tcp:502", m.reloj.Add(time.Hour)),
		"muy viejo": evento("41111111-2222-4333-8444-555555555555", PuertoCaido, "tcp:502", m.reloj.Add(-31*24*time.Hour)),
	} {
		if w := m.pedir("POST", "/api/puertos/eventos", cuerpo, tok); w.Code != 400 {
			t.Errorf("evento con %s invalido: %d", nombre, w.Code)
		}
	}

	// Sin latido mas alla de la tolerancia: sin comunicacion, una sola vez.
	m.reloj = m.reloj.Add(10 * time.Minute)
	ctx := context.Background()
	if err := m.svc.RevisarLatidos(ctx); err != nil {
		t.Fatal(err)
	}
	if err := m.svc.RevisarLatidos(ctx); err != nil {
		t.Fatal(err)
	}
	est = m.estado(t)
	if !est[0].SinComunicacion || est[0].Nivel != NivelReciente {
		t.Errorf("sin comunicacion: %+v", est[0])
	}
	// Un latido nuevo la restablece.
	m.pedir("POST", "/api/puertos/latido", `{"arriba":["tcp:502"]}`, tok)
	if m.estado(t)[0].SinComunicacion {
		t.Error("el latido restablece la comunicacion")
	}

	// Historial: sin_comunicacion y comunicacion_restablecida, una vez cada uno.
	evs, err := m.svc.Eventos(ctx, FiltroEventos{Desde: m.reloj.Add(-time.Hour), Hasta: m.reloj.Add(time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	cuenta := map[string]int{}
	for _, e := range evs {
		cuenta[e.Tipo]++
	}
	if cuenta[PuertoCaido] != 1 || cuenta[SinComunicacion] != 1 || cuenta[ComunicacionRestablecida] != 1 {
		t.Errorf("historial = %v", cuenta)
	}
	w = m.pedir("GET", "/api/puertos/eventos?estacion=Centro&limite=10&desde="+
		m.reloj.Add(-time.Hour).Format(time.RFC3339)+"&hasta="+m.reloj.Add(time.Minute).Format(time.RFC3339), "", m.user)
	if w.Code != 200 || strings.Count(w.Body.String(), `"tipo"`) != 3 {
		t.Errorf("GET eventos: %d %s", w.Code, w.Body.String())
	}
	if w := m.pedir("GET", "/api/puertos/eventos?desde=ayer", "", m.user); w.Code != 400 {
		t.Errorf("fecha mala: %d", w.Code)
	}
	if len(m.bitac.acciones) != 1 || m.bitac.acciones[0] != "estacion_creada" {
		t.Errorf("bitacora = %v", m.bitac.acciones)
	}
}

func TestEventosRangoAlReves(t *testing.T) {
	s := NewService(nil, nil, umbralesPrueba, time.Minute)
	ahora := time.Now()
	if _, err := s.Eventos(context.Background(), FiltroEventos{Desde: ahora, Hasta: ahora.Add(-time.Hour)}); !errors.Is(err, ErrEntrada) {
		t.Errorf("desde > hasta: %v", err)
	}
}

func TestLimitesDeEnvio(t *testing.T) {
	s := NewService(nil, nil, umbralesPrueba, time.Minute)
	ctx := context.Background()
	est := &Estacion{ID: 1, Nombre: "X"}
	if err := s.RecibirLatido(ctx, est, Latido{Arriba: make([]string, maxPuertosLatido+1)}); !errors.Is(err, ErrEntrada) {
		t.Errorf("latido enorme: %v", err)
	}
	if err := s.RecibirLatido(ctx, est, Latido{Nombres: map[string]string{"tcp:1": strings.Repeat("x", 201)}}); !errors.Is(err, ErrEntrada) {
		t.Errorf("nombre largo: %v", err)
	}
	if _, err := s.RecibirEventos(ctx, est, EnvioEventos{Eventos: make([]Evento, maxEventosPorEnvio+1)}); !errors.Is(err, ErrEntrada) {
		t.Errorf("envio enorme: %v", err)
	}
}
