// Package puertos recibe los avisos de los detectores de puertos instalados
// en las estaciones y los sirve al validador.
//
// El servidor no consulta a las estaciones: el detector avisa.
//   - Evento: un puerto se cayo o volvio, en el momento en que pasa.
//   - Latido: cada minuto, "sigo vivo" y que puertos dan datos.
//
// Una estacion sin luz o sin red no puede avisar que murio; por eso un job
// revisa los latidos y marca "sin comunicacion" a la que deja de mandarlos.
package puertos

import (
	"embed"
	"errors"
	"io/fs"
	"time"
)

//go:embed migraciones/*.sql
var migraciones embed.FS

// Migraciones devuelve los .sql de la base monitor_puertos.
func Migraciones() fs.FS {
	sub, _ := fs.Sub(migraciones, "migraciones")
	return sub
}

var (
	ErrEntrada   = errors.New("entrada invalida")
	ErrDuplicado = errors.New("ya hay una estacion con ese nombre")
)

const (
	PuertoCaido              = "puerto_caido"
	PuertoArriba             = "puerto_arriba"
	SinComunicacion          = "sin_comunicacion"
	ComunicacionRestablecida = "comunicacion_restablecida"
)

// Niveles de alerta por tiempo sin datos (doc/ARQUITECTURA-v2.md, seccion 6).
const (
	NivelNinguno  = ""
	NivelReciente = "reciente" // caido hace menos que el umbral de aviso
	NivelAviso    = "aviso"
	NivelCritico  = "critico"
	NivelIncumple = "incumple"
)

type Estacion struct {
	ID              int64      `json:"id"`
	Nombre          string     `json:"nombre"`
	Activa          bool       `json:"activa"`
	UltimoLatido    *time.Time `json:"ultimoLatido"`
	SinComunicacion bool       `json:"sinComunicacion"`
	Creado          time.Time  `json:"creado"`

	arriba  []string
	nombres map[string]string
}

// --- Lo que envia el detector ---

type Evento struct {
	UUID    string    `json:"uuid"`
	Tipo    string    `json:"tipo"`
	Clave   string    `json:"clave"`
	Nombre  string    `json:"nombre"`
	Momento time.Time `json:"momento"`
}

type EnvioEventos struct {
	Eventos []Evento `json:"eventos"`
}

type Latido struct {
	Momento time.Time         `json:"momento"`
	Arriba  []string          `json:"arriba"`
	Nombres map[string]string `json:"nombres"`
}

// --- Lo que consulta el validador ---

type EstadoPuerto struct {
	Clave  string     `json:"clave"`
	Nombre string     `json:"nombre,omitempty"`
	Estado string     `json:"estado"` // arriba · caido
	Desde  *time.Time `json:"desde,omitempty"`
	Nivel  string     `json:"nivel,omitempty"`
}

type EstadoEstacion struct {
	ID              int64          `json:"id"`
	Nombre          string         `json:"nombre"`
	UltimoLatido    *time.Time     `json:"ultimoLatido"`
	SinComunicacion bool           `json:"sinComunicacion"`
	Nivel           string         `json:"nivel,omitempty"` // de la falta de comunicacion
	Puertos         []EstadoPuerto `json:"puertos"`
}

type EventoGuardado struct {
	ID       int64     `json:"id"`
	Estacion string    `json:"estacion"`
	Tipo     string    `json:"tipo"`
	Clave    string    `json:"clave,omitempty"`
	Nombre   string    `json:"nombre,omitempty"`
	Momento  time.Time `json:"momento"`
	Recibido time.Time `json:"recibido"`
}

type FiltroEventos struct {
	Estacion string
	Desde    time.Time
	Hasta    time.Time
	Limite   int
}

// Umbrales de tiempo sin datos.
type Umbrales struct {
	Aviso    time.Duration
	Critico  time.Duration
	Incumple time.Duration
}

func (u Umbrales) Nivel(sinDatos time.Duration) string {
	switch {
	case sinDatos >= u.Incumple:
		return NivelIncumple
	case sinDatos >= u.Critico:
		return NivelCritico
	case sinDatos >= u.Aviso:
		return NivelAviso
	default:
		return NivelReciente
	}
}
