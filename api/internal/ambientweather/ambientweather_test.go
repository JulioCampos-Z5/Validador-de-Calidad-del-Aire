package ambientweather

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

const macPrueba = "F8:B3:B7:85:C7:55"

func TestNormalizar(t *testing.T) {
	l, ok := Normalizar(strings.ToLower(macPrueba), map[string]any{
		"dateutc":        float64(1759766400000),
		"tempf":          float64(77.5),
		"feelsLike":      float64(79), // con mayuscula
		"winddir_avg10m": "180",       // texto numerico
		"humidity":       "NaN",       // no es lectura
		"pm25":           nil,         // no llego
		"campoNuevo":     float64(1),  // se queda solo en el crudo
	})
	if !ok {
		t.Fatal("una lectura con dateutc debe normalizarse")
	}
	if l.MAC != macPrueba {
		t.Errorf("MAC = %q, quiero mayusculas", l.MAC)
	}
	if !l.Fecha.Equal(time.UnixMilli(1759766400000)) {
		t.Errorf("Fecha = %v", l.Fecha)
	}
	quiero := map[string]float64{"tempf": 77.5, "feelslikef": 79, "winddiravg10m": 180}
	if len(l.Valores) != len(quiero) {
		t.Fatalf("Valores = %v, quiero %v", l.Valores, quiero)
	}
	for k, v := range quiero {
		if l.Valores[k] != v {
			t.Errorf("%s = %v, quiero %v", k, l.Valores[k], v)
		}
	}
	if !strings.Contains(string(l.crudo), "campoNuevo") {
		t.Error("el crudo debe conservar los campos que no tienen columna")
	}

	if _, ok := Normalizar(macPrueba, map[string]any{"tempf": float64(70)}); ok {
		t.Error("sin dateutc no hay lectura")
	}
}

func TestClienteNoFiltraLasLlaves(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("apiKey") != "llave-secreta" || r.URL.Query().Get("applicationKey") != "app-secreta" {
			t.Error("las llaves deben ir en la query")
		}
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"apiKey-missing"}`))
	}))
	defer srv.Close()

	_, err := NuevoCliente(srv.URL, "llave-secreta", "app-secreta").Dispositivos(context.Background())
	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("err = %v, quiero un 401 explicado", err)
	}
	if strings.Contains(err.Error(), "secreta") {
		t.Errorf("el error no debe traer las llaves: %v", err)
	}

	// Sin respuesta: net/http mete la URL entera (con llaves) en su error.
	srv.Close()
	_, err = NuevoCliente(srv.URL, "llave-secreta", "app-secreta").Dispositivos(context.Background())
	if err == nil || strings.Contains(err.Error(), "secreta") {
		t.Errorf("err = %v; no debe traer las llaves", err)
	}
}

func TestClienteHistoricoPideLaPaginaCorrecta(t *testing.T) {
	hasta := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/devices/"+macPrueba {
			t.Errorf("ruta = %s", r.URL.Path)
		}
		if r.URL.Query().Get("limit") != "288" {
			t.Errorf("limit = %s", r.URL.Query().Get("limit"))
		}
		if r.URL.Query().Get("endDate") != "1790856000000" {
			t.Errorf("endDate = %s", r.URL.Query().Get("endDate"))
		}
		w.Write([]byte(`[{"dateutc":1790855700000,"tempf":70}]`))
	}))
	defer srv.Close()

	obs, err := NuevoCliente(srv.URL, "a", "b").Historico(context.Background(), macPrueba, hasta, 1000)
	if err != nil || len(obs) != 1 {
		t.Fatalf("obs = %v, err = %v", obs, err)
	}
}

func TestCubetaPara(t *testing.T) {
	casos := []struct {
		tramo  time.Duration
		puntos int
		quiero time.Duration
	}{
		{24 * time.Hour, 1500, 5 * time.Minute},         // 288 cubetas
		{30 * 24 * time.Hour, 1500, 30 * time.Minute},   // 1440
		{365 * 24 * time.Hour, 1500, 6 * time.Hour},     // 1460
		{3 * 365 * 24 * time.Hour, 100, 24 * time.Hour}, // no cabe: la mas grande
	}
	for _, c := range casos {
		if got := CubetaPara(c.tramo, c.puntos); got != c.quiero {
			t.Errorf("CubetaPara(%s, %d) = %s, quiero %s", c.tramo, c.puntos, got, c.quiero)
		}
	}
}

// --- dobles de prueba ---

type fuenteFalsa struct {
	// lecturas cada 5 min desde inicio hasta fin, que Historico pagina.
	inicio, fin time.Time
	pedidas     []time.Time
}

func (f *fuenteFalsa) Dispositivos(context.Context) ([]DispositivoAPI, error) {
	return []DispositivoAPI{{
		MacAddress: macPrueba,
		LastData:   map[string]any{"dateutc": float64(f.fin.UnixMilli()), "tempf": float64(70)},
		Info:       map[string]any{"name": "Azotea", "coords": map[string]any{"coords": map[string]any{"lat": 20.67, "lon": -103.35}}},
	}}, nil
}

func (f *fuenteFalsa) Historico(_ context.Context, _ string, hasta time.Time, limite int) ([]map[string]any, error) {
	f.pedidas = append(f.pedidas, hasta)
	if hasta.IsZero() || hasta.After(f.fin) {
		hasta = f.fin
	}
	var res []map[string]any
	for t := hasta.Truncate(5 * time.Minute); !t.Before(f.inicio) && len(res) < limite; t = t.Add(-5 * time.Minute) {
		res = append(res, map[string]any{"dateutc": float64(t.UnixMilli()), "tempf": float64(70)})
	}
	return res, nil
}

type almacenFalso struct {
	mu       sync.Mutex
	lecturas map[int64]Lectura
	disps    map[string]Dispositivo
}

func nuevoAlmacen() *almacenFalso {
	return &almacenFalso{lecturas: map[int64]Lectura{}, disps: map[string]Dispositivo{}}
}

func (a *almacenFalso) GuardarDispositivo(_ context.Context, d Dispositivo, _ []byte) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.disps[d.MAC] = d
	return nil
}

func (a *almacenFalso) GuardarLecturas(_ context.Context, ls []Lectura) (int, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	n := 0
	for _, l := range ls {
		if _, ya := a.lecturas[l.Fecha.UnixMilli()]; !ya {
			a.lecturas[l.Fecha.UnixMilli()] = l
			n++
		}
	}
	return n, nil
}

func (a *almacenFalso) UltimaFecha(context.Context, string) (time.Time, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	var u time.Time
	for _, l := range a.lecturas {
		if l.Fecha.After(u) {
			u = l.Fecha
		}
	}
	return u, nil
}

func (a *almacenFalso) Dispositivos(context.Context) ([]Dispositivo, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	var res []Dispositivo
	for _, d := range a.disps {
		res = append(res, d)
	}
	return res, nil
}

func (a *almacenFalso) Lecturas(context.Context, FiltroLecturas) ([]Lectura, error) { return nil, nil }
func (a *almacenFalso) Contar(context.Context, FiltroLecturas) (int, error)         { return 0, nil }
func (a *almacenFalso) ColumnasConDatos(context.Context, FiltroLecturas) ([]string, error) {
	return []string{"tempf"}, nil
}
func (a *almacenFalso) Serie(context.Context, FiltroLecturas, time.Duration) ([]Lectura, error) {
	return nil, nil
}

type bitacoraFalsa struct{ acciones []string }

func (b *bitacoraFalsa) Anotar(_ context.Context, _ int64, accion string, _ any) {
	b.acciones = append(b.acciones, accion)
}

func servicioDePrueba(f fuente, a almacen, ahora time.Time) (*Service, *bitacoraFalsa) {
	b := &bitacoraFalsa{}
	s := &Service{repo: a, fuente: f, intervalo: time.Minute, bitacora: b,
		ahora: func() time.Time { return ahora }, fondo: context.Background()}
	return s, b
}

func TestRellenarPaginaHastaElTramoSinRepetir(t *testing.T) {
	fin := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	f := &fuenteFalsa{inicio: fin.Add(-10 * 24 * time.Hour), fin: fin}
	a := nuevoAlmacen()
	s, _ := servicioDePrueba(f, a, fin)

	// La lectura 576 cae justo en `desde`: con eso basta, no hace falta otra pagina.
	desde := fin.Add(-575 * 5 * time.Minute)
	recibidas, nuevas, err := s.rellenar(context.Background(), macPrueba, desde, nil)
	if err != nil {
		t.Fatal(err)
	}
	// 576 lecturas: dos paginas de 288, y la segunda ya llega al tramo.
	if len(f.pedidas) != 2 {
		t.Errorf("paginas pedidas = %d, quiero 2", len(f.pedidas))
	}
	if recibidas != 576 || nuevas != 576 {
		t.Errorf("recibidas = %d, nuevas = %d; quiero 576 y 576 (sin traslape entre paginas)", recibidas, nuevas)
	}
}

func TestSondeoGuardaEstacionYRellenaElHueco(t *testing.T) {
	fin := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	f := &fuenteFalsa{inicio: fin.Add(-30 * 24 * time.Hour), fin: fin}
	a := nuevoAlmacen()
	s, _ := servicioDePrueba(f, a, fin)

	s.sondear(context.Background(), true)

	d, ok := a.disps[macPrueba]
	if !ok || d.Nombre != "Azotea" || d.Lat == nil || *d.Lat != 20.67 {
		t.Errorf("estacion guardada = %+v", d)
	}
	// Sin nada guardado, el primer sondeo trae el ultimo dia (y algo mas por la pagina).
	if n := len(a.lecturas); n < 288 || n > 2*288 {
		t.Errorf("lecturas tras el primer sondeo = %d", n)
	}
	if e := s.Estado(); e.UltimoSondeo == nil || e.UltimoError != "" {
		t.Errorf("estado = %+v", e)
	}
}

func TestDescargarHistoricoValida(t *testing.T) {
	ahora := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	a := nuevoAlmacen()
	a.disps[macPrueba] = Dispositivo{MAC: macPrueba}

	sinLlaves, _ := servicioDePrueba(nil, a, ahora)
	if err := sinLlaves.DescargarHistorico(context.Background(), 1, "", 30); !errors.Is(err, ErrSinLlaves) {
		t.Errorf("sin llaves: err = %v", err)
	}

	s, b := servicioDePrueba(&fuenteFalsa{inicio: ahora.Add(-time.Hour), fin: ahora}, a, ahora)
	for _, dias := range []int{0, 366} {
		if err := s.DescargarHistorico(context.Background(), 1, "", dias); !errors.Is(err, ErrEntrada) {
			t.Errorf("dias = %d: err = %v", dias, err)
		}
	}
	if err := s.DescargarHistorico(context.Background(), 1, "00:11:22:33:44:55", 30); !errors.Is(err, ErrEntrada) {
		t.Errorf("estacion que no existe: err = %v", err)
	}

	s.ocupado = true
	if err := s.DescargarHistorico(context.Background(), 1, "", 30); !errors.Is(err, ErrOcupado) {
		t.Errorf("con otra en curso: err = %v", err)
	}
	if len(b.acciones) != 0 {
		t.Errorf("nada de lo rechazado debe quedar en la bitacora: %v", b.acciones)
	}
}

// El orden va dentro del SQL: solo pasan las columnas conocidas.
func TestLecturasSoloOrdenaPorColumnasConocidas(t *testing.T) {
	ahora := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	s, _ := servicioDePrueba(nil, nuevoAlmacen(), ahora)
	ctx := context.Background()

	for _, orden := range []string{"", "fecha", "tempf", "battout"} {
		if _, err := s.Lecturas(ctx, FiltroLecturas{MAC: macPrueba, Orden: orden}); err != nil {
			t.Errorf("orden %q: %v", orden, err)
		}
	}
	for _, orden := range []string{"crudo", "tempf; DROP TABLE lecturas", "TEMPF"} {
		if _, err := s.Lecturas(ctx, FiltroLecturas{MAC: macPrueba, Orden: orden}); !errors.Is(err, ErrEntrada) {
			t.Errorf("orden %q: err = %v, quiero ErrEntrada", orden, err)
		}
	}
	if _, err := s.Lecturas(ctx, FiltroLecturas{MAC: macPrueba, Pagina: -1}); !errors.Is(err, ErrEntrada) {
		t.Errorf("pagina negativa: err = %v", err)
	}
}

func TestValidarFiltro(t *testing.T) {
	ahora := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	s, _ := servicioDePrueba(nil, nuevoAlmacen(), ahora)

	f := FiltroLecturas{MAC: strings.ToLower(macPrueba)}
	if err := s.validar(&f); err != nil {
		t.Fatal(err)
	}
	if f.MAC != macPrueba || !f.Hasta.Equal(ahora) || !f.Desde.Equal(ahora.Add(-24*time.Hour)) {
		t.Errorf("por omision: %+v", f)
	}
	malos := []FiltroLecturas{
		{MAC: "no-es-mac"},
		{MAC: macPrueba, Desde: ahora, Hasta: ahora.Add(-time.Hour)},
		{MAC: macPrueba, Desde: ahora.Add(-500 * 24 * time.Hour), Hasta: ahora},
	}
	for _, m := range malos {
		if err := s.validar(&m); !errors.Is(err, ErrEntrada) {
			t.Errorf("%+v: err = %v", m, err)
		}
	}
}
