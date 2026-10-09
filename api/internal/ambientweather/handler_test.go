package ambientweather

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"validador-api/internal/platform/auth"
)

type rutas struct {
	mux   *http.ServeMux
	svc   *Service
	admin string
	user  string
	ahora time.Time
}

// La API completa sobre SQLite real y una fuente falsa: una hora de lecturas
// cada 5 minutos de una estacion.
func montarRutas(t *testing.T, conLlaves bool) *rutas {
	t.Helper()
	ahora := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	repo := repoSQLite(t)
	var f fuente
	if conLlaves {
		f = &fuenteFalsa{inicio: ahora.Add(-time.Hour), fin: ahora}
	}
	svc, _ := servicioDePrueba(f, repo, ahora)
	svc.estado = Estado{Llaves: conLlaves, Intervalo: 60}
	ctx := context.Background()
	if err := repo.GuardarDispositivo(ctx, Dispositivo{MAC: macPrueba, Nombre: "Azotea"}, nil); err != nil {
		t.Fatal(err)
	}
	var ls []Lectura
	for i := 0; i < 12; i++ {
		ls = append(ls, Lectura{MAC: macPrueba, Fecha: ahora.Add(-time.Hour + time.Duration(i)*5*time.Minute),
			Valores: map[string]float64{"tempf": 60 + float64(i), "humidity": 50}})
	}
	if _, err := repo.GuardarLecturas(ctx, ls); err != nil {
		t.Fatal(err)
	}

	emisor := auth.NuevoEmisor([]byte("llave-de-prueba-de-32-caracteres-o-mas"), time.Hour)
	h := NewHandler(svc, emisor)
	mux := http.NewServeMux()
	h.Rutas(mux)
	admin, _ := emisor.Firmar(auth.Sesion{IDUsuario: 1, IDSesion: 1, Rol: auth.Admin}, time.Now().Add(time.Hour))
	user, _ := emisor.Firmar(auth.Sesion{IDUsuario: 2, IDSesion: 2, Rol: auth.User}, time.Now().Add(time.Hour))
	return &rutas{mux: mux, svc: svc, admin: admin, user: user, ahora: ahora}
}

func (r *rutas) pedir(metodo, ruta, cuerpo, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	r.mux.ServeHTTP(w, req)
	return w
}

func (r *rutas) tramo(desde, hasta time.Time) string {
	return "mac=" + url.QueryEscape(macPrueba) + "&desde=" + desde.Format(time.RFC3339) + "&hasta=" + hasta.Format(time.RFC3339)
}

func TestRutasDeConsulta(t *testing.T) {
	r := montarRutas(t, false)

	if w := r.pedir("GET", "/api/ambient-weather/estado", "", ""); w.Code != 401 {
		t.Errorf("sin sesion: %d", w.Code)
	}
	w := r.pedir("GET", "/api/ambient-weather/estado", "", r.user)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"llaves":false`) {
		t.Errorf("estado: %d %s", w.Code, w.Body.String())
	}

	w = r.pedir("GET", "/api/ambient-weather/dispositivos", "", r.user)
	var ds struct {
		Dispositivos []Dispositivo `json:"dispositivos"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &ds); w.Code != 200 || err != nil || len(ds.Dispositivos) != 1 || ds.Dispositivos[0].Lecturas != 12 {
		t.Fatalf("dispositivos: %d %s", w.Code, w.Body.String())
	}

	// Serie que cabe: cruda (cubetaSeg 0), en orden ascendente.
	w = r.pedir("GET", "/api/ambient-weather/serie?"+r.tramo(r.ahora.Add(-2*time.Hour), r.ahora)+"&puntos=100", "", r.user)
	var serie struct {
		Lecturas  []Lectura `json:"lecturas"`
		CubetaSeg int       `json:"cubetaSeg"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &serie); w.Code != 200 || err != nil {
		t.Fatalf("serie: %d %s", w.Code, w.Body.String())
	}
	if len(serie.Lecturas) != 12 || serie.CubetaSeg != 0 || !serie.Lecturas[0].Fecha.Before(serie.Lecturas[11].Fecha) {
		t.Errorf("serie cruda: %d lecturas, cubeta %d", len(serie.Lecturas), serie.CubetaSeg)
	}

	// Serie que no cabe en 5 puntos: agrupada en cubetas redondas.
	w = r.pedir("GET", "/api/ambient-weather/serie?"+r.tramo(r.ahora.Add(-time.Hour), r.ahora)+"&puntos=5", "", r.user)
	_ = json.Unmarshal(w.Body.Bytes(), &serie)
	if serie.CubetaSeg != int((15*time.Minute).Seconds()) || len(serie.Lecturas) > 5 {
		t.Errorf("serie agrupada: cubeta %d s, %d puntos", serie.CubetaSeg, len(serie.Lecturas))
	}

	// Tramo sin lecturas: lista vacia, no null.
	w = r.pedir("GET", "/api/ambient-weather/serie?"+r.tramo(r.ahora.Add(-48*time.Hour), r.ahora.Add(-47*time.Hour)), "", r.user)
	if !strings.Contains(w.Body.String(), `"lecturas":[]`) {
		t.Errorf("serie vacia: %s", w.Body.String())
	}

	w = r.pedir("GET", "/api/ambient-weather/lecturas?"+r.tramo(r.ahora.Add(-2*time.Hour), r.ahora)+"&limite=5&pagina=1&orden=tempf&dir=asc", "", r.user)
	var pag PaginaLecturas
	if err := json.Unmarshal(w.Body.Bytes(), &pag); w.Code != 200 || err != nil || pag.Total != 12 || len(pag.Lecturas) != 5 {
		t.Fatalf("lecturas: %d %s", w.Code, w.Body.String())
	}
	// Las paginas empiezan en 0 (como en el front): la 1 es la segunda.
	if pag.Lecturas[0].Valores["tempf"] != 65 {
		t.Errorf("orden por tempf ascendente, pagina 1: primera %v, quiero 65", pag.Lecturas[0].Valores["tempf"])
	}

	for nombre, ruta := range map[string]string{
		"mac invalida":   "/api/ambient-weather/serie?mac=nope",
		"desde ilegible": "/api/ambient-weather/serie?mac=" + url.QueryEscape(macPrueba) + "&desde=ayer",
		"hasta ilegible": "/api/ambient-weather/lecturas?mac=" + url.QueryEscape(macPrueba) + "&hasta=hoy",
		"al reves":       "/api/ambient-weather/lecturas?" + r.tramo(r.ahora, r.ahora.Add(-time.Hour)),
	} {
		if w := r.pedir("GET", ruta, "", r.user); w.Code != 400 {
			t.Errorf("%s: %d %s", nombre, w.Code, w.Body.String())
		}
	}
}

func TestRutaHistorico(t *testing.T) {
	sin := montarRutas(t, false)
	if w := sin.pedir("POST", "/api/ambient-weather/historico", `{"dias":7}`, sin.admin); w.Code != 503 {
		t.Errorf("sin llaves: %d, quiero 503", w.Code)
	}

	r := montarRutas(t, true)
	if w := r.pedir("POST", "/api/ambient-weather/historico", `{"dias":7}`, r.user); w.Code != 403 {
		t.Errorf("user: %d, quiero 403 (solo root y admin)", w.Code)
	}
	if w := r.pedir("POST", "/api/ambient-weather/historico", `{"dias":0}`, r.admin); w.Code != 400 {
		t.Errorf("dias 0: %d", w.Code)
	}
	if w := r.pedir("POST", "/api/ambient-weather/historico", `{"dias":`, r.admin); w.Code != 400 {
		t.Errorf("JSON roto: %d", w.Code)
	}

	w := r.pedir("POST", "/api/ambient-weather/historico", `{"mac":"`+macPrueba+`","dias":1}`, r.admin)
	if w.Code != 202 {
		t.Fatalf("historico: %d %s", w.Code, w.Body.String())
	}
	// Corre en segundo plano: se espera a que termine.
	limite := time.Now().Add(10 * time.Second)
	for {
		e := r.svc.Estado()
		if e.Descarga != nil && e.Descarga.Estado != "descargando" {
			if e.Descarga.Estado != "terminada" || e.Descarga.Recibidas == 0 || e.Descarga.Fin == nil {
				t.Errorf("descarga = %+v", e.Descarga)
			}
			break
		}
		if time.Now().After(limite) {
			t.Fatal("la descarga no termino")
		}
		time.Sleep(20 * time.Millisecond)
	}
	// Ya libre: se puede pedir otra.
	if w := r.pedir("POST", "/api/ambient-weather/historico", `{"dias":1}`, r.admin); w.Code != 202 {
		t.Errorf("segunda descarga: %d %s", w.Code, w.Body.String())
	}
}

func TestHandlerNombreEIniciarSinLlaves(t *testing.T) {
	r := montarRutas(t, false)
	h := NewHandler(r.svc, nil)
	if h.Nombre() != "ambientweather" {
		t.Error(h.Nombre())
	}
	ctx, cancelar := context.WithCancel(context.Background())
	defer cancelar()
	h.Iniciar(ctx) // sin llaves no arranca el sondeo
}
