// Package config lee la configuracion de variables de entorno. En local
// tambien carga api/.env (sin pisar lo que ya venga del entorno), para no
// tener que exportar todo a mano.
package config

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"time"
)

type Config struct {
	Direccion      string        // donde escucha la API, ej. ":8081"
	LlaveJWT       []byte        // firma de los tokens de sesion
	DuracionSesion time.Duration // vigencia de un token de sesion
	// Vigencia si se pide «mantener la sesión iniciada».
	DuracionRecordar time.Duration

	// Cadena de conexion por base. Una base sin DSN deja su modulo
	// "en proceso": la API arranca igual y sus rutas responden 503.
	DSNSemadet    string
	DSNPuertos    string
	DSNInventario string
	DSNAmbient    string

	// Backend de analisis en Python (Flask). Vacio = validacion "en proceso".
	BackendAnalisis string

	// Ambient Weather: sin llaves el modulo sirve lo guardado pero no sondea.
	Ambient Ambient

	// Carpeta del front ya compilado (web/dist). Vacio = la API solo sirve
	// /api; con valor, sirve tambien las paginas, como en la app de
	// escritorio, donde no hay otro servidor delante.
	Estaticos string

	// Usuario que se crea si la base de usuarios esta vacia (app de
	// escritorio). Va el hash bcrypt, nunca la contrasena.
	UsuarioInicial UsuarioInicial

	// Sin latido de una estacion durante este tiempo: "sin comunicacion".
	ToleranciaLatido time.Duration
	// Cada cuanto corre la revision de estaciones.
	IntervaloRevision time.Duration

	Umbrales Umbrales
}

type UsuarioInicial struct {
	Nombre, Correo, Hash string
}

// Ambient: acceso a la API de Ambient Weather. Las dos llaves hacen falta: el
// apiKey es de la cuenta y el applicationKey lo da soporte de Ambient Weather.
type Ambient struct {
	APIKey         string
	ApplicationKey string
	URL            string        // vacio = la API real
	Intervalo      time.Duration // entre sondeos; la API publica cada minuto
}

// ConLlaves dice si hay con que consultar la API.
func (a Ambient) ConLlaves() bool { return a.APIKey != "" && a.ApplicationKey != "" }

// Umbrales de tiempo sin datos (ver doc/ARQUITECTURA-v2.md, seccion 6).
type Umbrales struct {
	Aviso    time.Duration
	Critico  time.Duration
	Incumple time.Duration
}

func Cargar() (Config, error) {
	// La app de escritorio deja su configuracion (llave de sesion, llaves de
	// Ambient Weather) en la carpeta de datos del usuario y la indica aqui.
	if ruta := os.Getenv("API_ARCHIVO_ENV"); ruta != "" {
		cargarArchivoEnv(ruta)
	}
	cargarArchivoEnv(".env")

	c := Config{
		Direccion:  valor("API_DIRECCION", ":8081"),
		LlaveJWT:   []byte(os.Getenv("API_LLAVE_JWT")),
		DSNSemadet: os.Getenv("MYSQL_DSN_SEMADET"),
		DSNPuertos: os.Getenv("MYSQL_DSN_PUERTOS"),

		DSNInventario:   os.Getenv("MYSQL_DSN_INVENTARIO"),
		DSNAmbient:      os.Getenv("MYSQL_DSN_AMBIENT_WEATHER"),
		BackendAnalisis: os.Getenv("VALIDADOR_BACKEND_URL"),
		Ambient: Ambient{
			APIKey:         os.Getenv("AMBIENT_WEATHER_API_KEY"),
			ApplicationKey: os.Getenv("AMBIENT_WEATHER_APPLICATION_KEY"),
			URL:            os.Getenv("AMBIENT_WEATHER_URL"),
		},
		Estaticos: os.Getenv("API_ESTATICOS"),
		UsuarioInicial: UsuarioInicial{
			Nombre: os.Getenv("API_USUARIO_INICIAL_NOMBRE"),
			Correo: os.Getenv("API_USUARIO_INICIAL_CORREO"),
			Hash:   os.Getenv("API_USUARIO_INICIAL_HASH"),
		},
	}

	duraciones := []struct {
		clave, porDefecto string
		destino           *time.Duration
	}{
		{"API_DURACION_SESION", "12h", &c.DuracionSesion},
		{"API_DURACION_RECORDAR", "720h", &c.DuracionRecordar},
		{"PUERTOS_TOLERANCIA_LATIDO", "3m", &c.ToleranciaLatido},
		{"PUERTOS_INTERVALO_REVISION", "1m", &c.IntervaloRevision},
		{"UMBRAL_AVISO", "1h", &c.Umbrales.Aviso},
		{"UMBRAL_CRITICO", "4h", &c.Umbrales.Critico},
		{"UMBRAL_INCUMPLE", "6h", &c.Umbrales.Incumple},
		{"AMBIENT_WEATHER_INTERVALO", "1m", &c.Ambient.Intervalo},
	}
	for _, d := range duraciones {
		v, err := time.ParseDuration(valor(d.clave, d.porDefecto))
		if err != nil {
			return c, fmt.Errorf("%s: %w", d.clave, err)
		}
		*d.destino = v
	}

	if c.DSNSemadet == "" {
		return c, fmt.Errorf("falta MYSQL_DSN_SEMADET: sin usuarios no hay quien entre")
	}
	// Ambient Weather admite una peticion por segundo por llave; menos de un
	// minuto entre sondeos no trae nada nuevo y gasta el limite.
	if c.Ambient.Intervalo < time.Minute {
		return c, fmt.Errorf("AMBIENT_WEATHER_INTERVALO: minimo 1m")
	}
	if len(c.LlaveJWT) < 32 {
		return c, fmt.Errorf("API_LLAVE_JWT debe tener al menos 32 caracteres")
	}
	return c, nil
}

func valor(clave, porDefecto string) string {
	if v := os.Getenv(clave); v != "" {
		return v
	}
	return porDefecto
}

// cargarArchivoEnv lee lineas CLAVE=valor. Lo que ya existe en el entorno
// gana: en Docker manda el entorno y el archivo ni existe.
func cargarArchivoEnv(ruta string) {
	f, err := os.Open(ruta)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		linea := strings.TrimSpace(sc.Text())
		if linea == "" || strings.HasPrefix(linea, "#") {
			continue
		}
		clave, v, ok := strings.Cut(linea, "=")
		if !ok {
			continue
		}
		clave = strings.TrimSpace(clave)
		if _, existe := os.LookupEnv(clave); !existe {
			os.Setenv(clave, strings.Trim(strings.TrimSpace(v), `"`))
		}
	}
}
