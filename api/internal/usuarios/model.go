// Package usuarios maneja quien entra (login, roles, sesiones) y deja
// registro de quien hizo que (bitacora). Vive en la base semadet.
package usuarios

import (
	"embed"
	"errors"
	"io/fs"
	"time"

	"validador-api/internal/platform/auth"
)

//go:embed migraciones/*.sql
var migraciones embed.FS

// Migraciones devuelve los .sql de la base semadet.
func Migraciones() fs.FS {
	sub, _ := fs.Sub(migraciones, "migraciones")
	return sub
}

var (
	ErrEntrada      = errors.New("entrada invalida")
	ErrCredenciales = errors.New("Correo o contraseña incorrectos")
	ErrNoExiste     = errors.New("el usuario no existe")
	ErrDuplicado    = errors.New("ya hay un usuario con ese correo")
)

const (
	Activo   = "activo"
	Inactivo = "inactivo"
)

type Usuario struct {
	ID      int64     `json:"id"`
	Nombre  string    `json:"nombre"`
	Correo  string    `json:"correo"`
	Rol     auth.Rol  `json:"rol"`
	Estatus string    `json:"estatus"`
	Creado  time.Time `json:"creado"`

	hash string // contrasena cifrada; nunca sale en JSON
}

type NuevoUsuario struct {
	Nombre     string   `json:"nombre"`
	Correo     string   `json:"correo"`
	Contrasena string   `json:"contrasena"`
	Rol        auth.Rol `json:"rol"`
}

// Cambios: solo se toca lo que venga.
type Cambios struct {
	Nombre     *string   `json:"nombre"`
	Rol        *auth.Rol `json:"rol"`
	Estatus    *string   `json:"estatus"`
	Contrasena *string   `json:"contrasena"`
}

type Login struct {
	Correo     string `json:"correo"`
	Contrasena string `json:"contrasena"`
}

type RespuestaLogin struct {
	Token   string    `json:"token"`
	Expira  time.Time `json:"expira"`
	Usuario Usuario   `json:"usuario"`
}

type Registro struct {
	ID        int64     `json:"id"`
	IDUsuario *int64    `json:"idUsuario"`
	Usuario   string    `json:"usuario,omitempty"`
	Fecha     time.Time `json:"fecha"`
	Accion    string    `json:"accion"`
	Detalle   any       `json:"detalle,omitempty"`
}
