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

	// Cadena de conexion por base. Una base sin DSN deja su modulo
	// "en proceso": la API arranca igual y sus rutas responden 503.
	DSNSemadet    string
	DSNPuertos    string
	DSNInventario string

	// Backend de analisis en Python (Flask). Vacio = validacion "en proceso".
	BackendAnalisis string

	// Sin latido de una estacion durante este tiempo: "sin comunicacion".
	ToleranciaLatido time.Duration
	// Cada cuanto corre la revision de estaciones.
	IntervaloRevision time.Duration

	Umbrales Umbrales
}

// Umbrales de tiempo sin datos (ver doc/ARQUITECTURA-v2.md, seccion 6).
type Umbrales struct {
	Aviso    time.Duration
	Critico  time.Duration
	Incumple time.Duration
}

func Cargar() (Config, error) {
	cargarArchivoEnv(".env")

	c := Config{
		Direccion:  valor("API_DIRECCION", ":8081"),
		LlaveJWT:   []byte(os.Getenv("API_LLAVE_JWT")),
		DSNSemadet: os.Getenv("MYSQL_DSN_SEMADET"),
		DSNPuertos: os.Getenv("MYSQL_DSN_PUERTOS"),

		DSNInventario:   os.Getenv("MYSQL_DSN_INVENTARIO"),
		BackendAnalisis: os.Getenv("VALIDADOR_BACKEND_URL"),
	}

	duraciones := []struct {
		clave, porDefecto string
		destino           *time.Duration
	}{
		{"API_DURACION_SESION", "12h", &c.DuracionSesion},
		{"PUERTOS_TOLERANCIA_LATIDO", "3m", &c.ToleranciaLatido},
		{"PUERTOS_INTERVALO_REVISION", "1m", &c.IntervaloRevision},
		{"UMBRAL_AVISO", "1h", &c.Umbrales.Aviso},
		{"UMBRAL_CRITICO", "4h", &c.Umbrales.Critico},
		{"UMBRAL_INCUMPLE", "6h", &c.Umbrales.Incumple},
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
