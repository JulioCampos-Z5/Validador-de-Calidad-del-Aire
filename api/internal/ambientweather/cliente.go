package ambientweather

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// URLPorDefecto de la API REST de Ambient Weather.
const URLPorDefecto = "https://rt.ambientweather.net/v1"

// Ambient Weather admite 1 peticion por segundo por apiKey; se deja margen.
const espaciado = 1100 * time.Millisecond

// MaxPorPagina: lo mas que devuelve /devices/{mac} de una vez.
const MaxPorPagina = 288

// Cliente de la API de Ambient Weather. Serializa las peticiones: el sondeo y
// una descarga de historico comparten la misma llave y el mismo limite.
type Cliente struct {
	base, apiKey, appKey string
	http                 *http.Client

	mu     sync.Mutex
	ultima time.Time
}

func NuevoCliente(base, apiKey, applicationKey string) *Cliente {
	if base == "" {
		base = URLPorDefecto
	}
	return &Cliente{
		base: strings.TrimRight(base, "/"), apiKey: apiKey, appKey: applicationKey,
		http: &http.Client{Timeout: 30 * time.Second},
	}
}

// DispositivoAPI: un elemento de GET /devices.
type DispositivoAPI struct {
	MacAddress string         `json:"macAddress"`
	LastData   map[string]any `json:"lastData"`
	Info       map[string]any `json:"info"`
}

// Dispositivos de la cuenta, cada uno con su ultima lectura.
func (c *Cliente) Dispositivos(ctx context.Context) ([]DispositivoAPI, error) {
	var res []DispositivoAPI
	return res, c.pedir(ctx, "/devices", nil, &res)
}

// Historico de una estacion: hasta `limite` lecturas (max 288) hacia atras
// desde `hasta`, de la mas reciente a la mas antigua.
func (c *Cliente) Historico(ctx context.Context, mac string, hasta time.Time, limite int) ([]map[string]any, error) {
	if limite <= 0 || limite > MaxPorPagina {
		limite = MaxPorPagina
	}
	q := url.Values{"limit": {strconv.Itoa(limite)}}
	if !hasta.IsZero() {
		q.Set("endDate", strconv.FormatInt(hasta.UnixMilli(), 10))
	}
	var res []map[string]any
	return res, c.pedir(ctx, "/devices/"+url.PathEscape(mac), q, &res)
}

func (c *Cliente) pedir(ctx context.Context, ruta string, q url.Values, destino any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if espera := time.Until(c.ultima.Add(espaciado)); espera > 0 {
		select {
		case <-time.After(espera):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	defer func() { c.ultima = time.Now() }()

	if q == nil {
		q = url.Values{}
	}
	q.Set("apiKey", c.apiKey)
	q.Set("applicationKey", c.appKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+ruta+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		// El error de net/http trae la URL completa, con las llaves en la
		// query: no debe llegar ni al log ni al front.
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return fmt.Errorf("sin respuesta de Ambient Weather: %w", err)
	}
	defer resp.Body.Close()
	cuerpo, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return fmt.Errorf("respuesta de Ambient Weather incompleta: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		detalle := strings.TrimSpace(string(cuerpo))
		var e struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(cuerpo, &e) == nil && e.Error != "" {
			detalle = e.Error
		}
		if len(detalle) > 200 {
			detalle = detalle[:200]
		}
		switch resp.StatusCode {
		case http.StatusUnauthorized:
			return fmt.Errorf("Ambient Weather rechazo las llaves (401): %s", detalle)
		case http.StatusTooManyRequests:
			return fmt.Errorf("Ambient Weather: limite de peticiones (429)")
		default:
			return fmt.Errorf("Ambient Weather respondio %d: %s", resp.StatusCode, detalle)
		}
	}
	if err := json.Unmarshal(cuerpo, destino); err != nil {
		return fmt.Errorf("Ambient Weather mando algo que no es JSON valido: %w", err)
	}
	return nil
}

// Normalizar convierte una observacion de la API en Lectura. Sin dateutc no
// hay lectura: sin hora no se puede guardar ni ordenar.
func Normalizar(mac string, obs map[string]any) (Lectura, bool) {
	ms, ok := numero(obs["dateutc"])
	if !ok || ms <= 0 {
		return Lectura{}, false
	}
	l := Lectura{
		MAC:     strings.ToUpper(mac),
		Fecha:   time.UnixMilli(int64(ms)).UTC(),
		Valores: map[string]float64{},
	}
	for _, col := range Columnas {
		for _, campo := range col.Campos {
			if v, ok := numero(obs[campo]); ok {
				l.Valores[col.Nombre] = v
				break
			}
		}
	}
	l.crudo, _ = json.Marshal(obs)
	return l, true
}

// numero acepta lo que la API manda: numeros JSON y, a veces, texto numerico.
// NaN e infinito no son lecturas: MySQL ni siquiera los guarda.
func numero(v any) (float64, bool) {
	var f float64
	var err error
	switch x := v.(type) {
	case float64:
		f = x
	case json.Number:
		f, err = x.Float64()
	case string:
		f, err = strconv.ParseFloat(strings.TrimSpace(x), 64)
	default:
		return 0, false
	}
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
		return 0, false
	}
	return f, true
}
