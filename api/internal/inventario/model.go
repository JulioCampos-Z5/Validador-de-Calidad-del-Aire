// Package inventario lleva los equipos, las estaciones donde estan y sus
// complementos. Un equipo que no esta en ninguna estacion esta en almacen.
//
// Se enciende con MYSQL_DSN_INVENTARIO; sin el queda "en proceso".
package inventario

import (
	"embed"
	"errors"
	"io/fs"
	"time"
)

//go:embed migraciones/*.sql
var migraciones embed.FS

// Migraciones devuelve los .sql de la base inventario.
func Migraciones() fs.FS {
	sub, _ := fs.Sub(migraciones, "migraciones")
	return sub
}

var (
	ErrEntrada   = errors.New("entrada invalida")
	ErrNoExiste  = errors.New("no existe")
	ErrDuplicado = errors.New("ya existe uno con ese dato")
)

// Valores de las listas del area (no inventar otros).
var (
	Tipos           = []string{"Analizador", "Monitor", "Sensor", "Calibrador", "Otro", "Datalogger", "No Break", "UPS general", "Monitor VGA"}
	EstatusEquipo   = []string{"Activo", "Activo - Requiere atención", "No Activo - Falla", "Fuera de operación", "Baja"}
	Conexiones      = []string{"TCP/IP", "RS232"} // sugerencias; se acepta texto libre
	EstatusEstacion = []string{"Disponible", "Sin Energía", "Sin Internet", "Dañada", "En Reparación", "Dada de Baja"}
)

type Equipo struct {
	ID                       int64     `json:"id"`
	NoPieza                  string    `json:"noPieza"`
	Resguardante             string    `json:"resguardante"`
	AnioAdquisicion          *int      `json:"anioAdquisicion"`
	Tipo                     string    `json:"tipo"`
	Parametro                string    `json:"parametro"`
	Marca                    string    `json:"marca"`
	Modelo                   string    `json:"modelo"`
	Equipo                   string    `json:"equipo"`
	NumeroSerie              *string   `json:"numeroSerie"`
	Conexion                 *string   `json:"conexion"`
	FechaUltimaActualizacion time.Time `json:"fechaUltimaActualizacion"`
	Estatus                  string    `json:"estatus"`
	Comentarios              string    `json:"comentarios"`

	// Calculados: donde esta y sus complementos.
	IDEstacion   *int64  `json:"idEstacion"`
	Estacion     *string `json:"estacion"` // nil = almacen
	Complementos []int64 `json:"complementos"`
}

// DatosEquipo es lo que se captura (alta y edicion).
type DatosEquipo struct {
	NoPieza         string  `json:"noPieza"`
	Resguardante    string  `json:"resguardante"`
	AnioAdquisicion *int    `json:"anioAdquisicion"`
	Tipo            string  `json:"tipo"`
	Parametro       string  `json:"parametro"`
	Marca           string  `json:"marca"`
	Modelo          string  `json:"modelo"`
	Equipo          string  `json:"equipo"`
	NumeroSerie     *string `json:"numeroSerie"`
	Conexion        *string `json:"conexion"`
	Estatus         string  `json:"estatus"`
	Comentarios     string  `json:"comentarios"`
}

type Estacion struct {
	ID        int64  `json:"id"`
	Nombre    string `json:"nombre"`
	Ubicacion string `json:"ubicacion"`
	Estatus   string `json:"estatus"`
	Equipos   int    `json:"equipos"` // cuantos tiene instalados
}

type DatosEstacion struct {
	Nombre    string `json:"nombre"`
	Ubicacion string `json:"ubicacion"`
	Estatus   string `json:"estatus"`
}
