package puertos

import (
	"context"
	"crypto/rand"
	"fmt"
	"log/slog"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	maxEventosPorEnvio = 1000
	maxPuertosLatido   = 500
	// Relojes de estacion adelantados: se tolera un poco, no horas.
	adelantoReloj = 5 * time.Minute
	// Lo que la bandeja del detector puede traer de atras tras una caida larga.
	atrasoMaximo = 30 * 24 * time.Hour
)

// Mismas claves que arma el detector (internal/etiquetas).
var (
	claveValida = regexp.MustCompile(`^(tcp|udp):\d{1,5}$|^com:COM\d{1,3}$`)
	uuidValido  = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

// Bitacora es lo que este modulo necesita del de usuarios.
type Bitacora interface {
	Anotar(ctx context.Context, idUsuario int64, accion string, detalle any)
}

type Service struct {
	repo       *Repository
	bitacora   Bitacora
	umbrales   Umbrales
	tolerancia time.Duration // sin latido por mas de esto: sin comunicacion
	ahora      func() time.Time
}

func NewService(repo *Repository, b Bitacora, u Umbrales, toleranciaLatido time.Duration) *Service {
	return &Service{repo: repo, bitacora: b, umbrales: u, tolerancia: toleranciaLatido, ahora: time.Now}
}

func (s *Service) Autenticar(ctx context.Context, hashToken string) (*Estacion, error) {
	return s.repo.EstacionPorToken(ctx, hashToken)
}

// CrearEstacion da de alta una estacion con el hash de su token. El token en
// claro solo lo ve quien la crea: en la base queda el hash.
func (s *Service) CrearEstacion(ctx context.Context, quien int64, nombre, hashToken string) (int64, error) {
	nombre = strings.TrimSpace(nombre)
	if nombre == "" || len(nombre) > 100 {
		return 0, fmt.Errorf("%w: nombre", ErrEntrada)
	}
	id, err := s.repo.CrearEstacion(ctx, nombre, hashToken)
	if err != nil {
		return 0, err
	}
	s.bitacora.Anotar(ctx, quien, "estacion_creada", map[string]any{"id": id, "nombre": nombre})
	return id, nil
}

func (s *Service) Estaciones(ctx context.Context) ([]Estacion, error) {
	return s.repo.Estaciones(ctx, false)
}

func (s *Service) RecibirLatido(ctx context.Context, est *Estacion, l Latido) error {
	if len(l.Arriba) > maxPuertosLatido {
		return fmt.Errorf("%w: maximo %d puertos por latido", ErrEntrada, maxPuertosLatido)
	}
	for _, c := range l.Arriba {
		if !claveValida.MatchString(c) {
			return fmt.Errorf("%w: clave %q", ErrEntrada, c)
		}
	}
	for c, n := range l.Nombres {
		if !claveValida.MatchString(c) || len(n) > 200 {
			return fmt.Errorf("%w: nombre de %q", ErrEntrada, c)
		}
	}
	restablecida, err := s.repo.GuardarLatido(ctx, est.ID, l, s.ahora(), nuevoUUID())
	if err != nil {
		return err
	}
	if restablecida {
		slog.Info("ALERTA comunicacion restablecida", "estacion", est.Nombre)
	}
	return nil
}

func (s *Service) RecibirEventos(ctx context.Context, est *Estacion, env EnvioEventos) (nuevos int, err error) {
	if len(env.Eventos) > maxEventosPorEnvio {
		return 0, fmt.Errorf("%w: maximo %d eventos por envio", ErrEntrada, maxEventosPorEnvio)
	}
	ahora := s.ahora()
	for i, e := range env.Eventos {
		switch {
		case !uuidValido.MatchString(e.UUID):
			return 0, fmt.Errorf("%w: evento %d: uuid", ErrEntrada, i)
		case e.Tipo != PuertoCaido && e.Tipo != PuertoArriba:
			return 0, fmt.Errorf("%w: evento %d: tipo %q", ErrEntrada, i, e.Tipo)
		case !claveValida.MatchString(e.Clave):
			return 0, fmt.Errorf("%w: evento %d: clave %q", ErrEntrada, i, e.Clave)
		case len(e.Nombre) > 200:
			return 0, fmt.Errorf("%w: evento %d: nombre demasiado largo", ErrEntrada, i)
		case e.Momento.After(ahora.Add(adelantoReloj)):
			return 0, fmt.Errorf("%w: evento %d: momento en el futuro (revisa el reloj de la estacion)", ErrEntrada, i)
		case e.Momento.Before(ahora.Add(-atrasoMaximo)):
			return 0, fmt.Errorf("%w: evento %d: momento de hace mas de 30 dias", ErrEntrada, i)
		}
	}
	if nuevos, err = s.repo.GuardarEventos(ctx, est.ID, env.Eventos, ahora); err != nil {
		return 0, err
	}
	for _, e := range env.Eventos {
		if e.Tipo == PuertoCaido {
			slog.Warn("ALERTA puerto sin datos", "estacion", est.Nombre, "clave", e.Clave, "nombre", e.Nombre, "desde", e.Momento)
		}
	}
	return nuevos, nil
}

// RevisarLatidos marca "sin comunicacion" a las estaciones que dejaron de
// mandar latidos. Una estacion recien creada que nunca latio cuenta desde su
// alta.
func (s *Service) RevisarLatidos(ctx context.Context) error {
	ests, err := s.repo.Estaciones(ctx, true)
	if err != nil {
		return err
	}
	ahora := s.ahora()
	for _, e := range ests {
		if e.SinComunicacion {
			continue
		}
		ultimo := e.Creado
		if e.UltimoLatido != nil {
			ultimo = *e.UltimoLatido
		}
		if ahora.Sub(ultimo) <= s.tolerancia {
			continue
		}
		marcada, err := s.repo.MarcarSinComunicacion(ctx, e.ID, nuevoUUID(), ultimo, ahora)
		if err != nil {
			return err
		}
		if marcada {
			slog.Warn("ALERTA estacion sin comunicacion", "estacion", e.Nombre, "ultimoLatido", ultimo)
		}
	}
	return nil
}

// Estado arma la foto actual de cada estacion y sus puertos, con el nivel
// de alerta segun cuanto llevan sin datos.
func (s *Service) Estado(ctx context.Context) ([]EstadoEstacion, error) {
	ests, err := s.repo.Estaciones(ctx, true)
	if err != nil {
		return nil, err
	}
	ultimos, err := s.repo.UltimosEventosPuerto(ctx)
	if err != nil {
		return nil, err
	}
	ahora := s.ahora()

	res := make([]EstadoEstacion, 0, len(ests))
	for _, e := range ests {
		ee := EstadoEstacion{
			ID: e.ID, Nombre: e.Nombre, UltimoLatido: e.UltimoLatido,
			SinComunicacion: e.SinComunicacion, Puertos: []EstadoPuerto{},
		}
		if e.SinComunicacion {
			desde := e.Creado
			if e.UltimoLatido != nil {
				desde = *e.UltimoLatido
			}
			ee.Nivel = s.umbrales.Nivel(ahora.Sub(desde))
		}

		arriba := map[string]bool{}
		for _, c := range e.arriba {
			arriba[c] = true
		}
		claves := map[string]bool{}
		for c := range arriba {
			claves[c] = true
		}
		for c := range ultimos[e.ID] {
			claves[c] = true
		}

		for c := range claves {
			ev, hayEvento := ultimos[e.ID][c]
			var ultimo *Evento
			if hayEvento {
				ultimo = &ev
			}
			p := estadoPuerto(c, arriba[c], ultimo, e.UltimoLatido, ahora, s.umbrales)
			if n := e.nombres[c]; n != "" {
				p.Nombre = n
			}
			ee.Puertos = append(ee.Puertos, p)
		}
		sort.Slice(ee.Puertos, func(a, b int) bool {
			// Lo que necesita atencion primero.
			if (ee.Puertos[a].Estado == "caido") != (ee.Puertos[b].Estado == "caido") {
				return ee.Puertos[a].Estado == "caido"
			}
			return ee.Puertos[a].Clave < ee.Puertos[b].Clave
		})
		res = append(res, ee)
	}
	return res, nil
}

// estadoPuerto decide el estado de un puerto con lo que se sabe de el: si el
// ultimo latido lo trae arriba y cual fue su ultimo evento. Gana lo mas
// reciente: un evento que llega de la bandeja tras una caida del servidor
// puede ser posterior al ultimo latido guardado.
func estadoPuerto(clave string, enLatido bool, ultimo *Evento, ultimoLatido *time.Time, ahora time.Time, u Umbrales) EstadoPuerto {
	p := EstadoPuerto{Clave: clave}
	if ultimo != nil {
		p.Nombre = ultimo.Nombre
	}
	caidoDesde := func(t time.Time) {
		p.Estado, p.Desde, p.Nivel = "caido", &t, u.Nivel(ahora.Sub(t))
	}
	eventoMasNuevo := ultimo != nil && (ultimoLatido == nil || ultimo.Momento.After(*ultimoLatido))
	switch {
	case eventoMasNuevo && ultimo.Tipo == PuertoCaido:
		caidoDesde(ultimo.Momento)
	case eventoMasNuevo && ultimo.Tipo == PuertoArriba:
		p.Estado, p.Desde = "arriba", &ultimo.Momento
	case enLatido:
		p.Estado = "arriba"
		if ultimo != nil && ultimo.Tipo == PuertoArriba {
			p.Desde = &ultimo.Momento
		}
	case ultimo != nil && ultimo.Tipo == PuertoCaido:
		caidoDesde(ultimo.Momento)
	default:
		// El latido ya no lo trae pero el evento de caida aun no llega:
		// caido sin "desde" hasta que llegue.
		p.Estado = "caido"
	}
	return p
}

func (s *Service) Eventos(ctx context.Context, f FiltroEventos) ([]EventoGuardado, error) {
	if f.Hasta.IsZero() {
		f.Hasta = s.ahora()
	}
	if f.Desde.IsZero() {
		f.Desde = f.Hasta.Add(-24 * time.Hour)
	}
	if f.Hasta.Before(f.Desde) {
		return nil, fmt.Errorf("%w: desde es posterior a hasta", ErrEntrada)
	}
	if f.Limite <= 0 || f.Limite > 1000 {
		f.Limite = 200
	}
	return s.repo.Eventos(ctx, f)
}

// IniciarRevision corre RevisarLatidos cada intervalo hasta que ctx termine.
func (s *Service) IniciarRevision(ctx context.Context, intervalo time.Duration) {
	go func() {
		t := time.NewTicker(intervalo)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if err := s.RevisarLatidos(ctx); err != nil {
					slog.Error("revision de latidos", "err", err)
				}
			}
		}
	}()
}

// nuevoUUID genera un UUID v4 para los eventos que crea la propia API.
func nuevoUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
