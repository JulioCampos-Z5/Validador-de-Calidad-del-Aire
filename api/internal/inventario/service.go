package inventario

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"
)

// Bitacora es lo que este modulo necesita del de usuarios.
type Bitacora interface {
	Anotar(ctx context.Context, idUsuario int64, accion string, detalle any)
}

type Service struct {
	repo     *Repository
	bitacora Bitacora
	ahora    func() time.Time
}

func NewService(repo *Repository, b Bitacora) *Service {
	return &Service{repo: repo, bitacora: b, ahora: time.Now}
}

func (s *Service) Equipos(ctx context.Context) ([]Equipo, error) { return s.repo.Equipos(ctx) }
func (s *Service) Estaciones(ctx context.Context) ([]Estacion, error) {
	return s.repo.Estaciones(ctx)
}

func limpiarEquipo(d *DatosEquipo) error {
	for _, campo := range []*string{&d.NoPieza, &d.Resguardante, &d.Parametro, &d.Marca, &d.Modelo, &d.Equipo, &d.Comentarios} {
		*campo = strings.TrimSpace(*campo)
	}
	if d.NumeroSerie != nil {
		v := strings.TrimSpace(*d.NumeroSerie)
		d.NumeroSerie = &v
		if v == "" {
			d.NumeroSerie = nil // varios equipos sin serie no chocan en el UNIQUE
		}
	}
	if d.Conexion != nil {
		v := strings.TrimSpace(*d.Conexion)
		d.Conexion = &v
		if v == "" {
			d.Conexion = nil
		}
	}
	if d.Estatus == "" {
		d.Estatus = EstatusEquipo[0]
	}
	switch {
	case !slices.Contains(Tipos, d.Tipo):
		return fmt.Errorf("%w: tipo (%s)", ErrEntrada, strings.Join(Tipos, ", "))
	case !slices.Contains(EstatusEquipo, d.Estatus):
		return fmt.Errorf("%w: estatus (%s)", ErrEntrada, strings.Join(EstatusEquipo, ", "))
	case d.Conexion != nil && len(*d.Conexion) > 50:
		return fmt.Errorf("%w: la conexión no puede pasar de 50 caracteres", ErrEntrada)
	case d.AnioAdquisicion != nil && (*d.AnioAdquisicion < 1980 || *d.AnioAdquisicion > time.Now().Year()+1):
		return fmt.Errorf("%w: año de adquisición", ErrEntrada)
	case d.Equipo == "" && d.Modelo == "":
		return fmt.Errorf("%w: escribe al menos el equipo o el modelo", ErrEntrada)
	case len(d.Comentarios) > 4000:
		return fmt.Errorf("%w: comentarios demasiado largos", ErrEntrada)
	}
	for _, campo := range []string{d.NoPieza, d.Resguardante, d.Parametro, d.Marca, d.Modelo, d.Equipo} {
		if len(campo) > 150 {
			return fmt.Errorf("%w: un campo pasa de 150 caracteres", ErrEntrada)
		}
	}
	return nil
}

func (s *Service) CrearEquipo(ctx context.Context, quien int64, d DatosEquipo) (*Equipo, error) {
	if err := limpiarEquipo(&d); err != nil {
		return nil, err
	}
	id, err := s.repo.CrearEquipo(ctx, d, s.ahora())
	if err != nil {
		return nil, err
	}
	s.bitacora.Anotar(ctx, quien, "equipo_creado", map[string]any{"id": id, "datos": d})
	return s.repo.Equipo(ctx, id)
}

func (s *Service) ActualizarEquipo(ctx context.Context, quien, id int64, d DatosEquipo) (*Equipo, error) {
	if err := limpiarEquipo(&d); err != nil {
		return nil, err
	}
	antes, err := s.repo.Equipo(ctx, id)
	if err != nil {
		return nil, err
	}
	if antes == nil {
		return nil, ErrNoExiste
	}
	if err := s.repo.ActualizarEquipo(ctx, id, d, s.ahora()); err != nil {
		return nil, err
	}
	s.bitacora.Anotar(ctx, quien, "equipo_actualizado", map[string]any{"id": id, "antes": antes, "despues": d})
	return s.repo.Equipo(ctx, id)
}

// Ubicar mueve el equipo a una estacion, o a almacen con idEstacion nil.
func (s *Service) Ubicar(ctx context.Context, quien, id int64, idEstacion *int64) (*Equipo, error) {
	antes, err := s.repo.Equipo(ctx, id)
	if err != nil {
		return nil, err
	}
	if antes == nil {
		return nil, ErrNoExiste
	}
	destino := "Almacén"
	if idEstacion != nil {
		est, err := s.repo.Estacion(ctx, *idEstacion)
		if err != nil {
			return nil, err
		}
		if est == nil {
			return nil, fmt.Errorf("%w: la estación no existe", ErrEntrada)
		}
		destino = est.Nombre
	}
	origen := "Almacén"
	if antes.Estacion != nil {
		origen = *antes.Estacion
	}
	if err := s.repo.Ubicar(ctx, id, idEstacion, s.ahora()); err != nil {
		return nil, err
	}
	s.bitacora.Anotar(ctx, quien, "equipo_movido", map[string]any{"id": id, "de": origen, "a": destino})
	return s.repo.Equipo(ctx, id)
}

func (s *Service) PonerComplementos(ctx context.Context, quien, id int64, ids []int64) (*Equipo, error) {
	antes, err := s.repo.Equipo(ctx, id)
	if err != nil {
		return nil, err
	}
	if antes == nil {
		return nil, ErrNoExiste
	}
	unicos := []int64{}
	for _, c := range ids {
		if c == id {
			return nil, fmt.Errorf("%w: un equipo no puede ser complemento de sí mismo", ErrEntrada)
		}
		if !slices.Contains(unicos, c) {
			unicos = append(unicos, c)
		}
	}
	if n, err := s.repo.ContarEquipos(ctx, unicos); err != nil {
		return nil, err
	} else if n != len(unicos) {
		return nil, fmt.Errorf("%w: algún complemento no existe", ErrEntrada)
	}
	if err := s.repo.PonerComplementos(ctx, id, unicos, s.ahora()); err != nil {
		return nil, err
	}
	s.bitacora.Anotar(ctx, quien, "complementos_actualizados",
		map[string]any{"id": id, "antes": antes.Complementos, "despues": unicos})
	return s.repo.Equipo(ctx, id)
}

func limpiarEstacion(d *DatosEstacion) error {
	d.Nombre, d.Ubicacion = strings.TrimSpace(d.Nombre), strings.TrimSpace(d.Ubicacion)
	if d.Estatus == "" {
		d.Estatus = EstatusEstacion[0]
	}
	switch {
	case d.Nombre == "" || len(d.Nombre) > 100:
		return fmt.Errorf("%w: nombre", ErrEntrada)
	case len(d.Ubicacion) > 255:
		return fmt.Errorf("%w: ubicación demasiado larga", ErrEntrada)
	case !slices.Contains(EstatusEstacion, d.Estatus):
		return fmt.Errorf("%w: estatus (%s)", ErrEntrada, strings.Join(EstatusEstacion, ", "))
	}
	return nil
}

func (s *Service) CrearEstacion(ctx context.Context, quien int64, d DatosEstacion) (*Estacion, error) {
	if err := limpiarEstacion(&d); err != nil {
		return nil, err
	}
	id, err := s.repo.CrearEstacion(ctx, d)
	if err != nil {
		return nil, err
	}
	s.bitacora.Anotar(ctx, quien, "estacion_inventario_creada", map[string]any{"id": id, "datos": d})
	return s.repo.Estacion(ctx, id)
}

func (s *Service) ActualizarEstacion(ctx context.Context, quien, id int64, d DatosEstacion) (*Estacion, error) {
	if err := limpiarEstacion(&d); err != nil {
		return nil, err
	}
	antes, err := s.repo.Estacion(ctx, id)
	if err != nil {
		return nil, err
	}
	if antes == nil {
		return nil, ErrNoExiste
	}
	if err := s.repo.ActualizarEstacion(ctx, id, d); err != nil {
		return nil, err
	}
	s.bitacora.Anotar(ctx, quien, "estacion_inventario_actualizada", map[string]any{"id": id, "antes": antes, "despues": d})
	return s.repo.Estacion(ctx, id)
}
