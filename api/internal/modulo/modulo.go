// Package modulo define el contrato comun de los modulos de la API y lleva
// cuales estan activos y cuales en proceso.
//
// Un modulo se enciende si tiene su configuracion (su DSN). Si no, queda "en
// proceso": la API arranca igual, sus rutas responden 503 y GET /api/modulos
// lo informa, para que el shell y formato-calibracion sepan que no esta.
package modulo

import (
	"context"
	"net/http"
	"sort"

	"validador-api/internal/platform/httpx"
)

// Modulo es lo que cada modulo activo ofrece a main.go.
type Modulo interface {
	Nombre() string
	Rutas(mux *http.ServeMux)
	// Iniciar arranca sus jobs en segundo plano; terminan con ctx.
	Iniciar(ctx context.Context)
}

type Estado string

const (
	Activo    Estado = "activo"
	EnProceso Estado = "en_proceso"
)

type info struct {
	Nombre string `json:"nombre"`
	Estado Estado `json:"estado"`
	Ruta   string `json:"ruta"`
}

type Registro struct {
	activos  []Modulo
	catalogo map[string]info
}

func NuevoRegistro() *Registro { return &Registro{catalogo: map[string]info{}} }

// Activar registra un modulo encendido. ruta es su prefijo, ej. /api/puertos/.
func (r *Registro) Activar(m Modulo, ruta string) {
	r.activos = append(r.activos, m)
	r.catalogo[m.Nombre()] = info{Nombre: m.Nombre(), Estado: Activo, Ruta: ruta}
}

// EnProceso registra un modulo apagado: sus rutas responden 503.
func (r *Registro) EnProceso(nombre, ruta string) {
	r.catalogo[nombre] = info{Nombre: nombre, Estado: EnProceso, Ruta: ruta}
}

// Montar registra las rutas de los activos, el 503 de los que estan en
// proceso y GET /api/modulos.
func (r *Registro) Montar(mux *http.ServeMux) {
	for _, m := range r.activos {
		m.Rutas(mux)
	}
	for _, i := range r.catalogo {
		if i.Estado == EnProceso {
			mux.HandleFunc(i.Ruta, func(w http.ResponseWriter, _ *http.Request) {
				httpx.Error(w, http.StatusServiceUnavailable, "módulo en proceso")
			})
		}
	}
	mux.HandleFunc("GET /api/modulos", func(w http.ResponseWriter, _ *http.Request) {
		lista := make([]info, 0, len(r.catalogo))
		for _, i := range r.catalogo {
			lista = append(lista, i)
		}
		sort.Slice(lista, func(a, b int) bool { return lista[a].Nombre < lista[b].Nombre })
		httpx.JSON(w, http.StatusOK, map[string]any{"modulos": lista})
	})
}

func (r *Registro) Iniciar(ctx context.Context) {
	for _, m := range r.activos {
		m.Iniciar(ctx)
	}
}
