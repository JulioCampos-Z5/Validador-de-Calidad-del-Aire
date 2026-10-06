package inventario

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/go-sql-driver/mysql"
)

// Repository es el unico que habla con la base inventario.
type Repository struct{ db *sql.DB }

func NewRepository(db *sql.DB) *Repository { return &Repository{db: db} }

const selectEquipo = `
	SELECT e.id, e.noPieza, e.resguardante, e.anioAdquisicion, e.tipo, e.parametro, e.marca,
	       e.modelo, e.equipo, e.numeroSerie, e.conexion, e.fechaUltimaActualizacion, e.estatus,
	       e.comentarios, s.id, s.nombre, c.idEquipos
	FROM equipos e
	LEFT JOIN estacion_equipo ee ON ee.idEquipo = e.id
	LEFT JOIN estaciones s ON s.id = ee.idEstacion
	LEFT JOIN complementos c ON c.idEquipo = e.id`

func escanearEquipo(s interface{ Scan(...any) error }) (Equipo, error) {
	var e Equipo
	var anio, idEst sql.NullInt64
	var serie, conexion, estacion sql.NullString
	var comps []byte
	err := s.Scan(&e.ID, &e.NoPieza, &e.Resguardante, &anio, &e.Tipo, &e.Parametro, &e.Marca,
		&e.Modelo, &e.Equipo, &serie, &conexion, &e.FechaUltimaActualizacion, &e.Estatus,
		&e.Comentarios, &idEst, &estacion, &comps)
	if err != nil {
		return e, err
	}
	if anio.Valid {
		v := int(anio.Int64)
		e.AnioAdquisicion = &v
	}
	if serie.Valid {
		e.NumeroSerie = &serie.String
	}
	if conexion.Valid {
		e.Conexion = &conexion.String
	}
	if idEst.Valid {
		e.IDEstacion = &idEst.Int64
		e.Estacion = &estacion.String
	}
	e.Complementos = []int64{}
	if len(comps) > 0 {
		_ = json.Unmarshal(comps, &e.Complementos)
	}
	return e, nil
}

func (r *Repository) Equipos(ctx context.Context) ([]Equipo, error) {
	rows, err := r.db.QueryContext(ctx, selectEquipo+` ORDER BY e.tipo, e.parametro, e.equipo, e.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var res []Equipo
	for rows.Next() {
		e, err := escanearEquipo(rows)
		if err != nil {
			return nil, err
		}
		res = append(res, e)
	}
	return res, rows.Err()
}

func (r *Repository) Equipo(ctx context.Context, id int64) (*Equipo, error) {
	e, err := escanearEquipo(r.db.QueryRowContext(ctx, selectEquipo+` WHERE e.id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

func (r *Repository) CrearEquipo(ctx context.Context, d DatosEquipo, ahora time.Time) (int64, error) {
	res, err := r.db.ExecContext(ctx, `
		INSERT INTO equipos (noPieza, resguardante, anioAdquisicion, tipo, parametro, marca, modelo,
		                     equipo, numeroSerie, conexion, fechaUltimaActualizacion, estatus, comentarios)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		d.NoPieza, d.Resguardante, d.AnioAdquisicion, d.Tipo, d.Parametro, d.Marca, d.Modelo,
		d.Equipo, d.NumeroSerie, d.Conexion, ahora.UTC(), d.Estatus, d.Comentarios)
	if esDuplicado(err) {
		return 0, ErrDuplicado
	}
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (r *Repository) ActualizarEquipo(ctx context.Context, id int64, d DatosEquipo, ahora time.Time) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE equipos SET noPieza = ?, resguardante = ?, anioAdquisicion = ?, tipo = ?, parametro = ?,
		       marca = ?, modelo = ?, equipo = ?, numeroSerie = ?, conexion = ?,
		       fechaUltimaActualizacion = ?, estatus = ?, comentarios = ?
		WHERE id = ?`,
		d.NoPieza, d.Resguardante, d.AnioAdquisicion, d.Tipo, d.Parametro, d.Marca, d.Modelo,
		d.Equipo, d.NumeroSerie, d.Conexion, ahora.UTC(), d.Estatus, d.Comentarios, id)
	if esDuplicado(err) {
		return ErrDuplicado
	}
	return err
}

// Ubicar pone el equipo en una estacion, o en almacen si idEstacion es nil.
func (r *Repository) Ubicar(ctx context.Context, idEquipo int64, idEstacion *int64, ahora time.Time) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM estacion_equipo WHERE idEquipo = ?`, idEquipo); err != nil {
		return err
	}
	if idEstacion != nil {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO estacion_equipo (idEstacion, idEquipo) VALUES (?, ?)`, *idEstacion, idEquipo); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE equipos SET fechaUltimaActualizacion = ? WHERE id = ?`, ahora.UTC(), idEquipo); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *Repository) PonerComplementos(ctx context.Context, idEquipo int64, ids []int64, ahora time.Time) error {
	b, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO complementos (idEquipo, idEquipos) VALUES (?, ?)
		ON DUPLICATE KEY UPDATE idEquipos = VALUES(idEquipos)`, idEquipo, string(b)); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE equipos SET fechaUltimaActualizacion = ? WHERE id = ?`, ahora.UTC(), idEquipo); err != nil {
		return err
	}
	return tx.Commit()
}

// ExistenEquipos dice cuantos de esos ids existen.
func (r *Repository) ContarEquipos(ctx context.Context, ids []int64) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	args := make([]any, len(ids))
	q := `SELECT COUNT(*) FROM equipos WHERE id IN (?`
	args[0] = ids[0]
	for i := 1; i < len(ids); i++ {
		q += `, ?`
		args[i] = ids[i]
	}
	var n int
	err := r.db.QueryRowContext(ctx, q+`)`, args...).Scan(&n)
	return n, err
}

func (r *Repository) Estaciones(ctx context.Context) ([]Estacion, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT s.id, s.nombre, s.ubicacion, s.estatus, COUNT(ee.id)
		FROM estaciones s LEFT JOIN estacion_equipo ee ON ee.idEstacion = s.id
		GROUP BY s.id ORDER BY s.nombre`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var res []Estacion
	for rows.Next() {
		var e Estacion
		if err := rows.Scan(&e.ID, &e.Nombre, &e.Ubicacion, &e.Estatus, &e.Equipos); err != nil {
			return nil, err
		}
		res = append(res, e)
	}
	return res, rows.Err()
}

func (r *Repository) Estacion(ctx context.Context, id int64) (*Estacion, error) {
	var e Estacion
	err := r.db.QueryRowContext(ctx, `
		SELECT s.id, s.nombre, s.ubicacion, s.estatus,
		       (SELECT COUNT(*) FROM estacion_equipo WHERE idEstacion = s.id)
		FROM estaciones s WHERE s.id = ?`, id).Scan(&e.ID, &e.Nombre, &e.Ubicacion, &e.Estatus, &e.Equipos)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

func (r *Repository) CrearEstacion(ctx context.Context, d DatosEstacion) (int64, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO estaciones (nombre, ubicacion, estatus) VALUES (?, ?, ?)`, d.Nombre, d.Ubicacion, d.Estatus)
	if esDuplicado(err) {
		return 0, ErrDuplicado
	}
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (r *Repository) ActualizarEstacion(ctx context.Context, id int64, d DatosEstacion) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE estaciones SET nombre = ?, ubicacion = ?, estatus = ? WHERE id = ?`, d.Nombre, d.Ubicacion, d.Estatus, id)
	if esDuplicado(err) {
		return ErrDuplicado
	}
	return err
}

func esDuplicado(err error) bool {
	var e *mysql.MySQLError
	return errors.As(err, &e) && e.Number == 1062
}
