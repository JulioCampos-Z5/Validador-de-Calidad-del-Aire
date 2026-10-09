// Package ambientweather trae las lecturas de las estaciones Ambient Weather
// de la cuenta y las sirve al validador.
//
// Aqui si es el servidor quien pregunta: Ambient Weather no avisa. Un job
// consulta la API cada minuto (la ultima lectura de cada estacion) y, al
// arrancar, rellena lo que falte desde la ultima guardada. La descarga de
// historico largo la pide un admin desde el front.
//
// Sin las llaves de Ambient Weather el modulo sigue activo: sirve lo que ya
// esta guardado y el estado dice que falta configurarlas.
package ambientweather

import (
	"embed"
	"errors"
	"io/fs"
	"time"
)

//go:embed migraciones/*.sql migraciones/sqlite/*.sql
var migraciones embed.FS

// Migraciones devuelve los .sql de la base ambient_weather.
func Migraciones() fs.FS {
	sub, _ := fs.Sub(migraciones, "migraciones")
	return sub
}

var ErrEntrada = errors.New("entrada invalida")

// Columna de la tabla lecturas y los nombres con que la API puede mandarla.
// Es la misma lista que usa la app de escritorio (src/main/db.ts): la API no
// siempre respeta mayusculas (feelsLike, feelslike).
type Columna struct {
	Nombre string
	Campos []string
}

var Columnas = []Columna{
	{"tempf", []string{"tempf"}},
	{"feelslikef", []string{"feelsLike", "feelslike"}},
	{"dewpointf", []string{"dewPoint", "dewpoint"}},
	{"humidity", []string{"humidity"}},
	{"baromrelin", []string{"baromrelin"}},
	{"baromabsin", []string{"baromabsin"}},
	{"windspeedmph", []string{"windspeedmph"}},
	{"windgustmph", []string{"windgustmph"}},
	{"maxdailygust", []string{"maxdailygust"}},
	{"winddir", []string{"winddir"}},
	{"winddiravg10m", []string{"winddir_avg10m"}},
	{"hourlyrainin", []string{"hourlyrainin"}},
	{"dailyrainin", []string{"dailyrainin"}},
	{"weeklyrainin", []string{"weeklyrainin"}},
	{"monthlyrainin", []string{"monthlyrainin"}},
	{"yearlyrainin", []string{"yearlyrainin"}},
	{"eventrainin", []string{"eventrainin"}},
	{"totalrainin", []string{"totalrainin"}},
	{"solarradiation", []string{"solarradiation"}},
	{"uv", []string{"uv"}},
	{"tempinf", []string{"tempinf"}},
	{"humidityin", []string{"humidityin"}},
	{"feelslikeinf", []string{"feelsLikein", "feelslikein"}},
	{"dewpointinf", []string{"dewPointin", "dewpointin"}},
	{"pm25", []string{"pm25"}},
	{"pm25_24h", []string{"pm25_24h"}},
	{"lightningday", []string{"lightning_day"}},
	{"lightningdistance", []string{"lightning_distance"}},
	{"battout", []string{"battout", "battOut"}},
}

// Acumulados: al agrupar en cubetas se toma el maximo, no el promedio. La
// lluvia del dia promediada sobre seis horas no es ninguna cantidad real.
var acumulados = map[string]bool{
	"dailyrainin": true, "weeklyrainin": true, "monthlyrainin": true, "yearlyrainin": true,
	"eventrainin": true, "totalrainin": true, "maxdailygust": true, "lightningday": true,
}

// Angulares: se promedian como vectores. El promedio de 350° y 10° es 0°, no 180°.
var angulares = map[string]bool{"winddir": true, "winddiravg10m": true}

type Dispositivo struct {
	MAC       string   `json:"mac"`
	Nombre    string   `json:"nombre"`
	Ubicacion string   `json:"ubicacion"`
	Lat       *float64 `json:"lat"`
	Lon       *float64 `json:"lon"`
	// Lo que hay guardado de esta estacion.
	Lecturas int64      `json:"lecturas"`
	Primera  *time.Time `json:"primera"`
	Ultima   *Lectura   `json:"ultima"`
}

// Lectura: una observacion. Valores solo trae los campos que llegaron; uno
// que la estacion no reporta no aparece (no es lo mismo que cero).
type Lectura struct {
	MAC     string             `json:"mac,omitempty"`
	Fecha   time.Time          `json:"fecha"`
	Valores map[string]float64 `json:"valores"`
	crudo   []byte
}

// FiltroLecturas: tramo [Desde, Hasta] de una estacion, paginado y ordenado.
type FiltroLecturas struct {
	MAC    string
	Desde  time.Time
	Hasta  time.Time
	Limite int
	Pagina int    // desde 0
	Orden  string // una de Columnas, o "" = por fecha
	Asc    bool   // por omision, de mayor a menor (lo mas reciente primero)
}

// esColumna dice si nombre es una columna de lecturas: el orden llega del
// cliente y va dentro del SQL, asi que solo se acepta lo de esta lista.
func esColumna(nombre string) bool {
	for _, c := range Columnas {
		if c.Nombre == nombre {
			return true
		}
	}
	return false
}

// Estado del sondeo y de la descarga de historico, para el front.
type Estado struct {
	Llaves       bool       `json:"llaves"`
	Intervalo    int        `json:"intervaloSeg"`
	UltimoSondeo *time.Time `json:"ultimoSondeo"`
	UltimoError  string     `json:"ultimoError,omitempty"`
	Descarga     *Descarga  `json:"descarga"`
}

// Descarga de historico en curso o la ultima que corrio.
type Descarga struct {
	MAC       string     `json:"mac"`
	Nombre    string     `json:"nombre"`
	Dias      int        `json:"dias"`
	Estado    string     `json:"estado"` // descargando, terminada, error
	Recibidas int        `json:"recibidas"`
	Nuevas    int        `json:"nuevas"`
	LlegoA    *time.Time `json:"llegoA"` // la lectura mas antigua alcanzada
	Error     string     `json:"error,omitempty"`
	Inicio    time.Time  `json:"inicio"`
	Fin       *time.Time `json:"fin"`
}
