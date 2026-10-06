package usuarios

import (
	"context"
	"fmt"
	"log/slog"
	"net/mail"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"validador-api/internal/platform/auth"
)

const minContrasena = 10

// Hash de relleno: cuando el correo no existe se compara igual contra algo,
// para que la respuesta tarde lo mismo y no delate que correos existen.
var hashRelleno, _ = bcrypt.GenerateFromPassword([]byte("relleno-no-es-una-contrasena"), bcrypt.DefaultCost)

type Service struct {
	repo   *Repository
	emisor *auth.Emisor
	ahora  func() time.Time
}

func NewService(repo *Repository, emisor *auth.Emisor) *Service {
	s := &Service{repo: repo, emisor: emisor, ahora: time.Now}
	emisor.SesionActiva = repo.SesionActiva
	return s
}

// Anotar deja un registro en la bitacora. idUsuario 0 = el sistema o un
// dispositivo. Un fallo al anotar no tumba la operacion que ya se hizo.
func (s *Service) Anotar(ctx context.Context, idUsuario int64, accion string, detalle any) {
	var id *int64
	if idUsuario > 0 {
		id = &idUsuario
	}
	if err := s.repo.Anotar(ctx, id, s.ahora(), accion, detalle); err != nil {
		slog.Error("bitacora", "accion", accion, "err", err)
	}
}

func (s *Service) Entrar(ctx context.Context, l Login, ip string) (RespuestaLogin, error) {
	correo := strings.ToLower(strings.TrimSpace(l.Correo))
	u, err := s.repo.PorCorreo(ctx, correo)
	if err != nil {
		return RespuestaLogin{}, err
	}
	hash := hashRelleno
	if u != nil {
		hash = []byte(u.hash)
	}
	coincide := bcrypt.CompareHashAndPassword(hash, []byte(l.Contrasena)) == nil
	if u == nil || !coincide || u.Estatus != Activo {
		s.Anotar(ctx, 0, "login_fallido", map[string]string{"correo": correo, "ip": ip})
		return RespuestaLogin{}, ErrCredenciales
	}

	inicio := s.ahora()
	idSesion, err := s.repo.AbrirSesion(ctx, u.ID, inicio)
	if err != nil {
		return RespuestaLogin{}, err
	}
	expira := inicio.Add(s.emisor.Duracion())
	token, err := s.emisor.Firmar(auth.Sesion{IDUsuario: u.ID, IDSesion: idSesion, Nombre: u.Nombre, Rol: u.Rol}, expira)
	if err != nil {
		return RespuestaLogin{}, err
	}
	s.Anotar(ctx, u.ID, "login", map[string]string{"ip": ip})
	return RespuestaLogin{Token: token, Expira: expira, Usuario: *u}, nil
}

func (s *Service) Salir(ctx context.Context, ses auth.Sesion) error {
	if err := s.repo.CerrarSesion(ctx, ses.IDSesion, s.ahora()); err != nil {
		return err
	}
	s.Anotar(ctx, ses.IDUsuario, "logout", nil)
	return nil
}

func (s *Service) Yo(ctx context.Context, ses auth.Sesion) (*Usuario, error) {
	return s.repo.PorID(ctx, ses.IDUsuario)
}

func (s *Service) Listar(ctx context.Context) ([]Usuario, error) { return s.repo.Listar(ctx) }

// Crear da de alta un usuario. quien es 0 cuando lo crea la consola de admin.
func (s *Service) Crear(ctx context.Context, quien int64, n NuevoUsuario) (*Usuario, error) {
	n.Nombre = strings.TrimSpace(n.Nombre)
	n.Correo = strings.ToLower(strings.TrimSpace(n.Correo))
	if n.Nombre == "" || len(n.Nombre) > 150 {
		return nil, fmt.Errorf("%w: nombre", ErrEntrada)
	}
	if _, err := mail.ParseAddress(n.Correo); err != nil || len(n.Correo) > 190 {
		return nil, fmt.Errorf("%w: correo", ErrEntrada)
	}
	if !auth.RolValido(n.Rol) {
		return nil, fmt.Errorf("%w: rol (root, admin, tecnico o user)", ErrEntrada)
	}
	hash, err := cifrar(n.Contrasena)
	if err != nil {
		return nil, err
	}
	id, err := s.repo.Crear(ctx, n, hash)
	if err != nil {
		return nil, err
	}
	s.Anotar(ctx, quien, "usuario_creado", map[string]any{"id": id, "correo": n.Correo, "rol": n.Rol})
	return s.repo.PorID(ctx, id)
}

func (s *Service) Actualizar(ctx context.Context, quien int64, id int64, c Cambios) (*Usuario, error) {
	u, err := s.repo.PorID(ctx, id)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, ErrNoExiste
	}
	antes := map[string]any{"nombre": u.Nombre, "rol": u.Rol, "estatus": u.Estatus}
	despues := map[string]any{}
	cortarSesiones := false

	if c.Nombre != nil {
		nombre := strings.TrimSpace(*c.Nombre)
		if nombre == "" || len(nombre) > 150 {
			return nil, fmt.Errorf("%w: nombre", ErrEntrada)
		}
		u.Nombre, despues["nombre"] = nombre, nombre
	}
	if c.Rol != nil {
		if !auth.RolValido(*c.Rol) {
			return nil, fmt.Errorf("%w: rol (root, admin, tecnico o user)", ErrEntrada)
		}
		u.Rol, despues["rol"], cortarSesiones = *c.Rol, *c.Rol, true
	}
	if c.Estatus != nil {
		if *c.Estatus != Activo && *c.Estatus != Inactivo {
			return nil, fmt.Errorf("%w: estatus (activo o inactivo)", ErrEntrada)
		}
		if id == quien && *c.Estatus == Inactivo {
			return nil, fmt.Errorf("%w: no puedes desactivarte a ti mismo", ErrEntrada)
		}
		u.Estatus, despues["estatus"] = *c.Estatus, *c.Estatus
		cortarSesiones = cortarSesiones || *c.Estatus == Inactivo
	}
	if c.Contrasena != nil {
		hash, err := cifrar(*c.Contrasena)
		if err != nil {
			return nil, err
		}
		u.hash, despues["contrasena"], cortarSesiones = hash, "(cambiada)", true
	}

	if err := s.repo.Actualizar(ctx, *u); err != nil {
		return nil, err
	}
	// El rol viaja en el token: si cambia, las sesiones viejas dirian otro rol.
	if cortarSesiones {
		if err := s.repo.CerrarSesionesDe(ctx, id, s.ahora()); err != nil {
			return nil, err
		}
	}
	s.Anotar(ctx, quien, "usuario_actualizado", map[string]any{"id": id, "antes": antes, "despues": despues})
	return u, nil
}

func (s *Service) Bitacora(ctx context.Context, limite int) ([]Registro, error) {
	if limite <= 0 || limite > 1000 {
		limite = 200
	}
	return s.repo.Bitacora(ctx, limite)
}

func cifrar(contrasena string) (string, error) {
	if len(contrasena) < minContrasena {
		return "", fmt.Errorf("%w: la contraseña debe tener al menos %d caracteres", ErrEntrada, minContrasena)
	}
	if len(contrasena) > 72 { // limite de bcrypt
		return "", fmt.Errorf("%w: la contraseña no puede pasar de 72 caracteres", ErrEntrada)
	}
	h, err := bcrypt.GenerateFromPassword([]byte(contrasena), bcrypt.DefaultCost)
	return string(h), err
}
