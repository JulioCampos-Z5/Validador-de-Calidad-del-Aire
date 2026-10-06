import { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from '../graficas/plotly';
import { Wind } from 'lucide-react';
import { marcaDeTiempo, numero, type Registro } from '../graficas/series';
import { COLORES_ESTACIONES } from '../constants';

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
 */

type Sentido = 'viene' | 'va';

const PASOS = [1, 2, 3, 6, 12];
/** Más flechas que esto se vuelven una mancha y el navegador se arrastra. */
const MAXIMO_FLECHAS = 12000;

const PUNTOS_CARDINALES = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO',
];

function cardinal(grados: number): string {
  return PUNTOS_CARDINALES[Math.round((((grados % 360) + 360) % 360) / 22.5) % 16];
}

const colorDe = (estacion: string, i: number) =>
  COLORES_ESTACIONES[estacion] ?? `hsl(${(i * 47) % 360} 65% 45%)`;

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

  const estaciones = useMemo(() => Object.keys(porEstacion).sort(), [porEstacion]);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  useEffect(() => { setElegidas(new Set(estaciones)); }, [estaciones]);

  const [sentido, setSentido] = useState<Sentido>('viene');
  const [tamano, setTamano] = useState(12);
  const [paso, setPaso] = useState<number | 'auto'>('auto');

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
    estaciones.forEach((est, i) => {
      if (!elegidas.has(est)) return;
      const color = colorDe(est, i);
      const lecturas = (porEstacion[est] ?? []).filter(l => l.hora % pasoEfectivo === 0);
      trazas.push({
        type: 'scatter',
        mode: 'markers',
        x: lecturas.map(l => l.t),
        y: lecturas.map(l => l.ws),
        customdata: lecturas.map(l => [l.wd, cardinal(l.wd)]),
        marker: {
          symbol: 'arrow-wide',
          // Plotly dibuja la flecha hacia arriba y la gira en sentido horario,
          // igual que se miden los grados de WD desde el norte.
          angle: lecturas.map(l => (sentido === 'viene' ? l.wd : l.wd + 180)),
          size: tamano,
          color,
        },
        name: est,
        legendgroup: est,
        showlegend: false,
        hovertemplate:
          `<b>${est}</b> %{y:.2f} m/s · %{customdata[0]:.0f}° (%{customdata[1]})<extra></extra>`,
      });
      // Entrada de leyenda como línea de color, como en el script: la flecha
      // girada de la leyenda confundía más de lo que ayudaba.
      trazas.push({
        type: 'scatter', mode: 'lines', x: [null], y: [null],
        line: { color, width: 3 }, name: est, legendgroup: est, showlegend: true,
      });
    });

    Plotly.react(ref.current, trazas, {
      height: 560,
      margin: { l: 60, r: 20, t: 20, b: 60 },
      hovermode: 'x unified',
      plot_bgcolor: 'white',
      paper_bgcolor: 'white',
      xaxis: { type: 'date', tickformat: '%d %b %y %H:%M', gridcolor: '#eef1f5', rangeslider: { visible: true, thickness: 0.05 } },
      yaxis: { title: { text: 'Velocidad del viento (m/s)' }, gridcolor: '#e5e7eb', rangemode: 'tozero' },
      legend: { title: { text: 'Estación' }, orientation: 'h', y: -0.25, x: 0.5, xanchor: 'center' },
      uirevision: 'viento',
    }, { responsive: true, displaylogo: false });
  }, [estaciones, elegidas, porEstacion, sentido, tamano, pasoEfectivo]);

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

          <div ref={ref} role="img" aria-label="Velocidad y dirección del viento por estación" />
        </>
      )}
    </div>
  );
}
