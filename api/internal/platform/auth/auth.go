// Package auth firma y valida los tokens de sesion y revisa el rol de quien
// llama. Hay dos tipos de cliente:
//
//   - Personas (validador, apps): token de sesion con su rol.
//   - Dispositivos (detector de puertos): token de estacion, que valida el
//     modulo dueño de esos datos, no este paquete.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"validador-api/internal/platform/httpx"
)

type Rol string

const (
	Root    Rol = "root"
	Admin   Rol = "admin"
	Tecnico Rol = "tecnico"
	User    Rol = "user"
)

// Grupos de roles por permiso (doc/ARQUITECTURA-v2.md, seccion 5).
// root y admin tienen los mismos permisos; solo cambia el cargo.
var (
	Todos       = []Rol{Root, Admin, Tecnico, User}
	Inventario  = []Rol{Root, Admin, Tecnico}
	Administran = []Rol{Root, Admin}
)

func RolValido(r Rol) bool {
	for _, v := range Todos {
		if r == v {
			return true
		}
	}
	return false
}

// Sesion es lo que viaja dentro del token.
type Sesion struct {
	IDUsuario int64
	IDSesion  int64
	Nombre    string
	Rol       Rol
}

// Emisor firma y valida tokens. SesionActiva lo pone el modulo de usuarios:
// asi cerrar sesion invalida el token aunque no haya expirado.
type Emisor struct {
	llave        []byte
	duracion     time.Duration
	SesionActiva func(ctx context.Context, idSesion int64) (bool, error)
}

func NuevoEmisor(llave []byte, duracion time.Duration) *Emisor {
	return &Emisor{llave: llave, duracion: duracion}
}

func (e *Emisor) Duracion() time.Duration { return e.duracion }

type claims struct {
	Nombre string `json:"nombre"`
	Rol    Rol    `json:"rol"`
	Sesion int64  `json:"sid"`
	jwt.RegisteredClaims
}

func (e *Emisor) Firmar(s Sesion, expira time.Time) (string, error) {
	c := claims{
		Nombre: s.Nombre,
		Rol:    s.Rol,
		Sesion: s.IDSesion,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatInt(s.IDUsuario, 10),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(expira),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(e.llave)
}

var ErrToken = errors.New("token invalido o vencido")

func (e *Emisor) Verificar(ctx context.Context, token string) (Sesion, error) {
	var c claims
	_, err := jwt.ParseWithClaims(token, &c, func(*jwt.Token) (any, error) { return e.llave, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithExpirationRequired())
	if err != nil {
		return Sesion{}, ErrToken
	}
	id, err := strconv.ParseInt(c.Subject, 10, 64)
	if err != nil || !RolValido(c.Rol) {
		return Sesion{}, ErrToken
	}
	if e.SesionActiva != nil {
		activa, err := e.SesionActiva(ctx, c.Sesion)
		if err != nil {
			return Sesion{}, err
		}
		if !activa {
			return Sesion{}, ErrToken
		}
	}
	return Sesion{IDUsuario: id, IDSesion: c.Sesion, Nombre: c.Nombre, Rol: c.Rol}, nil
}

type claveSesion struct{}

// Requiere deja pasar solo a quien trae un token valido con uno de los roles.
func (e *Emisor) Requiere(roles []Rol) func(http.Handler) http.Handler {
	return func(siguiente http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			s, err := e.Verificar(r.Context(), Bearer(r))
			if errors.Is(err, ErrToken) {
				httpx.Error(w, http.StatusUnauthorized, err.Error())
				return
			}
			if err != nil {
				httpx.Interno(w, "auth", err)
				return
			}
			permitido := false
			for _, rol := range roles {
				if s.Rol == rol {
					permitido = true
					break
				}
			}
			if !permitido {
				httpx.Error(w, http.StatusForbidden, "tu rol no tiene permiso para esto")
				return
			}
			siguiente.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), claveSesion{}, s)))
		})
	}
}

// SesionDe devuelve la sesion que dejo Requiere en el contexto.
func SesionDe(ctx context.Context) (Sesion, bool) {
	s, ok := ctx.Value(claveSesion{}).(Sesion)
	return s, ok
}

// Bearer extrae el token de "Authorization: Bearer <token>".
func Bearer(r *http.Request) string {
	v := r.Header.Get("Authorization")
	if len(v) > 7 && strings.EqualFold(v[:7], "bearer ") {
		return strings.TrimSpace(v[7:])
	}
	return ""
}

// Hash es lo que se guarda en la base en lugar de un token de dispositivo:
// si alguien lee la tabla no puede hacerse pasar por la estacion.
func Hash(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// TokenAleatorio genera un token de 32 bytes en hexadecimal.
func TokenAleatorio() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generar token: %w", err)
	}
	return hex.EncodeToString(b), nil
}
