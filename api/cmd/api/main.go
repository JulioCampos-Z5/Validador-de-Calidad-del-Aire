// Comando api: la API central del Validador. Arma los modulos, enciende los
// que tienen su base configurada y deja "en proceso" a los demas.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"validador-api/internal/inventario"
	"validador-api/internal/modulo"
	"validador-api/internal/platform/auth"
	"validador-api/internal/platform/config"
	"validador-api/internal/platform/db"
	"validador-api/internal/platform/httpx"
	"validador-api/internal/puertos"
	"validador-api/internal/usuarios"
	"validador-api/internal/validacion"
)

func main() {
	if err := correr(); err != nil {
		slog.Error("la API no arranco", "err", err)
		os.Exit(1)
	}
}

func correr() error {
	cfg, err := config.Cargar()
	if err != nil {
		return err
	}
	ctx, parar := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer parar()

	registro := modulo.NuevoRegistro()
	emisor := auth.NuevoEmisor(cfg.LlaveJWT, cfg.DuracionSesion)

	// usuarios: obligatorio, sin el nadie entra.
	semadet, err := db.Abrir(ctx, cfg.DSNSemadet)
	if err != nil {
		return err
	}
	defer semadet.Close()
	if err := db.Migrar(ctx, semadet, usuarios.Migraciones()); err != nil {
		return err
	}
	usuariosSvc := usuarios.NewService(usuarios.NewRepository(semadet), emisor)
	registro.Activar(usuarios.NewHandler(usuariosSvc, emisor), "/api/usuarios/")

	// puertos: solo si tiene su base.
	if cfg.DSNPuertos != "" {
		base, err := db.Abrir(ctx, cfg.DSNPuertos)
		if err != nil {
			return err
		}
		defer base.Close()
		if err := db.Migrar(ctx, base, puertos.Migraciones()); err != nil {
			return err
		}
		svc := puertos.NewService(puertos.NewRepository(base), usuariosSvc,
			puertos.Umbrales(cfg.Umbrales), cfg.ToleranciaLatido)
		registro.Activar(puertos.NewHandler(svc, emisor, cfg.IntervaloRevision), "/api/puertos/")
	} else {
		registro.EnProceso("puertos", "/api/puertos/")
	}

	// inventario: solo si tiene su base.
	if cfg.DSNInventario != "" {
		base, err := db.Abrir(ctx, cfg.DSNInventario)
		if err != nil {
			return err
		}
		defer base.Close()
		if err := db.Migrar(ctx, base, inventario.Migraciones()); err != nil {
			return err
		}
		svc := inventario.NewService(inventario.NewRepository(base), usuariosSvc)
		registro.Activar(inventario.NewHandler(svc, emisor), "/api/inventario/")
	} else {
		registro.EnProceso("inventario", "/api/inventario/")
	}

	// validacion: puerta al backend de analisis en Python.
	if cfg.BackendAnalisis != "" {
		h, err := validacion.New(cfg.BackendAnalisis, emisor, usuariosSvc)
		if err != nil {
			return err
		}
		registro.Activar(h, "/api/analisis/")
	} else {
		registro.EnProceso("validacion", "/api/analisis/")
	}

	// Disenados, todavia sin construir (doc/ARQUITECTURA-v2.md).
	registro.EnProceso("almacen", "/api/almacen/")
	registro.EnProceso("envista", "/api/envista/")
	registro.EnProceso("ambientweather", "/api/ambient-weather/")

	mux := http.NewServeMux()
	registro.Montar(mux)
	mux.HandleFunc("GET /api/salud", func(w http.ResponseWriter, r *http.Request) {
		if err := semadet.PingContext(r.Context()); err != nil {
			httpx.Error(w, http.StatusServiceUnavailable, "sin base de usuarios")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "servicio": "validador-api"})
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		httpx.Error(w, http.StatusNotFound, "ruta no encontrada")
	})

	registro.Iniciar(ctx)

	srv := &http.Server{
		Addr:              cfg.Direccion,
		Handler:           httpx.Registro(mux),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	errSrv := make(chan error, 1)
	go func() {
		slog.Info("API escuchando", "direccion", cfg.Direccion)
		errSrv <- srv.ListenAndServe()
	}()

	select {
	case err := <-errSrv:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		slog.Info("apagando la API")
		apagar, cancelar := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancelar()
		return srv.Shutdown(apagar)
	}
	return nil
}
