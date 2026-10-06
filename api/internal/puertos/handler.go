package puertos

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"validador-api/internal/platform/auth"
	"validador-api/internal/platform/httpx"
)

const maxCuerpo = 1 << 20

type Handler struct {
	svc       *Service
	emisor    *auth.Emisor
	intervalo time.Duration // revision de latidos
}

func NewHandler(svc *Service, emisor *auth.Emisor, intervaloRevision time.Duration) *Handler {
	return &Handler{svc: svc, emisor: emisor, intervalo: intervaloRevision}
}

func (h *Handler) Nombre() string { return "puertos" }

func (h *Handler) Iniciar(ctx context.Context) { h.svc.IniciarRevision(ctx, h.intervalo) }

// Rutas registra los dos lados del modulo:
//   - el detector avisa (token de su estacion)
//   - el validador consulta y administra (sesion con rol)
func (h *Handler) Rutas(mux *http.ServeMux) {
	todos := h.emisor.Requiere(auth.Todos)
	admins := h.emisor.Requiere(auth.Administran)

	mux.Handle("POST /api/puertos/latido", h.soloEstacion(h.latido))
	mux.Handle("POST /api/puertos/eventos", h.soloEstacion(h.eventos))

	mux.Handle("GET /api/puertos/estado", todos(http.HandlerFunc(h.estado)))
	mux.Handle("GET /api/puertos/eventos", todos(http.HandlerFunc(h.listarEventos)))
	mux.Handle("GET /api/puertos/estaciones", admins(http.HandlerFunc(h.estaciones)))
	mux.Handle("POST /api/puertos/estaciones", admins(http.HandlerFunc(h.crearEstacion)))
}

type claveEstacion struct{}

// soloEstacion resuelve que estacion envia a partir de su token. La estacion
// sale del token, nunca del cuerpo: un detector no puede escribir por otro.
func (h *Handler) soloEstacion(siguiente http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := auth.Bearer(r)
		if token == "" {
			httpx.Error(w, http.StatusUnauthorized, "falta el token de la estacion")
			return
		}
		est, err := h.svc.Autenticar(r.Context(), auth.Hash(token))
		if err != nil {
			h.fallo(w, err)
			return
		}
		if est == nil {
			httpx.Error(w, http.StatusUnauthorized, "token de estacion invalido")
			return
		}
		siguiente(w, r.WithContext(context.WithValue(r.Context(), claveEstacion{}, est)))
	})
}

func estacionDe(r *http.Request) *Estacion {
	return r.Context().Value(claveEstacion{}).(*Estacion)
}

func (h *Handler) latido(w http.ResponseWriter, r *http.Request) {
	var l Latido
	if err := httpx.Leer(w, r, maxCuerpo, &l); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.RecibirLatido(r.Context(), estacionDe(r), l); err != nil {
		h.fallo(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "servidor": time.Now().UTC()})
}

func (h *Handler) eventos(w http.ResponseWriter, r *http.Request) {
	var env EnvioEventos
	if err := httpx.Leer(w, r, maxCuerpo, &env); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	nuevos, err := h.svc.RecibirEventos(r.Context(), estacionDe(r), env)
	if err != nil {
		h.fallo(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]int{
		"recibidos": len(env.Eventos), "nuevos": nuevos, "duplicados": len(env.Eventos) - nuevos,
	})
}

func (h *Handler) estado(w http.ResponseWriter, r *http.Request) {
	est, err := h.svc.Estado(r.Context())
	if err != nil {
		h.fallo(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"estaciones": est})
}

// GET /api/puertos/eventos?estacion=&desde=RFC3339&hasta=RFC3339&limite=
func (h *Handler) listarEventos(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := FiltroEventos{Estacion: q.Get("estacion")}
	f.Limite, _ = strconv.Atoi(q.Get("limite"))
	var err error
	if f.Desde, err = fechaOpcional(q.Get("desde")); err != nil {
		httpx.Error(w, http.StatusBadRequest, "desde: usa formato RFC3339")
		return
	}
	if f.Hasta, err = fechaOpcional(q.Get("hasta")); err != nil {
		httpx.Error(w, http.StatusBadRequest, "hasta: usa formato RFC3339")
		return
	}
	evs, err := h.svc.Eventos(r.Context(), f)
	if err != nil {
		h.fallo(w, err)
		return
	}
	if evs == nil {
		evs = []EventoGuardado{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"eventos": evs})
}

func (h *Handler) estaciones(w http.ResponseWriter, r *http.Request) {
	ests, err := h.svc.Estaciones(r.Context())
	if err != nil {
		h.fallo(w, err)
		return
	}
	if ests == nil {
		ests = []Estacion{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"estaciones": ests})
}

func (h *Handler) crearEstacion(w http.ResponseWriter, r *http.Request) {
	var cuerpo struct {
		Nombre string `json:"nombre"`
	}
	if err := httpx.Leer(w, r, maxCuerpo, &cuerpo); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	token, err := auth.TokenAleatorio()
	if err != nil {
		h.fallo(w, err)
		return
	}
	ses, _ := auth.SesionDe(r.Context())
	id, err := h.svc.CrearEstacion(r.Context(), ses.IDUsuario, cuerpo.Nombre, auth.Hash(token))
	if err != nil {
		h.fallo(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{
		"id": id, "nombre": cuerpo.Nombre, "token": token,
		"aviso": "Guarda este token: no se vuelve a mostrar. Va en la configuracion del detector.",
	})
}

func (h *Handler) fallo(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrEntrada):
		httpx.Error(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrDuplicado):
		httpx.Error(w, http.StatusConflict, err.Error())
	default:
		httpx.Interno(w, "puertos", err)
	}
}

func fechaOpcional(v string) (time.Time, error) {
	if v == "" {
		return time.Time{}, nil
	}
	return time.Parse(time.RFC3339, v)
}
