package ambientweather

import (
	"context"
	"math"
	"path/filepath"
	"testing"
	"time"

	"validador-api/internal/platform/db"
)

// El repositorio contra SQLite de verdad (la app de escritorio): migracion,
// alta repetida, upsert de estaciones y la agrupacion con funciones
// matematicas, que en SQLite solo existen si el driver las trae.
func repoSQLite(t *testing.T) *Repository {
	t.Helper()
	ctx := context.Background()
	base, err := db.Abrir(ctx, db.PrefijoSQLite+filepath.Join(t.TempDir(), "aw.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { base.Close() })
	if err := db.Migrar(ctx, base, Migraciones()); err != nil {
		t.Fatal(err)
	}
	r := NewRepository(base)
	if !r.sqlite {
		t.Fatal("debe detectar SQLite")
	}
	return r
}

func TestSQLiteDispositivoUpsertNoBorraElNombre(t *testing.T) {
	r, ctx := repoSQLite(t), context.Background()
	lat := 20.6
	if err := r.GuardarDispositivo(ctx, Dispositivo{MAC: macPrueba, Nombre: "Azotea", Ubicacion: "La Unión", Lat: &lat}, nil); err != nil {
		t.Fatal(err)
	}
	// La API a veces manda el nombre vacio: no debe borrar el que habia.
	if err := r.GuardarDispositivo(ctx, Dispositivo{MAC: macPrueba}, []byte(`{"x":1}`)); err != nil {
		t.Fatal(err)
	}
	ds, err := r.Dispositivos(ctx)
	if err != nil || len(ds) != 1 {
		t.Fatalf("ds = %v, err = %v", ds, err)
	}
	if d := ds[0]; d.Nombre != "Azotea" || d.Ubicacion != "La Unión" || d.Lat == nil || *d.Lat != 20.6 {
		t.Errorf("estacion = %+v (los acentos y el nombre deben quedar)", d)
	}
}

func TestSQLiteLecturasRepetidasSeIgnoranYSeAgrupan(t *testing.T) {
	r, ctx := repoSQLite(t), context.Background()
	if err := r.GuardarDispositivo(ctx, Dispositivo{MAC: macPrueba, Nombre: "Azotea"}, nil); err != nil {
		t.Fatal(err)
	}
	inicio := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	var ls []Lectura
	for i := 0; i < 12; i++ { // una hora cada 5 min
		ls = append(ls, Lectura{MAC: macPrueba, Fecha: inicio.Add(time.Duration(i) * 5 * time.Minute),
			Valores: map[string]float64{"tempf": float64(70 + i), "dailyrainin": float64(i) / 100,
				// 350° y 10° alternados: el promedio vectorial es 0°, no 180°.
				"winddir": map[bool]float64{true: 350, false: 10}[i%2 == 0]}})
	}
	n, err := r.GuardarLecturas(ctx, ls)
	if err != nil || n != 12 {
		t.Fatalf("nuevas = %d, err = %v", n, err)
	}
	if n, _ := r.GuardarLecturas(ctx, ls); n != 0 {
		t.Errorf("repetidas insertadas = %d, quiero 0", n)
	}

	f := FiltroLecturas{MAC: macPrueba, Desde: inicio, Hasta: inicio.Add(time.Hour)}
	serie, err := r.Serie(ctx, f, time.Hour)
	if err != nil {
		t.Fatalf("agrupar en SQLite: %v", err)
	}
	if len(serie) != 1 {
		t.Fatalf("cubetas = %d, quiero 1", len(serie))
	}
	v := serie[0].Valores
	if math.Abs(v["tempf"]-75.5) > 1e-9 {
		t.Errorf("tempf promedio = %v, quiero 75.5", v["tempf"])
	}
	if math.Abs(v["dailyrainin"]-0.11) > 1e-9 {
		t.Errorf("lluvia del dia = %v, quiero el maximo 0.11", v["dailyrainin"])
	}
	if d := v["winddir"]; d > 0.5 && d < 359.5 {
		t.Errorf("direccion promedio = %v, quiero ~0 (promedio vectorial)", d)
	}
	if !serie[0].Fecha.Equal(inicio) {
		t.Errorf("inicio de la cubeta = %v", serie[0].Fecha)
	}

	f.Orden, f.Limite = "tempf", 3
	top, err := r.Lecturas(ctx, f)
	if err != nil || len(top) != 3 || top[0].Valores["tempf"] != 81 {
		t.Errorf("orden por tempf: %v, err = %v", top, err)
	}
	cols, err := r.ColumnasConDatos(ctx, f)
	if err != nil || len(cols) != 3 {
		t.Errorf("columnas con datos = %v, err = %v", cols, err)
	}
}
