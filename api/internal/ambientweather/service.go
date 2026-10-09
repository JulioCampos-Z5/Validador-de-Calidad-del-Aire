package ambientweather

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

var (
	ErrSinLlaves = errors.New("faltan las llaves de Ambient Weather (AMBIENT_WEATHER_API_KEY y AMBIENT_WEATHER_APPLICATION_KEY)")
	ErrOcupado   = errors.New("ya hay una descarga de historico en curso")
)

const (
	// Al arrancar se rellena desde la ultima lectura guardada, hasta este
	// tope; mas atras ya es trabajo de "Descargar historico".
	rellenoMaximo = 7 * 24 * time.Hour
	// Sin nada guardado de una estacion, el arranque trae el ultimo dia.
	rellenoInicial = 24 * time.Hour
	// Un año de lecturas cada 5 min son ~366 paginas de 288.
	maxPaginas   = 400
	maxDias      = 365
	maxTramo     = 400 * 24 * time.Hour
	maxLimite    = 5000
	puntosSerie  = 1500
	maxPuntos    = 5000
	tramoDefecto = 24 * time.Hour
)

var macValida = regexp.MustCompile(`^[0-9A-F]{2}(:[0-9A-F]{2}){5}$`)

// Cubetas posibles al agrupar: redondas, para que el eje se lea.
var cubetas = []time.Duration{
	5 * time.Minute, 10 * time.Minute, 15 * time.Minute, 30 * time.Minute,
	time.Hour, 2 * time.Hour, 3 * time.Hour, 6 * time.Hour, 12 * time.Hour, 24 * time.Hour,
}

// Bitacora es lo que este modulo necesita del de usuarios.
type Bitacora interface {
	Anotar(ctx context.Context, idUsuario int64, accion string, detalle any)
}

// fuente: lo que se usa de la API de Ambient Weather (en pruebas, un doble).
type fuente interface {
	Dispositivos(ctx context.Context) ([]DispositivoAPI, error)
	Historico(ctx context.Context, mac string, hasta time.Time, limite int) ([]map[string]any, error)
}

// almacen: lo que se usa de la base (en pruebas, un doble).
type almacen interface {
	GuardarDispositivo(ctx context.Context, d Dispositivo, info []byte) error
	GuardarLecturas(ctx context.Context, ls []Lectura) (int, error)
	UltimaFecha(ctx context.Context, mac string) (time.Time, error)
	Dispositivos(ctx context.Context) ([]Dispositivo, error)
	Lecturas(ctx context.Context, f FiltroLecturas) ([]Lectura, error)
	Contar(ctx context.Context, f FiltroLecturas) (int, error)
	ColumnasConDatos(ctx context.Context, f FiltroLecturas) ([]string, error)
	Serie(ctx context.Context, f FiltroLecturas, cubeta time.Duration) ([]Lectura, error)
}

type Service struct {
	repo      almacen
	fuente    fuente // nil: sin llaves, solo se sirve lo guardado
	intervalo time.Duration
	bitacora  Bitacora
	ahora     func() time.Time

	mu      sync.Mutex
	estado  Estado
	fondo   context.Context // vive lo que la API; las descargas cuelgan de el
	ocupado bool
}

// NewService. cliente nil = sin llaves.
func NewService(repo *Repository, cliente *Cliente, intervalo time.Duration, b Bitacora) *Service {
	s := &Service{repo: repo, intervalo: intervalo, bitacora: b, ahora: time.Now, fondo: context.Background()}
	if cliente != nil {
		s.fuente = cliente
	}
	s.estado = Estado{Llaves: cliente != nil, Intervalo: int(intervalo.Seconds())}
	return s
}

// IniciarSondeo consulta la API al arrancar y luego cada intervalo.
func (s *Service) IniciarSondeo(ctx context.Context) {
	s.mu.Lock()
	s.fondo = ctx
	s.mu.Unlock()
	if s.fuente == nil {
		slog.Warn("ambientweather sin llaves: solo se sirve lo guardado")
		return
	}
	go func() {
		s.sondear(ctx, true)
		t := time.NewTicker(s.intervalo)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.sondear(ctx, false)
			}
		}
	}()
}

// sondear trae la ultima lectura de cada estacion. En el primero, ademas,
// rellena lo que falte desde la ultima guardada (la API estuvo apagada).
func (s *Service) sondear(ctx context.Context, primero bool) {
	devs, err := s.fuente.Dispositivos(ctx)
	if err != nil {
		s.anotarError(err)
		return
	}
	for _, d := range devs {
		disp, info := infoDe(d.MacAddress, d.Info)
		if !macValida.MatchString(disp.MAC) {
			continue
		}
		if err := s.repo.GuardarDispositivo(ctx, disp, info); err != nil {
			s.anotarError(fmt.Errorf("guardar estacion %s: %w", disp.MAC, err))
			return
		}
		if primero {
			if err := s.rellenarHueco(ctx, disp.MAC); err != nil {
				slog.Warn("ambientweather: relleno al arrancar", "mac", disp.MAC, "err", err)
			}
		}
		if l, ok := Normalizar(disp.MAC, d.LastData); ok {
			if _, err := s.repo.GuardarLecturas(ctx, []Lectura{l}); err != nil {
				s.anotarError(fmt.Errorf("guardar lectura de %s: %w", disp.MAC, err))
				return
			}
		}
	}
	ahora := s.ahora().UTC()
	s.mu.Lock()
	s.estado.UltimoSondeo, s.estado.UltimoError = &ahora, ""
	s.mu.Unlock()
}

func (s *Service) anotarError(err error) {
	slog.Warn("ambientweather: sondeo", "err", err)
	s.mu.Lock()
	s.estado.UltimoError = err.Error()
	s.mu.Unlock()
}

func (s *Service) rellenarHueco(ctx context.Context, mac string) error {
	ultima, err := s.repo.UltimaFecha(ctx, mac)
	if err != nil {
		return err
	}
	desde := s.ahora().Add(-rellenoInicial)
	if !ultima.IsZero() {
		desde = s.ahora().Add(-rellenoMaximo)
		if ultima.After(desde) {
			desde = ultima
		}
	}
	_, _, err = s.rellenar(ctx, mac, desde, nil)
	return err
}

// rellenar pide el historico hacia atras, pagina por pagina, hasta pasar de
// `desde` o hasta que la API ya no tenga mas. avance se llama tras cada pagina.
func (s *Service) rellenar(ctx context.Context, mac string, desde time.Time,
	avance func(recibidas, nuevas int, llegoA time.Time)) (recibidas, nuevas int, err error) {
	var hasta time.Time // cero = desde ahora
	for pagina := 0; pagina < maxPaginas; pagina++ {
		obs, err := s.fuente.Historico(ctx, mac, hasta, MaxPorPagina)
		if err != nil {
			return recibidas, nuevas, err
		}
		ls := make([]Lectura, 0, len(obs))
		for _, o := range obs {
			if l, ok := Normalizar(mac, o); ok {
				ls = append(ls, l)
			}
		}
		if len(ls) == 0 {
			return recibidas, nuevas, nil
		}
		n, err := s.repo.GuardarLecturas(ctx, ls)
		if err != nil {
			return recibidas, nuevas, err
		}
		recibidas, nuevas = recibidas+len(ls), nuevas+n

		masVieja := ls[0].Fecha
		for _, l := range ls[1:] {
			if l.Fecha.Before(masVieja) {
				masVieja = l.Fecha
			}
		}
		if avance != nil {
			avance(recibidas, nuevas, masVieja)
		}
		if !masVieja.After(desde) || len(obs) < MaxPorPagina {
			return recibidas, nuevas, nil
		}
		// La siguiente pagina termina justo antes de la mas vieja de esta.
		hasta = masVieja.Add(-time.Millisecond)
	}
	return recibidas, nuevas, nil
}

// DescargarHistorico arranca en segundo plano la descarga de los ultimos
// `dias` de una estacion (o de todas, con mac vacia). Una a la vez: comparten
// el limite de peticiones de la llave.
func (s *Service) DescargarHistorico(ctx context.Context, quien int64, mac string, dias int) error {
	if s.fuente == nil {
		return ErrSinLlaves
	}
	if dias < 1 || dias > maxDias {
		return fmt.Errorf("%w: dias entre 1 y %d", ErrEntrada, maxDias)
	}
	mac = strings.ToUpper(strings.TrimSpace(mac))
	if mac != "" && !macValida.MatchString(mac) {
		return fmt.Errorf("%w: mac", ErrEntrada)
	}

	devs, err := s.repo.Dispositivos(ctx)
	if err != nil {
		return err
	}
	var objetivo []Dispositivo
	for _, d := range devs {
		if mac == "" || d.MAC == mac {
			objetivo = append(objetivo, d)
		}
	}
	if len(objetivo) == 0 {
		return fmt.Errorf("%w: no hay esa estacion; espera al primer sondeo", ErrEntrada)
	}

	s.mu.Lock()
	if s.ocupado {
		s.mu.Unlock()
		return ErrOcupado
	}
	s.ocupado = true
	fondo := s.fondo
	s.mu.Unlock()

	s.bitacora.Anotar(ctx, quien, "ambientweather.historico", map[string]any{"mac": mac, "dias": dias})
	go s.descargar(fondo, objetivo, dias)
	return nil
}

func (s *Service) descargar(ctx context.Context, objetivo []Dispositivo, dias int) {
	defer func() {
		s.mu.Lock()
		s.ocupado = false
		s.mu.Unlock()
	}()
	desde := s.ahora().Add(-time.Duration(dias) * 24 * time.Hour)
	for _, d := range objetivo {
		desc := &Descarga{MAC: d.MAC, Nombre: d.Nombre, Dias: dias, Estado: "descargando", Inicio: s.ahora().UTC()}
		s.ponerDescarga(desc)
		_, _, err := s.rellenar(ctx, d.MAC, desde, func(recibidas, nuevas int, llegoA time.Time) {
			s.mu.Lock()
			desc.Recibidas, desc.Nuevas, desc.LlegoA = recibidas, nuevas, &llegoA
			s.mu.Unlock()
		})
		fin := s.ahora().UTC()
		s.mu.Lock()
		desc.Fin = &fin
		if err != nil {
			desc.Estado, desc.Error = "error", err.Error()
		} else {
			desc.Estado = "terminada"
		}
		s.mu.Unlock()
		if err != nil {
			slog.Warn("ambientweather: descarga de historico", "mac", d.MAC, "err", err)
			return
		}
	}
}

func (s *Service) ponerDescarga(d *Descarga) {
	s.mu.Lock()
	s.estado.Descarga = d
	s.mu.Unlock()
}

// Estado: una copia, para que el handler no la lea mientras el job escribe.
func (s *Service) Estado() Estado {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.estado
	if e.Descarga != nil {
		copia := *e.Descarga
		e.Descarga = &copia
	}
	return e
}

func (s *Service) Dispositivos(ctx context.Context) ([]Dispositivo, error) {
	return s.repo.Dispositivos(ctx)
}

// Serie de un tramo para graficar: cruda si cabe en `puntos`; si no,
// agrupada en la cubeta redonda mas chica que deje la serie por debajo.
func (s *Service) Serie(ctx context.Context, f FiltroLecturas, puntos int) ([]Lectura, time.Duration, error) {
	if err := s.validar(&f); err != nil {
		return nil, 0, err
	}
	if puntos <= 0 {
		puntos = puntosSerie
	}
	puntos = min(puntos, maxPuntos)

	n, err := s.repo.Contar(ctx, f)
	if err != nil {
		return nil, 0, err
	}
	if n <= puntos {
		f.Limite = n
		ls, err := s.repo.Lecturas(ctx, f)
		slices.Reverse(ls)
		return ls, 0, err
	}
	cubeta := CubetaPara(f.Hasta.Sub(f.Desde), puntos)
	ls, err := s.repo.Serie(ctx, f, cubeta)
	return ls, cubeta, err
}

// CubetaPara: la cubeta redonda mas chica con la que `tramo` cabe en `puntos`.
func CubetaPara(tramo time.Duration, puntos int) time.Duration {
	for _, c := range cubetas {
		if int(tramo/c) <= puntos {
			return c
		}
	}
	return cubetas[len(cubetas)-1]
}

// Pagina de lecturas crudas de un tramo, con el total del tramo y las
// columnas que traen datos en el (para que la tabla oculte las demas).
type PaginaLecturas struct {
	Lecturas []Lectura `json:"lecturas"`
	Total    int       `json:"total"`
	Columnas []string  `json:"columnas"`
}

func (s *Service) Lecturas(ctx context.Context, f FiltroLecturas) (PaginaLecturas, error) {
	var p PaginaLecturas
	if err := s.validar(&f); err != nil {
		return p, err
	}
	if f.Orden == "fecha" {
		f.Orden = ""
	}
	if f.Orden != "" && !esColumna(f.Orden) {
		return p, fmt.Errorf("%w: orden", ErrEntrada)
	}
	if f.Pagina < 0 {
		return p, fmt.Errorf("%w: pagina", ErrEntrada)
	}
	if f.Limite <= 0 {
		f.Limite = 100
	}
	f.Limite = min(f.Limite, maxLimite)

	var err error
	if p.Total, err = s.repo.Contar(ctx, f); err != nil {
		return p, err
	}
	if p.Columnas, err = s.repo.ColumnasConDatos(ctx, f); err != nil {
		return p, err
	}
	if p.Lecturas, err = s.repo.Lecturas(ctx, f); err != nil {
		return p, err
	}
	if p.Lecturas == nil {
		p.Lecturas = []Lectura{}
	}
	return p, nil
}

func (s *Service) validar(f *FiltroLecturas) error {
	f.MAC = strings.ToUpper(strings.TrimSpace(f.MAC))
	if !macValida.MatchString(f.MAC) {
		return fmt.Errorf("%w: mac", ErrEntrada)
	}
	if f.Hasta.IsZero() {
		f.Hasta = s.ahora()
	}
	if f.Desde.IsZero() {
		f.Desde = f.Hasta.Add(-tramoDefecto)
	}
	if !f.Desde.Before(f.Hasta) {
		return fmt.Errorf("%w: desde debe ser antes que hasta", ErrEntrada)
	}
	if f.Hasta.Sub(f.Desde) > maxTramo {
		return fmt.Errorf("%w: el tramo pasa de %d dias", ErrEntrada, int(maxTramo.Hours()/24))
	}
	return nil
}
