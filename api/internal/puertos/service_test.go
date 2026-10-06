package puertos

import (
	"testing"
	"time"
)

var umbralesPrueba = Umbrales{Aviso: time.Hour, Critico: 4 * time.Hour, Incumple: 6 * time.Hour}

func TestNivel(t *testing.T) {
	casos := map[time.Duration]string{
		10 * time.Minute: NivelReciente,
		time.Hour:        NivelAviso,
		5 * time.Hour:    NivelCritico,
		6 * time.Hour:    NivelIncumple,
		30 * time.Hour:   NivelIncumple,
	}
	for d, quiero := range casos {
		if got := umbralesPrueba.Nivel(d); got != quiero {
			t.Errorf("Nivel(%s) = %q, quiero %q", d, got, quiero)
		}
	}
}

func TestEstadoPuerto(t *testing.T) {
	ahora := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	latido := ahora.Add(-30 * time.Second)
	antes := latido.Add(-time.Minute)
	despues := latido.Add(10 * time.Second)

	casos := []struct {
		nombre   string
		enLatido bool
		ultimo   *Evento
		latido   *time.Time
		estado   string
		conDesde bool
	}{
		{"solo latido", true, nil, &latido, "arriba", false},
		// El caso que fallo en la prueba local: latido viejo que lo traia
		// arriba y una caida posterior que llego de la bandeja.
		{"caida posterior al latido", true, &Evento{Tipo: PuertoCaido, Momento: despues}, &latido, "caido", true},
		{"caida anterior, latido lo trae arriba", true, &Evento{Tipo: PuertoCaido, Momento: antes}, &latido, "arriba", false},
		{"caida anterior, latido no lo trae", false, &Evento{Tipo: PuertoCaido, Momento: antes}, &latido, "caido", true},
		{"volvio despues del latido", false, &Evento{Tipo: PuertoArriba, Momento: despues}, &latido, "arriba", true},
		{"latido no lo trae y la caida no ha llegado", false, &Evento{Tipo: PuertoArriba, Momento: antes}, &latido, "caido", false},
		{"sin latido nunca, solo evento", false, &Evento{Tipo: PuertoCaido, Momento: antes}, nil, "caido", true},
	}
	for _, c := range casos {
		p := estadoPuerto("tcp:502", c.enLatido, c.ultimo, c.latido, ahora, umbralesPrueba)
		if p.Estado != c.estado || (p.Desde != nil) != c.conDesde {
			t.Errorf("%s: estado %q desde=%v; quiero %q conDesde=%v", c.nombre, p.Estado, p.Desde, c.estado, c.conDesde)
		}
	}
}

func TestValidaciones(t *testing.T) {
	for _, c := range []string{"tcp:502", "udp:161", "com:COM3"} {
		if !claveValida.MatchString(c) {
			t.Errorf("%q deberia ser clave valida", c)
		}
	}
	for _, c := range []string{"", "tcp:", "tcp:123456", "com:3", "http:80", "tcp:502;DROP"} {
		if claveValida.MatchString(c) {
			t.Errorf("%q no deberia ser clave valida", c)
		}
	}
	if u := nuevoUUID(); !uuidValido.MatchString(u) {
		t.Errorf("nuevoUUID() = %q no pasa la validacion de uuid", u)
	}
}
