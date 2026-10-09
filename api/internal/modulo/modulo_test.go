package modulo

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

type falso struct {
	nombre   string
	iniciado bool
}

func (f *falso) Nombre() string { return f.nombre }
func (f *falso) Rutas(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/"+f.nombre+"/hola", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
}
func (f *falso) Iniciar(context.Context) { f.iniciado = true }

func TestRegistro(t *testing.T) {
	r := NuevoRegistro()
	puertos := &falso{nombre: "puertos"}
	r.Activar(puertos, "/api/puertos/")
	r.EnProceso("almacen", "/api/almacen/")
	mux := http.NewServeMux()
	r.Montar(mux)

	pedir := func(ruta string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, ruta, nil))
		return w
	}

	if w := pedir("/api/puertos/hola"); w.Code != http.StatusNoContent {
		t.Errorf("modulo activo: %d", w.Code)
	}
	if w := pedir("/api/almacen/lo-que-sea"); w.Code != http.StatusServiceUnavailable {
		t.Errorf("modulo en proceso: %d, quiero 503", w.Code)
	}

	var cuerpo struct {
		Modulos []info `json:"modulos"`
	}
	w := pedir("/api/modulos")
	if err := json.Unmarshal(w.Body.Bytes(), &cuerpo); err != nil {
		t.Fatal(err)
	}
	quiero := []info{
		{Nombre: "almacen", Estado: EnProceso, Ruta: "/api/almacen/"},
		{Nombre: "puertos", Estado: Activo, Ruta: "/api/puertos/"},
	}
	if len(cuerpo.Modulos) != 2 || cuerpo.Modulos[0] != quiero[0] || cuerpo.Modulos[1] != quiero[1] {
		t.Errorf("modulos = %+v, quiero %+v (ordenados por nombre)", cuerpo.Modulos, quiero)
	}

	r.Iniciar(context.Background())
	if !puertos.iniciado {
		t.Error("Iniciar debe arrancar los modulos activos")
	}
}
