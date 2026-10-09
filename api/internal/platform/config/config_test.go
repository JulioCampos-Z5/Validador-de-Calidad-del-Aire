package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Todas las variables que lee Cargar. Cada prueba arranca sin ninguna (y sin
// el .env de la carpeta: corre en un directorio temporal).
var claves = []string{
	"API_ARCHIVO_ENV", "API_DIRECCION", "API_LLAVE_JWT", "MYSQL_DSN_SEMADET", "MYSQL_DSN_PUERTOS",
	"MYSQL_DSN_INVENTARIO", "MYSQL_DSN_AMBIENT_WEATHER", "VALIDADOR_BACKEND_URL",
	"AMBIENT_WEATHER_API_KEY", "AMBIENT_WEATHER_APPLICATION_KEY", "AMBIENT_WEATHER_URL", "API_ESTATICOS",
	"API_USUARIO_INICIAL_NOMBRE", "API_USUARIO_INICIAL_CORREO", "API_USUARIO_INICIAL_HASH",
	"API_DURACION_SESION", "API_DURACION_RECORDAR", "PUERTOS_TOLERANCIA_LATIDO", "PUERTOS_INTERVALO_REVISION",
	"UMBRAL_AVISO", "UMBRAL_CRITICO", "UMBRAL_INCUMPLE", "AMBIENT_WEATHER_INTERVALO", "CLAVE_DE_PRUEBA",
}

func limpio(t *testing.T) {
	t.Helper()
	t.Chdir(t.TempDir())
	for _, k := range claves {
		t.Setenv(k, "") // registra la restauracion al terminar
		os.Unsetenv(k)
	}
}

const llave = "0123456789abcdef0123456789abcdef"

func TestCargarConLoMinimo(t *testing.T) {
	limpio(t)
	t.Setenv("MYSQL_DSN_SEMADET", "user:pass@/semadet")
	t.Setenv("API_LLAVE_JWT", llave)
	c, err := Cargar()
	if err != nil {
		t.Fatal(err)
	}
	if c.Direccion != ":8081" || c.DuracionSesion != 12*time.Hour || c.DuracionRecordar != 720*time.Hour {
		t.Errorf("por defecto: %q %v %v", c.Direccion, c.DuracionSesion, c.DuracionRecordar)
	}
	if c.Umbrales != (Umbrales{Aviso: time.Hour, Critico: 4 * time.Hour, Incumple: 6 * time.Hour}) {
		t.Errorf("umbrales = %+v (doc: 1 h / 4 h / 6 h)", c.Umbrales)
	}
	if c.Ambient.Intervalo != time.Minute || c.Ambient.ConLlaves() {
		t.Errorf("ambient = %+v", c.Ambient)
	}
	if c.DSNPuertos != "" || c.DSNInventario != "" || c.BackendAnalisis != "" {
		t.Error("sin DSN los modulos quedan en proceso")
	}
}

func TestCargarFalla(t *testing.T) {
	casos := []struct {
		nombre string
		env    map[string]string
		error  string
	}{
		{"sin usuarios", map[string]string{"API_LLAVE_JWT": llave}, "MYSQL_DSN_SEMADET"},
		{"llave corta", map[string]string{"MYSQL_DSN_SEMADET": "x", "API_LLAVE_JWT": "corta"}, "API_LLAVE_JWT"},
		{"sondeo muy seguido", map[string]string{"MYSQL_DSN_SEMADET": "x", "API_LLAVE_JWT": llave,
			"AMBIENT_WEATHER_INTERVALO": "30s"}, "minimo 1m"},
		{"duracion ilegible", map[string]string{"MYSQL_DSN_SEMADET": "x", "API_LLAVE_JWT": llave,
			"UMBRAL_AVISO": "una hora"}, "UMBRAL_AVISO"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			limpio(t)
			for k, v := range c.env {
				t.Setenv(k, v)
			}
			if _, err := Cargar(); err == nil || !strings.Contains(err.Error(), c.error) {
				t.Errorf("err = %v, quiero que mencione %q", err, c.error)
			}
		})
	}
}

func TestArchivoEnvNoPisaElEntorno(t *testing.T) {
	limpio(t)
	ruta := filepath.Join(t.TempDir(), "config.env")
	contenido := strings.Join([]string{
		"# comentario",
		"",
		"MYSQL_DSN_SEMADET=del-archivo",
		`API_LLAVE_JWT="` + llave + `"`,
		"AMBIENT_WEATHER_API_KEY = con-espacios ",
		"AMBIENT_WEATHER_APPLICATION_KEY=app",
		"linea sin igual",
		"API_DIRECCION=:9999",
	}, "\n")
	if err := os.WriteFile(ruta, []byte(contenido), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("API_ARCHIVO_ENV", ruta)
	t.Setenv("API_DIRECCION", "127.0.0.1:18081") // el entorno gana

	c, err := Cargar()
	if err != nil {
		t.Fatal(err)
	}
	if c.DSNSemadet != "del-archivo" || string(c.LlaveJWT) != llave {
		t.Errorf("del archivo: %q %q (las comillas se quitan)", c.DSNSemadet, c.LlaveJWT)
	}
	if c.Ambient.APIKey != "con-espacios" || !c.Ambient.ConLlaves() {
		t.Errorf("espacios alrededor del = y del valor: %q", c.Ambient.APIKey)
	}
	if c.Direccion != "127.0.0.1:18081" {
		t.Errorf("direccion = %q: el entorno debe ganarle al archivo", c.Direccion)
	}
}

func TestArchivoEnvInexistenteNoFalla(t *testing.T) {
	limpio(t)
	cargarArchivoEnv(filepath.Join(t.TempDir(), "no-existe.env"))
	if _, ok := os.LookupEnv("CLAVE_DE_PRUEBA"); ok {
		t.Error("no deberia definir nada")
	}
}

func TestConLlaves(t *testing.T) {
	if (Ambient{APIKey: "a"}).ConLlaves() || (Ambient{ApplicationKey: "b"}).ConLlaves() {
		t.Error("hacen falta las dos llaves")
	}
	if !(Ambient{APIKey: "a", ApplicationKey: "b"}).ConLlaves() {
		t.Error("con las dos llaves si")
	}
}
