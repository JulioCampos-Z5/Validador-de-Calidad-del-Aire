package inventario

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"validador-api/internal/platform/auth"
)

func ptr[T any](v T) *T { return &v }

func TestLimpiarEquipo(t *testing.T) {
	base := func() DatosEquipo { return DatosEquipo{Tipo: "Analizador", Modelo: "T400"} }

	d := base()
	d.Marca, d.NumeroSerie, d.Conexion = "  Teledyne ", ptr("  "), ptr(" TCP/IP ")
	if err := limpiarEquipo(&d); err != nil {
		t.Fatal(err)
	}
	if d.Marca != "Teledyne" || d.NumeroSerie != nil || *d.Conexion != "TCP/IP" || d.Estatus != "Activo" {
		t.Errorf("limpio = %+v (serie vacia -> nil, estatus por defecto Activo)", d)
	}

	malos := map[string]func(*DatosEquipo){
		"tipo inventado":       func(d *DatosEquipo) { d.Tipo = "Tostador" },
		"estatus inventado":    func(d *DatosEquipo) { d.Estatus = "Perdido" },
		"conexion larga":       func(d *DatosEquipo) { d.Conexion = ptr(strings.Repeat("x", 51)) },
		"año viejo":            func(d *DatosEquipo) { d.AnioAdquisicion = ptr(1979) },
		"año futuro":           func(d *DatosEquipo) { d.AnioAdquisicion = ptr(time.Now().Year() + 2) },
		"sin equipo ni modelo": func(d *DatosEquipo) { d.Modelo = "  " },
		"comentarios enormes":  func(d *DatosEquipo) { d.Comentarios = strings.Repeat("x", 4001) },
		"campo de mas de 150":  func(d *DatosEquipo) { d.Resguardante = strings.Repeat("x", 151) },
	}
	for nombre, romper := range malos {
		d := base()
		romper(&d)
		if err := limpiarEquipo(&d); !errors.Is(err, ErrEntrada) {
			t.Errorf("%s: err = %v, quiero ErrEntrada", nombre, err)
		}
	}

	d = base()
	d.AnioAdquisicion, d.Conexion = ptr(time.Now().Year()+1), ptr("Modbus") // texto libre
	if err := limpiarEquipo(&d); err != nil {
		t.Errorf("año siguiente y conexion libre son validos: %v", err)
	}
}

func TestLimpiarEstacion(t *testing.T) {
	d := DatosEstacion{Nombre: "  Centro ", Ubicacion: " Av. 1 "}
	if err := limpiarEstacion(&d); err != nil || d.Nombre != "Centro" || d.Ubicacion != "Av. 1" || d.Estatus != "Disponible" {
		t.Errorf("limpio = %+v, err %v", d, err)
	}
	for nombre, d := range map[string]DatosEstacion{
		"sin nombre":        {Nombre: "  "},
		"nombre largo":      {Nombre: strings.Repeat("x", 101)},
		"ubicacion larga":   {Nombre: "X", Ubicacion: strings.Repeat("x", 256)},
		"estatus inventado": {Nombre: "X", Estatus: "Flotando"},
	} {
		if err := limpiarEstacion(&d); !errors.Is(err, ErrEntrada) {
			t.Errorf("%s: err = %v", nombre, err)
		}
	}
}

// Rutas que se resuelven antes de tocar la base: permisos, ids y validacion.
func TestRutasSinBase(t *testing.T) {
	emisor := auth.NuevoEmisor([]byte("llave-de-prueba-de-32-caracteres-o-mas"), time.Hour)
	h := NewHandler(NewService(nil, nil), emisor)
	mux := http.NewServeMux()
	h.Rutas(mux)
	token := func(rol auth.Rol) string {
		tok, _ := emisor.Firmar(auth.Sesion{IDUsuario: 1, IDSesion: 1, Rol: rol}, time.Now().Add(time.Hour))
		return tok
	}
	pedir := func(metodo, ruta, cuerpo string, rol auth.Rol) *httptest.ResponseRecorder {
		r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
		if rol != "" {
			r.Header.Set("Authorization", "Bearer "+token(rol))
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}

	if w := pedir("GET", "/api/inventario/catalogos", "", auth.User); w.Code != 200 || !strings.Contains(w.Body.String(), "Analizador") {
		t.Errorf("catalogos: %d %s", w.Code, w.Body.String())
	}
	if w := pedir("GET", "/api/inventario/catalogos", "", ""); w.Code != 401 {
		t.Errorf("sin sesion: %d", w.Code)
	}
	// user ve pero no edita (doc, seccion 5).
	if w := pedir("POST", "/api/inventario/equipos", `{}`, auth.User); w.Code != 403 {
		t.Errorf("user creando equipo: %d, quiero 403", w.Code)
	}
	if w := pedir("POST", "/api/inventario/estaciones", `{}`, auth.User); w.Code != 403 {
		t.Errorf("user creando estacion: %d, quiero 403", w.Code)
	}
	casos := []struct{ metodo, ruta, cuerpo, quiero string }{
		{"POST", "/api/inventario/equipos", `{"tipo":"Tostador","modelo":"X"}`, "tipo"},
		{"POST", "/api/inventario/equipos", `{"tipo":"Analizador","modelo":"X","sobra":1}`, "JSON invalido"},
		{"PUT", "/api/inventario/equipos/abc", `{}`, "id invalido"},
		{"PUT", "/api/inventario/equipos/abc/estacion", `{}`, "id invalido"},
		{"PUT", "/api/inventario/equipos/abc/complementos", `{}`, "id invalido"},
		{"POST", "/api/inventario/estaciones", `{"nombre":""}`, "nombre"},
		{"PUT", "/api/inventario/estaciones/1", `{"nombre":"X","estatus":"Flotando"}`, "estatus"},
	}
	for _, c := range casos {
		w := pedir(c.metodo, c.ruta, c.cuerpo, auth.Tecnico)
		if w.Code != 400 || !strings.Contains(w.Body.String(), c.quiero) {
			t.Errorf("%s %s: %d %s, quiero 400 con %q", c.metodo, c.ruta, w.Code, w.Body.String(), c.quiero)
		}
	}
}

func TestFalloSegunElError(t *testing.T) {
	h := &Handler{}
	for err, quiero := range map[error]int{
		ErrEntrada: 400, ErrNoExiste: 404, ErrDuplicado: 409, errors.New("otro"): 500,
	} {
		w := httptest.NewRecorder()
		h.fallo(w, err)
		if w.Code != quiero {
			t.Errorf("%v: %d, quiero %d", err, w.Code, quiero)
		}
	}
	if h.Nombre() != "inventario" {
		t.Error(h.Nombre())
	}
	h.Iniciar(context.Background())
}
