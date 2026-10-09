import { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from '../graficas/plotly';
import { Wind } from 'lucide-react';
import { marcaDeTiempo, numero, porHora, type Registro } from '../graficas/series';
import { COLORES_ESTACIONES, getUnitsAndName } from '../constants';

/**
 * Velocidad y dirección del viento con flechas (port de `plot_wind_arrows`
 * del script del área técnica).
 *
 * Cada hora de cada estación es una flecha: su altura en el eje Y es la
 * velocidad (WS) y su orientación, la dirección (WD). Así se ve en una sola
 * gráfica cuándo sopla fuerte y de dónde, y si las estaciones coinciden —una
 * veleta que apunta distinto que todas sus vecinas suele ser una veleta
 * atorada, no un viento local.
 *
 * Sentido de la flecha: como en el script, por defecto apunta DE DÓNDE VIENE
 * el viento (convención meteorológica de WD: 0° = viento del norte, flecha
 * hacia arriba). Se puede invertir para que apunte hacia dónde va, que es como
 * se lee el transporte de contaminantes.
 *
 * Los contaminantes (partículas y gases) van en las mismas flechas, no en
 * líneas aparte: cada flecha toma el color de la concentración en esa hora y
 * estación, y se ve de qué dirección llega el aire más cargado.
 */

type Sentido = 'viene' | 'va';

const PASOS = [1, 2, 3, 6, 12];
/** Más flechas que esto se vuelven una mancha y el navegador se arrastra. */
const MAXIMO_FLECHAS = 12000;

const PARTICULAS = ['PM10', 'PM2.5'];
const GASES = ['O3', 'NO', 'NO2', 'NOX', 'SO2', 'CO'];

// Escala para colorear las flechas: amarillo (poco) a rojo oscuro (mucho).
const ESCALA = [[0, '#fed976'], [0.25, '#feb24c'], [0.5, '#fd8d3c'], [0.75, '#e31a1c'], [1, '#800026']];

const PUNTOS_CARDINALES = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO',
];

function cardinal(grados: number): string {
  return PUNTOS_CARDINALES[Math.round((((grados % 360) + 360) % 360) / 22.5) % 16];
}

const colorDe = (estacion: string, i: number) =>
  COLORES_ESTACIONES[estacion] ?? `hsl(${(i * 47) % 360} 65% 45%)`;

/** Percentil p (0-1) de una lista ya filtrada de numeros. */
function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.floor(p * (orden.length - 1)))];
}

interface Lectura { t: string; hora: number; ws: number; wd: number }

export default function VientoFlechas({ data }: { data: Registro[] }) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Solo las horas con velocidad Y dirección válidas: una flecha sin ángulo o
  // sin altura no dice nada. Las banderas (IO, ND…) no son números y caen aquí.
  const porEstacion = useMemo(() => {
    const indice: Record<string, Lectura[]> = {};
    for (const fila of data) {
      const ws = numero(fila.WS);
      const wd = numero(fila.WD);
      if (ws === null || wd === null) continue;
      (indice[fila.STATION] ??= []).push({ t: marcaDeTiempo(fila), hora: Number(fila.HOUR), ws, wd });
    }
    Object.values(indice).forEach(l => l.sort((a, b) => (a.t < b.t ? -1 : 1)));
    return indice;
  }, [data]);

  // Todas las filas por estación, para leer los contaminantes de cada hora.
  const filasPorEstacion = useMemo(() => {
    const indice: Record<string, Registro[]> = {};
    for (const fila of data) (indice[fila.STATION] ??= []).push(fila);
    return indice;
  }, [data]);

  // Los contaminantes que traen al menos un número: los demás no se ofrecen.
  const medidos = useMemo(() => {
    const s = new Set<string>();
    for (const fila of data) {
      for (const p of [...PARTICULAS, ...GASES]) if (!s.has(p) && numero(fila[p]) !== null) s.add(p);
      if (s.size === PARTICULAS.length + GASES.length) break;
    }
    return s;
  }, [data]);

  const estaciones = useMemo(() => Object.keys(porEstacion).sort(), [porEstacion]);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  useEffect(() => { setElegidas(new Set(estaciones)); }, [estaciones]);

  const [sentido, setSentido] = useState<Sentido>('viene');
  const [tamano, setTamano] = useState(12);
  const [paso, setPaso] = useState<number | 'auto'>('auto');
  // '' = cada flecha con el color de su estación.
  const [colorPor, setColorPor] = useState('');

  const totalElegidas = useMemo(
    () => [...elegidas].reduce((s, e) => s + (porEstacion[e]?.length ?? 0), 0),
    [elegidas, porEstacion],
  );
  // El paso automático es el más fino que no pasa del máximo de flechas.
  const pasoEfectivo = paso === 'auto'
    ? PASOS.find(p => totalElegidas / p <= MAXIMO_FLECHAS) ?? PASOS[PASOS.length - 1]
    : paso;

  useEffect(() => {
    if (!ref.current) return;
    const trazas: object[] = [];
    const layout: Record<string, unknown> = {};

    // --- Flechas ---
    // Con «color por contaminante», el valor de esa hora y estación; la
    // escala se corta en el percentil 98 para que un pico aislado no deje
    // todo lo demás del mismo color.
    const valorDe = (est: string, t: string): number | null => {
      if (!colorPor) return null;
      const fila = porHora(filasPorEstacion[est] ?? []).get(t);
      return fila ? numero(fila[colorPor]) : null;
    };
    let cmax = 0;
    if (colorPor) {
      const todos: number[] = [];
      estaciones.forEach(est => {
        if (!elegidas.has(est)) return;
        for (const l of porEstacion[est] ?? []) {
          if (l.hora % pasoEfectivo !== 0) continue;
          const v = valorDe(est, l.t);
          if (v !== null) todos.push(v);
        }
      });
      cmax = percentil(todos, 0.98) || 1;
      const info = getUnitsAndName(colorPor);
      layout.coloraxis = {
        colorscale: ESCALA, cmin: 0, cmax,
        colorbar: { title: { text: `${colorPor} (${info.unit})`, side: 'right' }, thickness: 12, len: 0.6, y: 0.62, x: 1.02 },
      };
    }

    estaciones.forEach((est, i) => {
      if (!elegidas.has(est)) return;
      const color = colorDe(est, i);
      const lecturas = (porEstacion[est] ?? []).filter(l => l.hora % pasoEfectivo === 0);
      const flechas = (ls: Lectura[], marcador: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
        type: 'scatter',
        mode: 'markers',
        x: ls.map(l => l.t),
        y: ls.map(l => l.ws),
        customdata: ls.map(l => [l.wd, cardinal(l.wd), colorPor ? valorDe(est, l.t) ?? 'sin dato' : '']),
        marker: {
          symbol: 'arrow-wide',
          // Plotly dibuja la flecha hacia arriba y la gira en sentido horario,
          // igual que se miden los grados de WD desde el norte.
          angle: ls.map(l => (sentido === 'viene' ? l.wd : l.wd + 180)),
          size: tamano,
          ...marcador,
        },
        name: est,
        legendgroup: est,
        showlegend: false,
        hovertemplate:
          `<b>${est}</b> %{y:.2f} m/s · %{customdata[0]:.0f}° (%{customdata[1]})`
          + (colorPor ? ` · ${colorPor} %{customdata[2]}` : '') + '<extra></extra>',
        ...extra,
      });

      if (colorPor) {
        const con = lecturas.filter(l => valorDe(est, l.t) !== null);
        const sin = lecturas.filter(l => valorDe(est, l.t) === null);
        trazas.push(flechas(con, { color: con.map(l => valorDe(est, l.t)), coloraxis: 'coloraxis' }));
        // Sin dato del contaminante en esa hora: gris tenue, para no inventar color.
        if (sin.length) trazas.push(flechas(sin, { color: 'rgba(148,163,184,0.45)' }));
      } else {
        trazas.push(flechas(lecturas, { color }));
        // Entrada de leyenda como línea de color, como en el script: la flecha
        // girada de la leyenda confundía más de lo que ayudaba.
        trazas.push({
          type: 'scatter', mode: 'lines', x: [null], y: [null],
          line: { color, width: 3 }, name: est, legendgroup: est, showlegend: true,
        });
      }
    });

    // Con color por contaminante, la barra de la escala va a la derecha.
    const finX = colorPor ? 0.94 : 1;

    Plotly.react(ref.current, trazas, {
      height: 560,
      margin: { l: 60, r: 20, t: 20, b: 60 },
      hovermode: 'x unified',
      plot_bgcolor: 'white',
      paper_bgcolor: 'white',
      xaxis: {
        type: 'date', tickformat: '%d %b %y %H:%M', gridcolor: '#eef1f5',
        rangeslider: { visible: true, thickness: 0.05 }, domain: [0, finX],
      },
      yaxis: { title: { text: 'Velocidad del viento (m/s)' }, gridcolor: '#e5e7eb', rangemode: 'tozero' },
      legend: { title: { text: colorPor ? '' : 'Estación' }, orientation: 'h', y: -0.25, x: 0.5, xanchor: 'center' },
      uirevision: 'viento',
      ...layout,
    }, { responsive: true, displaylogo: false });
  }, [estaciones, elegidas, porEstacion, filasPorEstacion, sentido, tamano, pasoEfectivo, colorPor]);

  useEffect(() => {
    const nodo = ref.current;
    return () => { if (nodo) Plotly.purge(nodo); };
  }, []);

  const alternar = (est: string) => setElegidas(prev => {
    const next = new Set(prev);
    if (next.has(est)) next.delete(est); else next.add(est);
    return next;
  });
  const control = 'px-2 py-1 border border-gray-300 rounded-md text-sm bg-white';
  // Un boton por opcion; se elige uno a la vez (es el color de las flechas).
  const opcion = (valor: string, etiqueta: string, hay = true) => {
    const activo = colorPor === valor;
    return (
      <button key={valor || 'estacion'} type="button" disabled={!hay} aria-pressed={activo}
        onClick={() => setColorPor(valor)}
        title={!hay ? `${valor}: sin datos en lo cargado` : valor ? getUnitsAndName(valor).name : 'Cada estación con su color'}
        className={`px-2.5 py-1 rounded-md border text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          activo ? 'border-slate-800 text-slate-900 font-medium' : 'border-gray-300 text-gray-600 hover:border-gray-500'
        }`}>
        {etiqueta}
      </button>
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Wind className="w-6 h-6 text-blue-600" />
        <div>
          <h2 className="text-xl font-bold text-gray-900">Velocidad y dirección del viento</h2>
          <p className="text-sm text-gray-600">
            Cada flecha es una hora: su altura es la velocidad (WS) y su orientación, la dirección (WD).
          </p>
        </div>
      </div>

      {estaciones.length === 0 ? (
        <p className="text-center py-8 text-gray-500 text-sm">
          Ninguna estación tiene velocidad (WS) y dirección (WD) válidas en el mismo horario.
        </p>
      ) : (
        <>
          <div>
            <div className="flex items-center gap-3 mb-2 text-sm">
              <span className="font-medium text-gray-700">Estaciones</span>
              <button type="button" onClick={() => setElegidas(new Set(estaciones))} className="text-blue-600 hover:underline text-xs">Todas</button>
              <button type="button" onClick={() => setElegidas(new Set())} className="text-blue-600 hover:underline text-xs">Ninguna</button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {estaciones.map((est, i) => (
                <label key={est} className="inline-flex items-center gap-1.5 text-sm cursor-pointer select-none">
                  <input type="checkbox" checked={elegidas.has(est)} onChange={() => alternar(est)} className="rounded border-gray-300" />
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: colorDe(est, i) }} />
                  {est}
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-3 space-y-2" role="group" aria-label="Color de las flechas">
            <div className="text-sm font-medium text-gray-700">
              Color de las flechas
              <span className="font-normal text-gray-500"> · cada flecha toma el color de la concentración en esa hora</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">{opcion('', 'Por estación')}</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 w-20">Partículas</span>
              {PARTICULAS.map(p => opcion(p, p, medidos.has(p)))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 w-20">Gases</span>
              {GASES.map(p => opcion(p, p, medidos.has(p)))}
            </div>
            {colorPor && (
              <p className="text-xs text-gray-500">
                Amarillo, poco; rojo oscuro, mucho (escala hasta el percentil 98). Gris: sin dato de {colorPor} en esa hora.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-700">
            <label className="flex items-center gap-2">
              <span className="font-medium">Flecha:</span>
              <select value={sentido} onChange={e => setSentido(e.target.value as Sentido)} className={control}
                title="WD es de dónde viene el viento (0° = del norte). «Hacia dónde va» la gira 180°.">
                <option value="viene">De dónde viene (WD)</option>
                <option value="va">Hacia dónde va</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="font-medium">Una flecha cada:</span>
              <select value={String(paso)} onChange={e => setPaso(e.target.value === 'auto' ? 'auto' : Number(e.target.value))} className={control}>
                <option value="auto">Automático ({pasoEfectivo} h)</option>
                {PASOS.map(p => <option key={p} value={p}>{p} h</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="font-medium">Tamaño:</span>
              <input type="range" min={6} max={22} value={tamano} onChange={e => setTamano(Number(e.target.value))} />
              <span className="w-6 text-gray-500">{tamano}</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>
              {Math.round(totalElegidas / pasoEfectivo).toLocaleString()} flechas
              {pasoEfectivo > 1 && ` (horas múltiplo de ${pasoEfectivo}; con todas serían ${totalElegidas.toLocaleString()})`}
            </span>
            <span>
              {sentido === 'viene'
                ? '↑ viento del norte · → del este · ↓ del sur · ← del oeste'
                : '↑ va hacia el norte · → hacia el este · ↓ hacia el sur · ← hacia el oeste'}
            </span>
          </div>

          <div ref={ref} role="img" aria-label="Velocidad y dirección del viento por estación, con contaminantes" />
        </>
      )}
    </div>
  );
}
