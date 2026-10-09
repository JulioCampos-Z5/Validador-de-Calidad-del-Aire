package ambientweather

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"validador-api/internal/platform/db"
)

// Repository es el unico que habla con la base ambient_weather. En el
// servidor es MySQL; en la app de escritorio, SQLite. Cambian tres sentencias
// (alta de estacion, alta de lecturas y la agrupacion por cubetas).
type Repository struct {
	db     *sql.DB
	sqlite bool
}

func NewRepository(base *sql.DB) *Repository {
	return &Repository{db: base, sqlite: db.EsSQLite(base)}
}

const altaDispositivoMySQL = `
	INSERT INTO dispositivos (mac, nombre, ubicacion, lat, lon, info)
	VALUES (?, ?, ?, ?, ?, ?) AS nuevo
	ON DUPLICATE KEY UPDATE
		nombre      = IF(nuevo.nombre = '', dispositivos.nombre, nuevo.nombre),
		ubicacion   = IF(nuevo.ubicacion = '', dispositivos.ubicacion, nuevo.ubicacion),
		lat         = COALESCE(nuevo.lat, dispositivos.lat),
		lon         = COALESCE(nuevo.lon, dispositivos.lon),
		info        = nuevo.info,
		actualizado = CURRENT_TIMESTAMP(3)`

const altaDispositivoSQLite = `
	INSERT INTO dispositivos (mac, nombre, ubicacion, lat, lon, info)
	VALUES (?, ?, ?, ?, ?, ?)
	ON CONFLICT (mac) DO UPDATE SET
		nombre      = IIF(excluded.nombre = '', dispositivos.nombre, excluded.nombre),
		ubicacion   = IIF(excluded.ubicacion = '', dispositivos.ubicacion, excluded.ubicacion),
		lat         = COALESCE(excluded.lat, dispositivos.lat),
		lon         = COALESCE(excluded.lon, dispositivos.lon),
		info        = excluded.info,
		actualizado = strftime('%Y-%m-%d %H:%M:%f', 'now')`

// listaColumnas: "tempf, feelslikef, ..." en el orden de Columnas.
func listaColumnas() string {
	nombres := make([]string, len(Columnas))
	for i, c := range Columnas {
		nombres[i] = c.Nombre
	}
	return strings.Join(nombres, ", ")
}

// GuardarDispositivo da de alta o actualiza una estacion con lo que dice la
// API. El nombre no se borra si la API lo manda vacio.
func (r *Repository) GuardarDispositivo(ctx context.Context, d Dispositivo, info []byte) error {
	if len(info) == 0 {
		info = []byte("{}")
	}
	alta := altaDispositivoMySQL
	if r.sqlite {
		alta = altaDispositivoSQLite
	}
	_, err := r.db.ExecContext(ctx, alta, d.MAC, d.Nombre, d.Ubicacion, d.Lat, d.Lon, string(info))
	return err
}

// GuardarLecturas inserta en bloques e ignora las que ya estan (misma mac y
// hora). Devuelve cuantas eran nuevas.
func (r *Repository) GuardarLecturas(ctx context.Context, ls []Lectura) (int, error) {
	const porBloque = 300
	nuevas := 0
	cols := listaColumnas()
	fila := "(?, ?" + strings.Repeat(", ?", len(Columnas)) + ", ?)"
	// Ignorar las repetidas: misma idea, distinta palabra en cada motor.
	insertar := "INSERT IGNORE INTO"
	if r.sqlite {
		insertar = "INSERT OR IGNORE INTO"
	}
	for inicio := 0; inicio < len(ls); inicio += porBloque {
		bloque := ls[inicio:min(inicio+porBloque, len(ls))]
		filas := make([]string, len(bloque))
		args := make([]any, 0, len(bloque)*(len(Columnas)+3))
		for i, l := range bloque {
			filas[i] = fila
			args = append(args, l.MAC, l.Fecha.UnixMilli())
			for _, c := range Columnas {
				if v, ok := l.Valores[c.Nombre]; ok {
					args = append(args, v)
				} else {
					args = append(args, nil)
				}
			}
			crudo := l.crudo
			if len(crudo) == 0 {
				crudo = []byte("{}")
			}
			args = append(args, string(crudo))
		}
		res, err := r.db.ExecContext(ctx,
			insertar+` lecturas (mac, dateutc, `+cols+`, crudo) VALUES `+strings.Join(filas, ", "),
			args...)
		if err != nil {
			return nuevas, err
		}
		n, _ := res.RowsAffected()
		nuevas += int(n)
	}
	return nuevas, nil
}

// UltimaFecha de una estacion, o cero si no hay nada guardado.
func (r *Repository) UltimaFecha(ctx context.Context, mac string) (time.Time, error) {
	var ms sql.NullInt64
	err := r.db.QueryRowContext(ctx, `SELECT MAX(dateutc) FROM lecturas WHERE mac = ?`, mac).Scan(&ms)
	if err != nil || !ms.Valid {
		return time.Time{}, err
	}
	return time.UnixMilli(ms.Int64).UTC(), nil
}

// Dispositivos con su resumen: cuantas lecturas, la primera y la ultima.
func (r *Repository) Dispositivos(ctx context.Context) ([]Dispositivo, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT d.mac, d.nombre, d.ubicacion, d.lat, d.lon,
		       COUNT(l.dateutc), MIN(l.dateutc), MAX(l.dateutc)
		FROM dispositivos d LEFT JOIN lecturas l ON l.mac = d.mac
		GROUP BY d.mac, d.nombre, d.ubicacion, d.lat, d.lon
		ORDER BY d.nombre, d.mac`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var res []Dispositivo
	var ultimas []int64
	for rows.Next() {
		var d Dispositivo
		var lat, lon sql.NullFloat64
		var primera, ultima sql.NullInt64
		if err := rows.Scan(&d.MAC, &d.Nombre, &d.Ubicacion, &lat, &lon, &d.Lecturas, &primera, &ultima); err != nil {
			return nil, err
		}
		if lat.Valid {
			d.Lat = &lat.Float64
		}
		if lon.Valid {
			d.Lon = &lon.Float64
		}
		if primera.Valid {
			t := time.UnixMilli(primera.Int64).UTC()
			d.Primera = &t
		}
		res = append(res, d)
		ultimas = append(ultimas, ultima.Int64)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// La ultima lectura completa de cada una: es lo que el front pinta en vivo.
	for i := range res {
		if ultimas[i] == 0 {
			continue
		}
		ls, err := r.lecturas(ctx, `WHERE mac = ? AND dateutc = ?`, []any{res[i].MAC, ultimas[i]}, 1, 0)
		if err != nil {
			return nil, err
		}
		if len(ls) == 1 {
			res[i].Ultima = &ls[0]
		}
	}
	return res, nil
}

// Lecturas crudas de un tramo, una pagina, en el orden pedido. Los huecos
// van al final en cualquier direccion: ordenar por lluvia no debe empezar
// con mil filas de una estacion que no la mide.
func (r *Repository) Lecturas(ctx context.Context, f FiltroLecturas) ([]Lectura, error) {
	dir := "DESC"
	if f.Asc {
		dir = "ASC"
	}
	orden := "dateutc " + dir
	if f.Orden != "" && esColumna(f.Orden) {
		orden = fmt.Sprintf("%[1]s IS NULL, %[1]s %[2]s, dateutc DESC", f.Orden, dir)
	}
	return r.lecturas(ctx, `WHERE mac = ? AND dateutc BETWEEN ? AND ? ORDER BY `+orden,
		[]any{f.MAC, f.Desde.UnixMilli(), f.Hasta.UnixMilli()}, f.Limite, f.Pagina*f.Limite)
}

// ColumnasConDatos: las que traen al menos un valor en el tramo. Las demas
// la estacion no las mide, y en la tabla solo estorban.
func (r *Repository) ColumnasConDatos(ctx context.Context, f FiltroLecturas) ([]string, error) {
	cuentas := make([]string, len(Columnas))
	for i, c := range Columnas {
		cuentas[i] = fmt.Sprintf("COUNT(%s)", c.Nombre)
	}
	vals := make([]int64, len(Columnas))
	destinos := make([]any, len(vals))
	for i := range vals {
		destinos[i] = &vals[i]
	}
	err := r.db.QueryRowContext(ctx,
		`SELECT `+strings.Join(cuentas, ", ")+` FROM lecturas WHERE mac = ? AND dateutc BETWEEN ? AND ?`,
		f.MAC, f.Desde.UnixMilli(), f.Hasta.UnixMilli()).Scan(destinos...)
	if err != nil {
		return nil, err
	}
	res := []string{}
	for i, c := range Columnas {
		if vals[i] > 0 {
			res = append(res, c.Nombre)
		}
	}
	return res, nil
}

func (r *Repository) lecturas(ctx context.Context, donde string, args []any, limite, saltar int) ([]Lectura, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT dateutc, `+listaColumnas()+` FROM lecturas `+donde+` LIMIT ? OFFSET ?`, append(args, limite, saltar)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return escanearValores(rows)
}

// Contar las lecturas de un tramo: decide si la serie va cruda o agrupada.
func (r *Repository) Contar(ctx context.Context, f FiltroLecturas) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM lecturas WHERE mac = ? AND dateutc BETWEEN ? AND ?`,
		f.MAC, f.Desde.UnixMilli(), f.Hasta.UnixMilli()).Scan(&n)
	return n, err
}

// Serie agrupada en cubetas de `cubeta`: una fila por cubeta, con la hora de
// su inicio. Promedio para casi todo, maximo para los acumulados y promedio
// vectorial para la direccion del viento.
func (r *Repository) Serie(ctx context.Context, f FiltroLecturas, cubeta time.Duration) ([]Lectura, error) {
	ms := cubeta.Milliseconds()
	exprs := make([]string, len(Columnas))
	for i, c := range Columnas {
		switch {
		case acumulados[c.Nombre]:
			exprs[i] = fmt.Sprintf("MAX(%s)", c.Nombre)
		case angulares[c.Nombre]:
			// atan2 del promedio de los vectores unitarios, llevado a 0-360.
			exprs[i] = fmt.Sprintf(
				"MOD(DEGREES(ATAN2(AVG(SIN(RADIANS(%[1]s))), AVG(COS(RADIANS(%[1]s))))) + 360, 360)", c.Nombre)
		default:
			exprs[i] = fmt.Sprintf("AVG(%s)", c.Nombre)
		}
	}
	rows, err := r.db.QueryContext(ctx, fmt.Sprintf(`
		SELECT FLOOR(dateutc / %[1]d) * %[1]d AS t, %[2]s
		FROM lecturas
		WHERE mac = ? AND dateutc BETWEEN ? AND ?
		GROUP BY t ORDER BY t`, ms, strings.Join(exprs, ", ")),
		f.MAC, f.Desde.UnixMilli(), f.Hasta.UnixMilli())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return escanearValores(rows)
}

// escanearValores lee filas (dateutc, columnas...) en Lecturas.
func escanearValores(rows *sql.Rows) ([]Lectura, error) {
	var res []Lectura
	vals := make([]sql.NullFloat64, len(Columnas))
	destinos := make([]any, len(Columnas)+1)
	var ms float64
	destinos[0] = &ms
	for i := range vals {
		destinos[i+1] = &vals[i]
	}
	for rows.Next() {
		if err := rows.Scan(destinos...); err != nil {
			return nil, err
		}
		l := Lectura{Fecha: time.UnixMilli(int64(ms)).UTC(), Valores: map[string]float64{}}
		for i, c := range Columnas {
			if vals[i].Valid {
				l.Valores[c.Nombre] = vals[i].Float64
			}
		}
		res = append(res, l)
	}
	return res, rows.Err()
}

// infoDe extrae nombre, ubicacion y coordenadas del bloque info de la API.
func infoDe(mac string, info map[string]any) (Dispositivo, []byte) {
	d := Dispositivo{MAC: strings.ToUpper(mac)}
	if info == nil {
		return d, nil
	}
	d.Nombre, _ = info["name"].(string)
	d.Ubicacion, _ = info["location"].(string)
	// coords: { coords: { lat, lon }, location, address, ... }
	if c, ok := info["coords"].(map[string]any); ok {
		if d.Ubicacion == "" {
			d.Ubicacion, _ = c["location"].(string)
		}
		if cc, ok := c["coords"].(map[string]any); ok {
			if v, ok := numero(cc["lat"]); ok {
				d.Lat = &v
			}
			if v, ok := numero(cc["lon"]); ok {
				d.Lon = &v
			}
		}
	}
	crudo, _ := json.Marshal(info)
	return d, crudo
}
