// Package validacion es la puerta de la API hacia el backend de analisis en
// Python (Flask). El front nunca habla directo con Flask:
//
//	/api/analisis/<ruta>  ->  Flask /api/<ruta>
//
// Asi Flask queda en la red interna, se exige la misma sesion que en el resto
// de la API, y la bitacora registra quien valido o descargo que.
package validacion

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"validador-api/internal/platform/auth"
	"validador-api/internal/platform/httpx"
)

const prefijo = "/api/analisis/"

// Una descarga de un trimestre del SIMAJ o de Emisiones tarda minutos; el
// plazo general del servidor (60 s) la cortaria a media respuesta.
const plazo = 15 * time.Minute

// Bitacora es lo que este modulo necesita del de usuarios.
type Bitacora interface {
	Anotar(ctx context.Context, idUsuario int64, accion string, detalle any)
}

type Handler struct {
	emisor   *auth.Emisor
	bitacora Bitacora
	proxy    *httputil.ReverseProxy
}

func New(backend string, emisor *auth.Emisor, b Bitacora) (*Handler, error) {
	destino, err := url.Parse(strings.TrimRight(backend, "/"))
	if err != nil {
		return nil, err
	}
	p := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(destino)
			pr.Out.URL.Path = "/api/" + strings.TrimPrefix(pr.In.URL.Path, prefijo)
			pr.Out.URL.RawPath = ""
			// El token de sesion es de esta API; Flask no lo necesita.
			pr.Out.Header.Del("Authorization")
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			slog.Error("analisis: Flask no responde", "ruta", r.URL.Path, "err", err)
			httpx.Error(w, http.StatusBadGateway, "El backend de análisis (Python) no responde")
		},
	}
	return &Handler{emisor: emisor, bitacora: b, proxy: p}, nil
}

func (h *Handler) Nombre() string              { return "validacion" }
func (h *Handler) Iniciar(ctx context.Context) {}

func (h *Handler) Rutas(mux *http.ServeMux) {
	mux.Handle(prefijo, h.emisor.Requiere(auth.Todos)(http.HandlerFunc(h.reenviar)))
}

func (h *Handler) reenviar(w http.ResponseWriter, r *http.Request) {
	rc := http.NewResponseController(w)
	limite := time.Now().Add(plazo)
	_ = rc.SetReadDeadline(limite)
	_ = rc.SetWriteDeadline(limite)

	if r.Method != http.MethodGet {
		ses, _ := auth.SesionDe(r.Context())
		h.bitacora.Anotar(r.Context(), ses.IDUsuario, "analisis",
			map[string]string{"metodo": r.Method, "ruta": strings.TrimPrefix(r.URL.Path, prefijo)})
	}
	h.proxy.ServeHTTP(w, r)
}
