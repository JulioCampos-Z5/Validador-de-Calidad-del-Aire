// Package httpx reune lo que repiten todos los handlers: responder JSON,
// leer el cuerpo con limite y registrar cada peticion.
package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"
)

func JSON(w http.ResponseWriter, estado int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(estado)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("respuesta JSON", "err", err)
	}
}

// Error responde siempre con la misma forma: {"error": "..."}.
func Error(w http.ResponseWriter, estado int, mensaje string) {
	JSON(w, estado, map[string]string{"error": mensaje})
}

// Interno registra el detalle y al cliente solo le dice "error interno".
func Interno(w http.ResponseWriter, donde string, err error) {
	slog.Error(donde, "err", err)
	Error(w, http.StatusInternalServerError, "error interno")
}

// Leer decodifica el cuerpo rechazando campos desconocidos y cuerpos mayores
// a maxBytes: un cliente con un contrato viejo falla claro en vez de perder
// datos en silencio.
func Leer(w http.ResponseWriter, r *http.Request, maxBytes int64, destino any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(destino); err != nil {
		var demasiado *http.MaxBytesError
		if errors.As(err, &demasiado) {
			return fmt.Errorf("el cuerpo pasa de %d bytes", maxBytes)
		}
		return fmt.Errorf("JSON invalido: %w", err)
	}
	return nil
}

// IP del cliente. Sin proxy delante, la del socket; X-Forwarded-For se
// ignora a proposito porque cualquiera lo puede inventar.
func IP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// Registro anota metodo, ruta, estado y duracion de cada peticion, y convierte
// un panic en un 500 en vez de tirar la conexion.
func Registro(siguiente http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		inicio := time.Now()
		rw := &respuesta{ResponseWriter: w, estado: http.StatusOK}
		defer func() {
			if p := recover(); p != nil {
				slog.Error("panic", "ruta", r.URL.Path, "valor", p)
				if !rw.escrito {
					Error(rw, http.StatusInternalServerError, "error interno")
				}
			}
			slog.Info("http", "metodo", r.Method, "ruta", r.URL.Path,
				"estado", rw.estado, "ms", time.Since(inicio).Milliseconds())
		}()
		siguiente.ServeHTTP(rw, r)
	})
}

type respuesta struct {
	http.ResponseWriter
	estado  int
	escrito bool
}

func (r *respuesta) WriteHeader(estado int) {
	r.estado, r.escrito = estado, true
	r.ResponseWriter.WriteHeader(estado)
}

// Unwrap deja que http.ResponseController llegue al writer real (lo usa el
// proxy de analisis para alargar el plazo de escritura).
func (r *respuesta) Unwrap() http.ResponseWriter { return r.ResponseWriter }

// Flush deja pasar el streaming (SSE) a traves del envoltorio.
func (r *respuesta) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
