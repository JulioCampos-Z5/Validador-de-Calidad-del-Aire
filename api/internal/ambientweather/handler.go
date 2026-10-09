package ambientweather

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"validador-api/internal/platform/auth"
	"validador-api/internal/platform/httpx"
)

const maxCuerpo = 1 << 16

type Handler struct {
	svc    *Service
	emisor *auth.Emisor
}

func NewHandler(svc *Service, emisor *auth.Emisor) *Handler {
	return &Handler{svc: svc, emisor: emisor}
}

func (h *Handler) Nombre() string { return "ambientweather" }

func (h *Handler) Iniciar(ctx context.Context) { h.svc.IniciarSondeo(ctx) }

// Rutas: ver lo guardado, cualquiera con sesion; pedir historico largo, solo
// admin (gasta el limite de peticiones de la llave durante minutos).
func (h *Handler) Rutas(mux *http.ServeMux) {
	todos := h.emisor.Requiere(auth.Todos)
	admins := h.emisor.Requiere(auth.Administran)

	mux.Handle("GET /api/ambient-weather/estado", todos(http.HandlerFunc(h.estado)))
	mux.Handle("GET /api/ambient-weather/dispositivos", todos(http.HandlerFunc(h.dispositivos)))
	mux.Handle("GET /api/ambient-weather/serie", todos(http.HandlerFunc(h.serie)))
	mux.Handle("GET /api/ambient-weather/lecturas", todos(http.HandlerFunc(h.lecturas)))
	mux.Handle("POST /api/ambient-weather/historico", admins(http.HandlerFunc(h.historico)))
}

func (h *Handler) estado(w http.ResponseWriter, _ *http.Request) {
	httpx.JSON(w, http.StatusOK, h.svc.Estado())
}

func (h *Handler) dispositivos(w http.ResponseWriter, r *http.Request) {
	ds, err := h.svc.Dispositivos(r.Context())
	if err != nil {
		h.fallo(w, err)
		return
	}
	if ds == nil {
		ds = []Dispositivo{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"dispositivos": ds})
}

// GET /api/ambient-weather/serie?mac=&desde=RFC3339&hasta=RFC3339&puntos=
func (h *Handler) serie(w http.ResponseWriter, r *http.Request) {
	f, ok := filtro(w, r)
	if !ok {
		return
	}
	puntos, _ := strconv.Atoi(r.URL.Query().Get("puntos"))
	ls, cubeta, err := h.svc.Serie(r.Context(), f, puntos)
	if err != nil {
		h.fallo(w, err)
		return
	}
	if ls == nil {
		ls = []Lectura{}
	}
	// cubetaSeg 0 = lecturas crudas; si no, cada punto resume esa cubeta.
	httpx.JSON(w, http.StatusOK, map[string]any{"lecturas": ls, "cubetaSeg": int(cubeta.Seconds())})
}

// GET /api/ambient-weather/lecturas?mac=&desde=&hasta=&limite=&pagina=&orden=&dir=asc|desc
func (h *Handler) lecturas(w http.ResponseWriter, r *http.Request) {
	f, ok := filtro(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	f.Limite, _ = strconv.Atoi(q.Get("limite"))
	f.Pagina, _ = strconv.Atoi(q.Get("pagina"))
	f.Orden = q.Get("orden")
	f.Asc = q.Get("dir") == "asc"
	p, err := h.svc.Lecturas(r.Context(), f)
	if err != nil {
		h.fallo(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, p)
}

func (h *Handler) historico(w http.ResponseWriter, r *http.Request) {
	var cuerpo struct {
		MAC  string `json:"mac"`
		Dias int    `json:"dias"`
	}
	if err := httpx.Leer(w, r, maxCuerpo, &cuerpo); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	ses, _ := auth.SesionDe(r.Context())
	if err := h.svc.DescargarHistorico(r.Context(), ses.IDUsuario, cuerpo.MAC, cuerpo.Dias); err != nil {
		h.fallo(w, err)
		return
	}
	httpx.JSON(w, http.StatusAccepted, h.svc.Estado())
}

func filtro(w http.ResponseWriter, r *http.Request) (FiltroLecturas, bool) {
	q := r.URL.Query()
	f := FiltroLecturas{MAC: q.Get("mac")}
	var err error
	if f.Desde, err = fechaOpcional(q.Get("desde")); err != nil {
		httpx.Error(w, http.StatusBadRequest, "desde: usa formato RFC3339")
		return f, false
	}
	if f.Hasta, err = fechaOpcional(q.Get("hasta")); err != nil {
		httpx.Error(w, http.StatusBadRequest, "hasta: usa formato RFC3339")
		return f, false
	}
	return f, true
}

func (h *Handler) fallo(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrEntrada):
		httpx.Error(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrSinLlaves):
		httpx.Error(w, http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, ErrOcupado):
		httpx.Error(w, http.StatusConflict, err.Error())
	default:
		httpx.Interno(w, "ambientweather", err)
	}
}

func fechaOpcional(v string) (time.Time, error) {
	if v == "" {
		return time.Time{}, nil
	}
	return time.Parse(time.RFC3339, v)
}
