package inventario

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"validador-api/internal/platform/auth"
	"validador-api/internal/platform/httpx"
)

const maxCuerpo = 64 << 10

type Handler struct {
	svc    *Service
	emisor *auth.Emisor
}

func NewHandler(svc *Service, emisor *auth.Emisor) *Handler {
	return &Handler{svc: svc, emisor: emisor}
}

func (h *Handler) Nombre() string              { return "inventario" }
func (h *Handler) Iniciar(ctx context.Context) {}

// Ver: todos. Editar: root, admin y tecnico (doc, seccion 5).
func (h *Handler) Rutas(mux *http.ServeMux) {
	ver := h.emisor.Requiere(auth.Todos)
	editar := h.emisor.Requiere(auth.Inventario)

	mux.Handle("GET /api/inventario/catalogos", ver(http.HandlerFunc(h.catalogos)))
	mux.Handle("GET /api/inventario/equipos", ver(http.HandlerFunc(h.equipos)))
	mux.Handle("POST /api/inventario/equipos", editar(http.HandlerFunc(h.crearEquipo)))
	mux.Handle("PUT /api/inventario/equipos/{id}", editar(http.HandlerFunc(h.actualizarEquipo)))
	mux.Handle("PUT /api/inventario/equipos/{id}/estacion", editar(http.HandlerFunc(h.ubicar)))
	mux.Handle("PUT /api/inventario/equipos/{id}/complementos", editar(http.HandlerFunc(h.complementos)))
	mux.Handle("GET /api/inventario/estaciones", ver(http.HandlerFunc(h.estaciones)))
	mux.Handle("POST /api/inventario/estaciones", editar(http.HandlerFunc(h.crearEstacion)))
	mux.Handle("PUT /api/inventario/estaciones/{id}", editar(http.HandlerFunc(h.actualizarEstacion)))
}

func (h *Handler) catalogos(w http.ResponseWriter, _ *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{
		"tipos": Tipos, "estatusEquipo": EstatusEquipo, "conexiones": Conexiones, "estatusEstacion": EstatusEstacion,
	})
}

func (h *Handler) equipos(w http.ResponseWriter, r *http.Request) {
	es, err := h.svc.Equipos(r.Context())
	if err != nil {
		h.fallo(w, err)
		return
	}
	if es == nil {
		es = []Equipo{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"equipos": es})
}

func (h *Handler) crearEquipo(w http.ResponseWriter, r *http.Request) {
	var d DatosEquipo
	if !h.leer(w, r, &d) {
		return
	}
	e, err := h.svc.CrearEquipo(r.Context(), quien(r), d)
	h.responder(w, http.StatusCreated, e, err)
}

func (h *Handler) actualizarEquipo(w http.ResponseWriter, r *http.Request) {
	id, ok := idDe(w, r)
	var d DatosEquipo
	if !ok || !h.leer(w, r, &d) {
		return
	}
	e, err := h.svc.ActualizarEquipo(r.Context(), quien(r), id, d)
	h.responder(w, http.StatusOK, e, err)
}

func (h *Handler) ubicar(w http.ResponseWriter, r *http.Request) {
	id, ok := idDe(w, r)
	var c struct {
		IDEstacion *int64 `json:"idEstacion"`
	}
	if !ok || !h.leer(w, r, &c) {
		return
	}
	e, err := h.svc.Ubicar(r.Context(), quien(r), id, c.IDEstacion)
	h.responder(w, http.StatusOK, e, err)
}

func (h *Handler) complementos(w http.ResponseWriter, r *http.Request) {
	id, ok := idDe(w, r)
	var c struct {
		IDEquipos []int64 `json:"idEquipos"`
	}
	if !ok || !h.leer(w, r, &c) {
		return
	}
	e, err := h.svc.PonerComplementos(r.Context(), quien(r), id, c.IDEquipos)
	h.responder(w, http.StatusOK, e, err)
}

func (h *Handler) estaciones(w http.ResponseWriter, r *http.Request) {
	es, err := h.svc.Estaciones(r.Context())
	if err != nil {
		h.fallo(w, err)
		return
	}
	if es == nil {
		es = []Estacion{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"estaciones": es})
}

func (h *Handler) crearEstacion(w http.ResponseWriter, r *http.Request) {
	var d DatosEstacion
	if !h.leer(w, r, &d) {
		return
	}
	e, err := h.svc.CrearEstacion(r.Context(), quien(r), d)
	h.responder(w, http.StatusCreated, e, err)
}

func (h *Handler) actualizarEstacion(w http.ResponseWriter, r *http.Request) {
	id, ok := idDe(w, r)
	var d DatosEstacion
	if !ok || !h.leer(w, r, &d) {
		return
	}
	e, err := h.svc.ActualizarEstacion(r.Context(), quien(r), id, d)
	h.responder(w, http.StatusOK, e, err)
}

func (h *Handler) leer(w http.ResponseWriter, r *http.Request, destino any) bool {
	if err := httpx.Leer(w, r, maxCuerpo, destino); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return false
	}
	return true
}

func (h *Handler) responder(w http.ResponseWriter, estado int, v any, err error) {
	if err != nil {
		h.fallo(w, err)
		return
	}
	httpx.JSON(w, estado, v)
}

func (h *Handler) fallo(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrEntrada):
		httpx.Error(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrNoExiste):
		httpx.Error(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrDuplicado):
		httpx.Error(w, http.StatusConflict, "Ya existe uno con ese número de serie o nombre")
	default:
		httpx.Interno(w, "inventario", err)
	}
}

func idDe(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "id invalido")
		return 0, false
	}
	return id, true
}

func quien(r *http.Request) int64 {
	s, _ := auth.SesionDe(r.Context())
	return s.IDUsuario
}
