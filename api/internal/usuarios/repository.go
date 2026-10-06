package usuarios

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

// Repository es el unico que habla con la base semadet.
type Repository struct{ db *sql.DB }

func NewRepository(db *sql.DB) *Repository { return &Repository{db: db} }

const columnasUsuario = `id, nombre, correo, contrasena, rol, estatus, creado`

func escanearUsuario(s interface{ Scan(...any) error }) (Usuario, error) {
	var u Usuario
	err := s.Scan(&u.ID, &u.Nombre, &u.Correo, &u.hash, &u.Rol, &u.Estatus, &u.Creado)
	return u, err
}

func (r *Repository) PorCorreo(ctx context.Context, correo string) (*Usuario, error) {
	u, err := escanearUsuario(r.db.QueryRowContext(ctx,
		`SELECT `+columnasUsuario+` FROM usuarios WHERE correo = ?`, correo))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *Repository) PorID(ctx context.Context, id int64) (*Usuario, error) {
	u, err := escanearUsuario(r.db.QueryRowContext(ctx,
		`SELECT `+columnasUsuario+` FROM usuarios WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *Repository) Listar(ctx context.Context) ([]Usuario, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT `+columnasUsuario+` FROM usuarios ORDER BY nombre`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var res []Usuario
	for rows.Next() {
		u, err := escanearUsuario(rows)
		if err != nil {
			return nil, err
		}
		res = append(res, u)
	}
	return res, rows.Err()
}

func (r *Repository) Crear(ctx context.Context, n NuevoUsuario, hash string) (int64, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO usuarios (nombre, correo, contrasena, rol) VALUES (?, ?, ?, ?)`,
		n.Nombre, n.Correo, hash, n.Rol)
	if esDuplicado(err) {
		return 0, ErrDuplicado
	}
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// Actualizar guarda los campos de u (con hash ya calculado si cambio).
func (r *Repository) Actualizar(ctx context.Context, u Usuario) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE usuarios SET nombre = ?, rol = ?, estatus = ?, contrasena = ? WHERE id = ?`,
		u.Nombre, u.Rol, u.Estatus, u.hash, u.ID)
	return err
}

func (r *Repository) AbrirSesion(ctx context.Context, idUsuario int64, inicio time.Time) (int64, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO sesiones (idUsuario, fechaInicio) VALUES (?, ?)`, idUsuario, inicio.UTC())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (r *Repository) CerrarSesion(ctx context.Context, idSesion int64, fin time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE sesiones SET fechaFin = ? WHERE id = ? AND fechaFin IS NULL`, fin.UTC(), idSesion)
	return err
}

// CerrarSesionesDe corta todas las sesiones abiertas de un usuario (al
// desactivarlo, cambiarle el rol o la contrasena).
func (r *Repository) CerrarSesionesDe(ctx context.Context, idUsuario int64, fin time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE sesiones SET fechaFin = ? WHERE idUsuario = ? AND fechaFin IS NULL`, fin.UTC(), idUsuario)
	return err
}

func (r *Repository) SesionActiva(ctx context.Context, idSesion int64) (bool, error) {
	var n int
	err := r.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM sesiones s JOIN usuarios u ON u.id = s.idUsuario
		WHERE s.id = ? AND s.fechaFin IS NULL AND u.estatus = 'activo'`, idSesion).Scan(&n)
	return n > 0, err
}

func (r *Repository) Anotar(ctx context.Context, idUsuario *int64, fecha time.Time, accion string, detalle any) error {
	var d []byte
	if detalle != nil {
		var err error
		if d, err = json.Marshal(detalle); err != nil {
			return err
		}
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO bitacora (idUsuario, fecha, accion, detalle) VALUES (?, ?, ?, ?)`,
		idUsuario, fecha.UTC(), accion, nuloSiVacio(d))
	return err
}

func (r *Repository) Bitacora(ctx context.Context, limite int) ([]Registro, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT b.id, b.idUsuario, COALESCE(u.nombre, ''), b.fecha, b.accion, b.detalle
		FROM bitacora b LEFT JOIN usuarios u ON u.id = b.idUsuario
		ORDER BY b.fecha DESC, b.id DESC LIMIT ?`, limite)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var res []Registro
	for rows.Next() {
		var reg Registro
		var id sql.NullInt64
		var detalle []byte
		if err := rows.Scan(&reg.ID, &id, &reg.Usuario, &reg.Fecha, &reg.Accion, &detalle); err != nil {
			return nil, err
		}
		if id.Valid {
			reg.IDUsuario = &id.Int64
		}
		if len(detalle) > 0 {
			reg.Detalle = json.RawMessage(detalle)
		}
		res = append(res, reg)
	}
	return res, rows.Err()
}

func esDuplicado(err error) bool {
	var e *mysql.MySQLError
	return errors.As(err, &e) && e.Number == 1062
}

func nuloSiVacio(b []byte) any {
	if len(strings.TrimSpace(string(b))) == 0 {
		return nil
	}
	return string(b)
}
