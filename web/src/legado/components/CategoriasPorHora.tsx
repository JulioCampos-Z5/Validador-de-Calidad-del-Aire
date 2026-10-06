import { useEffect, useMemo, useRef } from 'react';
import Plotly from '../graficas/plotly';
import { BarChart3 } from 'lucide-react';
import type { Registro } from '../graficas/series';
import {
  CATEGORIAS, NOMBRE_CORTO, masFrecuente, nombreMes, textoTramo, tramosCirculares,
} from '../graficas/nom172';
import type { Contaminante } from '../services/ias';
import { useCategoriasMes } from '../graficas/useCategoriasMes';
import SelectorEstacionMes from './SelectorEstacionMes';

/**
 * Días en cada categoría según la hora del día (como el Observatorio de
 * Calidad del Aire): por cada hora, cuántos días del mes cayeron en cada
 * categoría global de la NOM-172.
 *
 * Al lado, la lectura en palabras: la franja en que la mitad o más de los días
 * fueron Mala o peor, y la franja con 80 % o más de días Buena, cada una con
 * su contaminante responsable habitual.
 */

/** «De 06:00–12:59», o «A cualquier hora» si la franja es el día entero. */
function Franja({ texto }: { texto: string | null }) {
  return texto === null
    ? <>A cualquier hora</>
    : <>De <b className="font-mono text-gray-900">{texto}</b></>;
}

const HORAS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

export default function CategoriasPorHora({ data }: { data: Registro[] }) {
  const sel = useCategoriasMes(data);
  const { dias, mes } = sel;
  const ref = useRef<HTMLDivElement | null>(null);

  // conteo[cat][hora] = días
  const conteo = useMemo(() => {
    const c = CATEGORIAS.map(() => new Array(24).fill(0) as number[]);
    for (const dia of dias) {
      dia.horas.forEach((e, h) => { if (e && e.cat !== null) c[e.cat][h]++; });
    }
    return c;
  }, [dias]);

  const lectura = useMemo(() => {
    const totales = HORAS.map((_, h) => conteo.reduce((s, fila) => s + fila[h], 0));
    const malas = HORAS.map((_, h) => conteo.slice(2).reduce((s, fila) => s + fila[h], 0));

    // Responsables de las horas de un tramo que cumplen la condición.
    const responsables = (horas: number[], cond: (cat: number) => boolean) => {
      const r: Contaminante[] = [];
      for (const dia of dias) {
        for (const h of horas) {
          const e = dia.horas[h];
          if (e && e.cat !== null && cond(e.cat) && e.pol) r.push(e.pol);
        }
      }
      return masFrecuente(r);
    };

    const tramosMalos = tramosCirculares(totales.map((t, h) => t > 0 && malas[h] / t >= 0.5));
    const tramosBuenos = tramosCirculares(totales.map((t, h) => t > 0 && conteo[0][h] / t >= 0.8));

    const horasMalas = tramosMalos.flat();
    const horasBuenas = tramosBuenos.flat();
    const totalBuenas = horasBuenas.reduce((s, h) => s + totales[h], 0);
    return {
      malas: horasMalas.length ? {
        texto: horasMalas.length === 24 ? null : tramosMalos.map(textoTramo).join(' y '),
        responsable: responsables(horasMalas, c => c >= 2),
      } : null,
      buenas: horasBuenas.length ? {
        texto: horasBuenas.length === 24 ? null : tramosBuenos.map(textoTramo).join(' y '),
        porcentaje: Math.round(100 * horasBuenas.reduce((s, h) => s + conteo[0][h], 0) / totalBuenas),
        responsable: responsables(horasBuenas, c => c === 0),
      } : null,
      hayDatos: totales.some(t => t > 0),
    };
  }, [conteo, dias]);

  useEffect(() => {
    if (!ref.current || !lectura.hayDatos) return;
    const trazas = CATEGORIAS.map((cat, i) => ({
      type: 'bar',
      name: cat.nombre,
      x: HORAS,
      y: conteo[i],
      marker: { color: cat.color, line: { color: '#ffffff', width: 1 } },
      hovertemplate: `${cat.nombre}: <b>%{y}</b> días<extra>%{x}:00</extra>`,
    }));
    Plotly.newPlot(ref.current, trazas, {
      barmode: 'stack',
      bargap: 0.3,
      height: 320,
      margin: { l: 40, r: 10, t: 30, b: 40 },
      legend: { orientation: 'h', traceorder: 'normal', x: 0, y: 1.02, yanchor: 'bottom', font: { size: 11 } },
      xaxis: { type: 'category', tickfont: { size: 11 }, fixedrange: true },
      yaxis: { title: { text: 'Días', font: { size: 11 } }, gridcolor: '#eef1f5', fixedrange: true },
      paper_bgcolor: 'white',
      plot_bgcolor: 'white',
    }, { responsive: true, displaylogo: false, displayModeBar: false });
    const nodo = ref.current;
    return () => { Plotly.purge(nodo); };
  }, [conteo, lectura.hayDatos]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
      <div className="flex items-center gap-3">
        <BarChart3 className="w-6 h-6 text-blue-600" />
        <div>
          <h2 className="text-xl font-bold text-gray-900">Días en cada categoría según la hora del día</h2>
          <p className="text-sm text-gray-600">
            Categoría global NOM-172 de cada hora: la más desfavorable entre O₃, NO₂, SO₂, CO, PM₁₀ y PM₂.₅.
          </p>
        </div>
      </div>

      <SelectorEstacionMes
        estaciones={sel.estaciones} estacion={sel.estacion} onEstacion={sel.setEstacion}
        meses={sel.meses} mes={mes} onMes={sel.setMes}
      />

      {sel.error ? (
        <p className="text-center py-8 text-red-600 text-sm">{sel.error}</p>
      ) : sel.cargando && !lectura.hayDatos ? (
        <p className="text-center py-8 text-gray-500 text-sm">Calculando el índice…</p>
      ) : !lectura.hayDatos ? (
        <p className="text-center py-8 text-gray-500 text-sm">
          No hay contaminantes criterio suficientes en {sel.estacion} para calcular categorías.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div ref={ref} role="img" aria-label="Número de días con cada categoría según la hora del día" />
          <div className="rounded-lg border border-gray-200 p-5 space-y-3 text-sm leading-relaxed text-gray-700">
            <p className="text-xs font-semibold tracking-widest uppercase text-gray-500">Cómo leerlo</p>
            {lectura.malas ? (
              <p>
                <Franja texto={lectura.malas.texto} />, la mitad o más de los
                días estuvieron en Mala o peor.
                {lectura.malas.responsable && (
                  <> El responsable más frecuente en esas horas fue <b className="text-gray-900">{NOMBRE_CORTO[lectura.malas.responsable]}</b>.</>
                )}
              </p>
            ) : (
              <p>En ninguna hora la mitad o más de los días llegaron a Mala o peor.</p>
            )}
            {lectura.buenas ? (
              <p>
                <Franja texto={lectura.buenas.texto} />, la calidad del aire fue
                Buena en el <b className="text-gray-900">{lectura.buenas.porcentaje} %</b> de los días.
                {lectura.buenas.responsable && (
                  <> Ahí el responsable habitual fue <b className="text-gray-900">{NOMBRE_CORTO[lectura.buenas.responsable]}</b>.</>
                )}
              </p>
            ) : (
              <p>Ninguna hora tuvo 80 % o más de los días en Buena.</p>
            )}
            <p className="text-gray-500">
              Las franjas describen lo que pasó en {nombreMes(mes)} en {sel.estacion}; no son un pronóstico.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
