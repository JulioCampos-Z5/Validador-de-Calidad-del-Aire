import { useEffect, useMemo, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import type { Registro } from '../graficas/series';
import {
  CATEGORIAS, CONTAMINANTES_INDICE, NOMBRE_CORTO, diaSemana, nombreMes,
  type Dia,
} from '../graficas/nom172';
import type { Evaluacion } from '../services/ias';
import { useCategoriasMes } from '../graficas/useCategoriasMes';
import SelectorEstacionMes from './SelectorEstacionMes';

/**
 * Cada día, su categoría diaria y sus 24 horas (como el Observatorio de
 * Calidad del Aire).
 *
 * La categoría diaria de la NOM resume el día en un solo color, y ese resumen
 * esconde las horas malas: un día «Aceptable» por promedio puede tener la
 * mañana entera en Mala. La rejilla pone las 24 horas junto a la diaria.
 */

const SIN_DATOS = { fondo: '#ffffff', borde: '#d5dbe3' };
const hh = (h: number) => String(h).padStart(2, '0');

function Muestra({ cat, className = 'w-3 h-3' }: { cat: number | null; className?: string }) {
  const c = cat === null ? null : CATEGORIAS[cat];
  return (
    <i
      className={`inline-block rounded-[3px] shrink-0 ${className}`}
      style={{
        background: c ? c.color : SIN_DATOS.fondo,
        boxShadow: c ? undefined : `inset 0 0 0 1px ${SIN_DATOS.borde}`,
      }}
    />
  );
}

function Pastilla({ cat }: { cat: number }) {
  const c = CATEGORIAS[cat];
  return (
    <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: c.color, color: c.texto }}>
      {c.nombre}
    </span>
  );
}

function fmt(v: number | null, p: string) {
  if (v === null) return '—';
  return ['O3', 'NO2', 'SO2'].includes(p) ? v.toFixed(3) : p === 'CO' ? v.toFixed(2) : String(v);
}

function descripcionHora(fecha: string, h: number, e: Evaluacion | null) {
  if (!e || e.cat === null) return `${fecha} ${hh(h)}:00 · Sin datos`;
  const valores = CONTAMINANTES_INDICE
    .map(p => `${p} ${fmt(e.valores[p][0], p)}`)
    .join(' · ');
  return `${fecha} ${hh(h)}:00 · ${CATEGORIAS[e.cat].nombre}` +
    `${e.pol ? ` (${e.pol})` : ''}\n${valores}`;
}

type Vista = 'rejilla' | 'calendario';

export default function DiaPorHora({ data }: { data: Registro[] }) {
  const sel = useCategoriasMes(data);
  const { dias, mes } = sel;
  const [vista, setVista] = useState<Vista>('rejilla');
  const [elegido, setElegido] = useState<string | null>(null);
  useEffect(() => { setElegido(null); }, [mes, sel.estacion]);

  const resumen = useMemo(() => {
    const conDiaria = dias.filter(d => d.diaria?.cat != null);
    const conPeores = conDiaria.filter(d => d.horasPeores > 0);
    return {
      total: conDiaria.length,
      conPeores: conPeores.length,
      horas: conPeores.reduce((s, d) => s + d.horasPeores, 0),
      top: [...conPeores].sort((a, b) => b.horasPeores - a.horasPeores).slice(0, 3),
    };
  }, [dias]);

  const hayDatos = dias.some(d => d.peorHora !== null || d.diaria?.cat != null);
  const diaElegido = dias.find(d => d.fecha === elegido) ?? null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Grid3x3 className="w-6 h-6 text-blue-600" />
          <div>
            <h2 className="text-xl font-bold text-gray-900">Cada día, su categoría diaria y sus 24 horas</h2>
            <p className="text-sm text-gray-600">
              Día por día · {mes ? nombreMes(mes) : ''} · {sel.estacion}
            </p>
          </div>
        </div>
        <div role="tablist" aria-label="Vista" className="flex rounded-full border border-gray-200 p-0.5 text-xs">
          {([['rejilla', 'Día × hora'], ['calendario', 'Calendario']] as const).map(([id, texto]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={vista === id}
              onClick={() => setVista(id)}
              className={`rounded-full px-3 py-1.5 transition ${
                vista === id ? 'bg-slate-900 text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {texto}
            </button>
          ))}
        </div>
      </div>

      <SelectorEstacionMes
        estaciones={sel.estaciones} estacion={sel.estacion} onEstacion={sel.setEstacion}
        meses={sel.meses} mes={mes} onMes={sel.setMes}
      />

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-600">
        {CATEGORIAS.map((c, i) => (
          <span key={c.nombre} className="inline-flex items-center gap-1.5"><Muestra cat={i} />{c.nombre}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><Muestra cat={null} />Sin datos</span>
      </div>

      {sel.error ? (
        <p className="text-center py-8 text-red-600 text-sm">{sel.error}</p>
      ) : sel.cargando && !hayDatos ? (
        <p className="text-center py-8 text-gray-500 text-sm">Calculando el índice…</p>
      ) : !hayDatos ? (
        <p className="text-center py-8 text-gray-500 text-sm">
          No hay contaminantes criterio suficientes en {sel.estacion} para calcular categorías.
        </p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
          <div className="rounded-lg border border-gray-200 p-4 overflow-x-auto">
            {vista === 'rejilla'
              ? <Rejilla dias={dias} elegido={elegido} onElegir={setElegido} />
              : <Calendario dias={dias} mes={mes} elegido={elegido} onElegir={setElegido} />}
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 p-5 text-sm text-gray-700">
              <p className="text-xs font-semibold tracking-widest uppercase text-gray-500">
                Lo que se pierde al resumir el día
              </p>
              <p className="mt-3 text-2xl leading-snug text-gray-900">
                {resumen.conPeores} de {resumen.total} días tuvieron horas peores que su categoría diaria
              </p>
              <p className="mt-3">
                En total, <b className="text-gray-900">{resumen.horas} horas</b> quedaron por encima de la
                categoría del día.
              </p>
              {resumen.top.length > 0 && (
                <>
                  <p className="mt-4 pt-4 border-t border-gray-200 text-xs font-semibold tracking-widest uppercase text-gray-500">
                    Días con más horas peores
                  </p>
                  <ul className="mt-3 space-y-2">
                    {resumen.top.map(d => (
                      <li key={d.fecha}>
                        <button
                          type="button"
                          onClick={() => setElegido(d.fecha)}
                          className="w-full flex items-center gap-2 text-left hover:bg-gray-50 rounded px-1 py-0.5"
                        >
                          <span className="font-mono font-semibold text-gray-900 w-14">
                            {Number(d.fecha.slice(8))} {nombreMes(mes).slice(0, 3)}
                          </span>
                          <Pastilla cat={d.diaria!.cat!} />
                          <span className="text-gray-400">→</span>
                          <Pastilla cat={d.peorHora!} />
                          <span className="ml-auto font-mono text-gray-500">+{d.horasPeores} h</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mt-4 text-xs text-gray-500">Toca un día para ver sus indicadores hora por hora.</p>
            </div>

            {diaElegido && <DetalleDia dia={diaElegido} onCerrar={() => setElegido(null)} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Rejilla día × hora ───────────────────────────────────────────────────────

interface VistaProps {
  dias: Dia[];
  elegido: string | null;
  onElegir: (fecha: string) => void;
}

const COLUMNAS = 'grid grid-cols-[3.6rem_5.8rem_2.6rem_repeat(24,minmax(0.9rem,1fr))] items-center gap-x-[2px]';

function Rejilla({ dias, elegido, onElegir }: VistaProps) {
  return (
    <div role="table" aria-label="Categoría global por día y hora" className="text-[0.7rem] min-w-[640px]">
      <div role="row" className={`${COLUMNAS} pb-1.5 text-gray-500`}>
        <span role="columnheader" className="uppercase tracking-wider text-[0.6rem]">Día</span>
        <span role="columnheader" className="uppercase tracking-wider text-[0.6rem]">Diaria</span>
        <span role="columnheader" className="uppercase tracking-wider text-[0.6rem]" title="Contaminante responsable de la categoría diaria">Resp.</span>
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} role="columnheader" className="font-mono text-center text-[0.6rem]">
            {h % 6 === 0 ? hh(h) : <span className="sr-only">{hh(h)}</span>}
          </span>
        ))}
      </div>
      {dias.map(d => (
        <div
          key={d.fecha}
          role="row"
          onClick={() => onElegir(d.fecha)}
          className={`${COLUMNAS} py-[1px] cursor-pointer rounded ${elegido === d.fecha ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
        >
          <span role="cell" className="font-mono">
            <b className="text-gray-900">{d.fecha.slice(8)}</b> <span className="text-gray-500">{diaSemana(d.fecha)}</span>
          </span>
          <span role="cell" className="inline-flex items-center gap-1.5 truncate">
            <Muestra cat={d.diaria?.cat ?? null} />
            {d.diaria?.cat == null ? <span className="text-gray-500">Sin datos</span> : CATEGORIAS[d.diaria!.cat!].nombre}
          </span>
          <span role="cell" className="text-gray-700">
            {d.diaria?.pol ? NOMBRE_CORTO[d.diaria?.pol] : '—'}
          </span>
          {d.horas.map((e, h) => (
            <span role="cell" key={h} title={descripcionHora(d.fecha, h, e)} className="flex">
              <Muestra cat={e?.cat ?? null} className="w-full aspect-square rounded-[3px]" />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Calendario del mes ───────────────────────────────────────────────────────

function Calendario({ dias, mes, elegido, onElegir }: VistaProps & { mes: string }) {
  const [a, m] = mes.split('-').map(Number);
  // Semanas de lunes a domingo.
  const hueco = (new Date(Date.UTC(a, m - 1, 1)).getUTCDay() + 6) % 7;
  const celdas: (Dia | null)[] = [...Array(hueco).fill(null), ...dias];
  return (
    <div className="max-w-2xl mx-auto">
      <div className="grid grid-cols-7 gap-1.5 text-center text-[0.65rem] uppercase tracking-wider text-gray-500 mb-1.5">
        {['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {celdas.map((d, i) => {
          if (!d) return <span key={`h${i}`} />;
          const c = d.diaria?.cat == null ? null : CATEGORIAS[d.diaria!.cat!];
          return (
            <button
              key={d.fecha}
              type="button"
              onClick={() => onElegir(d.fecha)}
              title={c ? `${d.fecha} · ${c.nombre}` : `${d.fecha} · Sin datos`}
              className={`aspect-square rounded-md p-1.5 flex flex-col justify-between text-left ${
                elegido === d.fecha ? 'ring-2 ring-blue-600 ring-offset-1' : ''
              }`}
              style={{
                background: c ? c.color : SIN_DATOS.fondo,
                color: c ? c.texto : '#6b7280',
                boxShadow: c ? undefined : `inset 0 0 0 1px ${SIN_DATOS.borde}`,
              }}
            >
              <span className="font-mono font-semibold text-sm">{Number(d.fecha.slice(8))}</span>
              <span className="text-[0.65rem] leading-tight">
                {d.diaria?.pol ? NOMBRE_CORTO[d.diaria?.pol] : ''}
                {d.horasPeores > 0 && <span className="block font-mono">+{d.horasPeores} h</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Detalle de un día ────────────────────────────────────────────────────────

function DetalleDia({ dia, onCerrar }: { dia: Dia; onCerrar: () => void }) {
  // Solo las columnas de los contaminantes que la estación midió ese día.
  const presentes = CONTAMINANTES_INDICE.filter(p => dia.horas.some(e => e?.valores[p][0] != null));
  return (
    <div className="rounded-lg border border-gray-200 p-4 text-xs text-gray-700">
      <div className="flex items-center justify-between mb-2">
        <p className="font-semibold text-gray-900 text-sm">
          {diaSemana(dia.fecha)} {dia.fecha}
        </p>
        <button type="button" onClick={onCerrar} className="text-gray-500 hover:text-gray-800">Cerrar</button>
      </div>
      <p className="mb-2">
        Diaria: {dia.diaria?.cat == null ? 'sin datos suficientes' : CATEGORIAS[dia.diaria!.cat!].nombre}
        {dia.diaria?.pol && ` · ${NOMBRE_CORTO[dia.diaria.pol]}`}
        {dia.diaria?.nom && ` · NOM: ${dia.diaria.nom === 'Si' ? 'cumple' : 'no cumple'}`}
      </p>
      <table className="w-full font-mono">
        <thead>
          <tr className="text-gray-500">
            <th className="text-left font-normal">h</th>
            {presentes.map(p => <th key={p} className="text-right font-normal">{NOMBRE_CORTO[p]}</th>)}
          </tr>
        </thead>
        <tbody>
          {dia.horas.map((e, h) => (
            <tr key={h}>
              <td className="py-[1px]">
                <span className="inline-flex items-center gap-1"><Muestra cat={e?.cat ?? null} className="w-2.5 h-2.5" />{hh(h)}</span>
              </td>
              {presentes.map(p => {
                const x = e ? { valor: e.valores[p][0], cat: e.valores[p][1] } : { valor: null, cat: null };
                return (
                  <td key={p} className="text-right py-[1px]">
                    <span
                      className={`px-1 rounded ${e?.pol === p ? 'font-bold' : ''}`}
                      style={x.cat !== null ? { background: CATEGORIAS[x.cat].color, color: CATEGORIAS[x.cat].texto } : undefined}
                    >
                      {fmt(x.valor, p)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-gray-500">
        O₃, NO₂ y SO₂ horarios (ppm), CO promedio 8 h (ppm), PM NowCast 12 h (µg/m³). En negritas, el responsable.
      </p>
    </div>
  );
}
