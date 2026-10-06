package usuarios

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"validador-api/internal/platform/auth"
	"validador-api/internal/platform/httpx"
)

const maxCuerpo = 16 << 10

type Handler struct {
	svc    *Service
	emisor *auth.Emisor
}

func NewHandler(svc *Service, emisor *auth.Emisor) *Handler {
	return &Handler{svc: svc, emisor: emisor}
}

// Modulo: usuarios siempre esta activo (sin el nadie entra).
func (h *Handler) Nombre() string              { return "usuarios" }
func (h *Handler) Iniciar(ctx context.Context) {}

func (h *Handler) Rutas(mux *http.ServeMux) {
	todos := h.emisor.Requiere(auth.Todos)
	admins := h.emisor.Requiere(auth.Administran)

	mux.HandleFunc("POST /api/auth/login", h.login)
	mux.Handle("POST /api/auth/salir", todos(http.HandlerFunc(h.salir)))
	mux.Handle("GET /api/auth/yo", todos(http.HandlerFunc(h.yo)))

	mux.Handle("GET /api/usuarios", admins(http.HandlerFunc(h.listar)))
	mux.Handle("POST /api/usuarios", admins(http.HandlerFunc(h.crear)))
	mux.Handle("PATCH /api/usuarios/{id}", admins(http.HandlerFunc(h.actualizar)))
	mux.Handle("GET /api/bitacora", admins(http.HandlerFunc(h.bitacora)))
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var l Login
	if err := httpx.Leer(w, r, maxCuerpo, &l); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	res, err := h.svc.Entrar(r.Context(), l, httpx.IP(r))
	if err != nil {
		h.fallo(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (h *Handler) salir(w http.ResponseWriter, r *http.Request) {
	ses, _ := auth.SesionDe(r.Context())
	if err := h.svc.Salir(r.Context(), ses); err != nil {
		h.fallo(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) yo(w http.ResponseWriter, r *http.Request) {
	ses, _ := auth.SesionDe(r.Context())
	u, err := h.svc.Yo(r.Context(), ses)
	if err != nil {
		h.fallo(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, u)
}

func (h *Handler) listar(w http.ResponseWriter, r *http.Request) {
	us, err := h.svc.Listar(r.Context())
	if err != nil {
		h.fallo(w, err)
		return
	}
	if us == nil {
		us = []Usuario{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"usuarios": us})
}

func (h *Handler) crear(w http.ResponseWriter, r *http.Request) {
	var n NuevoUsuario
	if err := httpx.Leer(w, r, maxCuerpo, &n); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	ses, _ := auth.SesionDe(r.Context())
	u, err := h.svc.Crear(r.Context(), ses.IDUsuario, n)
	if err != nil {
		h.fallo(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, u)
}

func (h *Handler) actualizar(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "id invalido")
		return
	}
	var c Cambios
	if err := httpx.Leer(w, r, maxCuerpo, &c); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	ses, _ := auth.SesionDe(r.Context())
	u, err := h.svc.Actualizar(r.Context(), ses.IDUsuario, id, c)
	if err != nil {
		h.fallo(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, u)
}

func (h *Handler) bitacora(w http.ResponseWriter, r *http.Request) {
	limite, _ := strconv.Atoi(r.URL.Query().Get("limite"))
	regs, err := h.svc.Bitacora(r.Context(), limite)
	if err != nil {
		h.fallo(w, err)
		return
	}
	if regs == nil {
		regs = []Registro{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"registros": regs})
}

func (h *Handler) fallo(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrCredenciales):
		httpx.Error(w, http.StatusUnauthorized, err.Error())
	case errors.Is(err, ErrNoExiste):
		httpx.Error(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrDuplicado):
		httpx.Error(w, http.StatusConflict, err.Error())
	case errors.Is(err, ErrEntrada):
		httpx.Error(w, http.StatusBadRequest, err.Error())
	default:
		httpx.Interno(w, "usuarios", err)
	}
}
