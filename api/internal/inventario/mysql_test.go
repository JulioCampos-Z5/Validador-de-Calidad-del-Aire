package inventario

import (
	"context"
	"errors"
	"testing"

	"validador-api/internal/platform/db/dbprueba"
)

type bitacora struct{ acciones []string }

func (b *bitacora) Anotar(_ context.Context, _ int64, accion string, _ any) {
	b.acciones = append(b.acciones, accion)
}

func TestInventarioEnMySQL(t *testing.T) {
	// Inventario solo corre en MySQL: base propia y desechable (ver dbprueba).
	base := dbprueba.MySQL(t, "inventario", Migraciones())
	ctx := context.Background()
	b := &bitacora{}
	s := NewService(NewRepository(base), b)

	cen, err := s.CrearEstacion(ctx, 1, DatosEstacion{Nombre: "Centro", Ubicacion: "GDL"})
	if err != nil || cen.Nombre != "Centro" || cen.Estatus != "Disponible" || cen.Equipos != 0 {
		t.Fatalf("estacion: %+v %v", cen, err)
	}
	if _, err := s.CrearEstacion(ctx, 1, DatosEstacion{Nombre: "Centro"}); !errors.Is(err, ErrDuplicado) {
		t.Errorf("nombre repetido: %v", err)
	}

	serie := "SN-1"
	a, err := s.CrearEquipo(ctx, 1, DatosEquipo{Tipo: "Analizador", Modelo: "T400", NumeroSerie: &serie, Conexion: ptr("Modbus")})
	if err != nil || a.Estacion != nil || len(a.Complementos) != 0 {
		t.Fatalf("equipo: %+v %v (nuevo = en almacen)", a, err)
	}
	if a.Conexion == nil || *a.Conexion != "Modbus" {
		t.Errorf("conexion libre: %v", a.Conexion)
	}
	if _, err := s.CrearEquipo(ctx, 1, DatosEquipo{Tipo: "Sensor", Modelo: "X", NumeroSerie: &serie}); !errors.Is(err, ErrDuplicado) {
		t.Errorf("serie repetida: %v", err)
	}
	// Sin serie no chocan entre si.
	sin1, err1 := s.CrearEquipo(ctx, 1, DatosEquipo{Tipo: "Sensor", Equipo: "Sonda 1", NumeroSerie: ptr("")})
	sin2, err2 := s.CrearEquipo(ctx, 1, DatosEquipo{Tipo: "Sensor", Equipo: "Sonda 2"})
	if err1 != nil || err2 != nil {
		t.Fatalf("sin serie: %v %v", err1, err2)
	}

	movido, err := s.Ubicar(ctx, 1, a.ID, &cen.ID)
	if err != nil || movido.Estacion == nil || *movido.Estacion != "Centro" {
		t.Fatalf("ubicar: %+v %v", movido, err)
	}
	if es, _ := s.Estaciones(ctx); len(es) != 1 || es[0].Equipos != 1 {
		t.Errorf("la estacion cuenta sus equipos: %+v", es)
	}
	if _, err := s.Ubicar(ctx, 1, a.ID, ptr(int64(9999))); !errors.Is(err, ErrEntrada) {
		t.Errorf("estacion inexistente: %v", err)
	}
	if de, _ := s.Ubicar(ctx, 1, a.ID, nil); de.Estacion != nil {
		t.Error("nil = de vuelta al almacen")
	}

	conC, err := s.PonerComplementos(ctx, 1, a.ID, []int64{sin1.ID, sin2.ID, sin1.ID})
	if err != nil || len(conC.Complementos) != 2 {
		t.Fatalf("complementos: %+v %v (repetidos se juntan)", conC, err)
	}
	if _, err := s.PonerComplementos(ctx, 1, a.ID, []int64{a.ID}); !errors.Is(err, ErrEntrada) {
		t.Errorf("de si mismo: %v", err)
	}
	if _, err := s.PonerComplementos(ctx, 1, a.ID, []int64{9999}); !errors.Is(err, ErrEntrada) {
		t.Errorf("inexistente: %v", err)
	}

	edit, err := s.ActualizarEquipo(ctx, 1, a.ID, DatosEquipo{Tipo: "Analizador", Modelo: "T400U", Estatus: "Baja"})
	if err != nil || edit.Modelo != "T400U" || edit.Estatus != "Baja" {
		t.Errorf("actualizar: %+v %v", edit, err)
	}
	if _, err := s.ActualizarEquipo(ctx, 1, 9999, DatosEquipo{Tipo: "Otro", Modelo: "X"}); !errors.Is(err, ErrNoExiste) {
		t.Errorf("actualizar inexistente: %v", err)
	}
	if _, err := s.ActualizarEstacion(ctx, 1, 9999, DatosEstacion{Nombre: "X"}); !errors.Is(err, ErrNoExiste) {
		t.Errorf("estacion inexistente: %v", err)
	}
	if es, _ := s.Equipos(ctx); len(es) != 3 {
		t.Errorf("equipos = %d, quiero 3", len(es))
	}
	if len(b.acciones) == 0 {
		t.Error("cada cambio deja rastro en la bitacora")
	}
}
