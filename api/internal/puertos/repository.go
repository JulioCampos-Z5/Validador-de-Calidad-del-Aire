package puertos

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

// Repository es el unico que habla con la base monitor_puertos.
type Repository struct{ db *sql.DB }

func NewRepository(db *sql.DB) *Repository { return &Repository{db: db} }

const columnasEstacion = `id, nombre, activa, ultimoLatido, sinComunicacion, creado, puertosArriba, nombresPuertos`

func escanearEstacion(s interface{ Scan(...any) error }) (Estacion, error) {
	var e Estacion
	var latido sql.NullTime
	var arriba, nombres []byte
	if err := s.Scan(&e.ID, &e.Nombre, &e.Activa, &latido, &e.SinComunicacion, &e.Creado, &arriba, &nombres); err != nil {
		return e, err
	}
	if latido.Valid {
		e.UltimoLatido = &latido.Time
	}
	if len(arriba) > 0 {
		_ = json.Unmarshal(arriba, &e.arriba)
	}
	if len(nombres) > 0 {
		_ = json.Unmarshal(nombres, &e.nombres)
	}
	return e, nil
}

func (r *Repository) EstacionPorToken(ctx context.Context, hash string) (*Estacion, error) {
	e, err := escanearEstacion(r.db.QueryRowContext(ctx,
		`SELECT `+columnasEstacion+` FROM estaciones WHERE tokenHash = ? AND activa`, hash))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

func (r *Repository) Estaciones(ctx context.Context, soloActivas bool) ([]Estacion, error) {
	q := `SELECT ` + columnasEstacion + ` FROM estaciones`
	if soloActivas {
		q += ` WHERE activa`
	}
	rows, err := r.db.QueryContext(ctx, q+` ORDER BY nombre`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var res []Estacion
	for rows.Next() {
		e, err := escanearEstacion(rows)
		if err != nil {
			return nil, err
		}
		res = append(res, e)
	}
	return res, rows.Err()
}

func (r *Repository) CrearEstacion(ctx context.Context, nombre, hash string) (int64, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO estaciones (nombre, tokenHash) VALUES (?, ?)`, nombre, hash)
	var e *mysql.MySQLError
	if errors.As(err, &e) && e.Number == 1062 {
		return 0, ErrDuplicado
	}
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// GuardarLatido anota el latido y, si la estacion estaba sin comunicacion, la
// marca de vuelta y deja el evento. Devuelve si se restablecio.
func (r *Repository) GuardarLatido(ctx context.Context, idEstacion int64, l Latido, recibido time.Time, uuidRestablecida string) (bool, error) {
	arriba, err := json.Marshal(l.Arriba)
	if err != nil {
		return false, err
	}
	nombres, err := json.Marshal(l.Nombres)
	if err != nil {
		return false, err
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	var estabaSin bool
	if err := tx.QueryRowContext(ctx,
		`SELECT sinComunicacion FROM estaciones WHERE id = ? FOR UPDATE`, idEstacion).Scan(&estabaSin); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE estaciones
		SET ultimoLatido = ?, puertosArriba = ?, nombresPuertos = ?, sinComunicacion = FALSE
		WHERE id = ?`, recibido.UTC(), string(arriba), string(nombres), idEstacion); err != nil {
		return false, err
	}
	if estabaSin {
		if err := insertarEvento(ctx, tx, idEstacion, Evento{
			UUID: uuidRestablecida, Tipo: ComunicacionRestablecida, Momento: recibido,
		}, recibido); err != nil {
			return false, err
		}
	}
	return estabaSin, tx.Commit()
}

// GuardarEventos inserta los eventos ignorando los uuid ya recibidos.
// Devuelve cuantos eran nuevos.
func (r *Repository) GuardarEventos(ctx context.Context, idEstacion int64, evs []Evento, recibido time.Time) (int, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	nuevos := 0
	for _, e := range evs {
		res, err := tx.ExecContext(ctx, `
			INSERT IGNORE INTO eventos (uuid, idEstacion, tipo, clave, nombre, momento, recibido)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			e.UUID, idEstacion, e.Tipo, nuloSiVacio(e.Clave), e.Nombre, e.Momento.UTC(), recibido.UTC())
		if err != nil {
			return 0, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			nuevos++
		}
	}
	return nuevos, tx.Commit()
}

// MarcarSinComunicacion marca la estacion y deja el evento, solo si seguia
// marcada como comunicada (asi dos revisiones seguidas no duplican el aviso).
func (r *Repository) MarcarSinComunicacion(ctx context.Context, idEstacion int64, uuid string, momento, ahora time.Time) (bool, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx,
		`UPDATE estaciones SET sinComunicacion = TRUE WHERE id = ? AND NOT sinComunicacion`, idEstacion)
	if err != nil {
		return false, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return false, nil
	}
	if err := insertarEvento(ctx, tx, idEstacion, Evento{UUID: uuid, Tipo: SinComunicacion, Momento: momento}, ahora); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

// UltimosEventosPuerto devuelve el ultimo evento caido/arriba de cada puerto
// de cada estacion: es lo que da el "desde cuando" del estado.
func (r *Repository) UltimosEventosPuerto(ctx context.Context) (map[int64]map[string]Evento, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT e.idEstacion, e.clave, e.tipo, e.nombre, e.momento
		FROM eventos e
		JOIN (
			SELECT idEstacion, clave, MAX(momento) AS momento
			FROM eventos
			WHERE clave IS NOT NULL
			GROUP BY idEstacion, clave
		) u ON u.idEstacion = e.idEstacion AND u.clave = e.clave AND u.momento = e.momento`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	res := map[int64]map[string]Evento{}
	for rows.Next() {
		var id int64
		var e Evento
		if err := rows.Scan(&id, &e.Clave, &e.Tipo, &e.Nombre, &e.Momento); err != nil {
			return nil, err
		}
		if res[id] == nil {
			res[id] = map[string]Evento{}
		}
		res[id][e.Clave] = e
	}
	return res, rows.Err()
}

func (r *Repository) Eventos(ctx context.Context, f FiltroEventos) ([]EventoGuardado, error) {
	var q strings.Builder
	q.WriteString(`
		SELECT e.id, s.nombre, e.tipo, COALESCE(e.clave, ''), e.nombre, e.momento, e.recibido
		FROM eventos e JOIN estaciones s ON s.id = e.idEstacion
		WHERE e.momento BETWEEN ? AND ?`)
	args := []any{f.Desde.UTC(), f.Hasta.UTC()}
	if f.Estacion != "" {
		q.WriteString(` AND s.nombre = ?`)
		args = append(args, f.Estacion)
	}
	q.WriteString(` ORDER BY e.momento DESC, e.id DESC LIMIT ?`)
	args = append(args, f.Limite)

	rows, err := r.db.QueryContext(ctx, q.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var res []EventoGuardado
	for rows.Next() {
		var e EventoGuardado
		if err := rows.Scan(&e.ID, &e.Estacion, &e.Tipo, &e.Clave, &e.Nombre, &e.Momento, &e.Recibido); err != nil {
			return nil, err
		}
		res = append(res, e)
	}
	return res, rows.Err()
}

func insertarEvento(ctx context.Context, tx *sql.Tx, idEstacion int64, e Evento, recibido time.Time) error {
	_, err := tx.ExecContext(ctx, `
		INSERT IGNORE INTO eventos (uuid, idEstacion, tipo, clave, nombre, momento, recibido)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		e.UUID, idEstacion, e.Tipo, nuloSiVacio(e.Clave), e.Nombre, e.Momento.UTC(), recibido.UTC())
	return err
}

func nuloSiVacio(s string) any {
	if s == "" {
		return nil
	}
	return s
}
