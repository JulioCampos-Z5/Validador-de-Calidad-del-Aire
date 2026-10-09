import { useRef, useState } from 'react';
import { CheckCircle2, XCircle, Info, CalendarRange, Copy, Download, Check } from 'lucide-react';
import type { Mir } from '../services/minutales';
import { CONTAMINANTES_CRITERIO, type EstacionMir } from '../services/minutales';
import { ariaOrden, TituloOrden, useOrden } from './orden';

// Días AAAA-MM-DD como «7 oct 2025». En UTC: son fechas sin hora, y con la
// zona local un día podía salir como el anterior.
const fmtDia = new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const dia = (iso: string) => fmtDia.format(new Date(`${iso}T00:00:00Z`)).replace('.', '');
const tramo = (desde: string, hasta: string) => (desde === hasta ? dia(desde) : `${dia(desde)} – ${dia(hasta)}`);
const diasEntre = (desde: string, hasta: string) =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000) + 1;

/** Lo que no sale en la captura: los botones de la propia captura. */
const SIN_CAPTURA = 'data-sin-captura';

/**
 * Ancho de la imagen, en px de pantalla. A todo lo ancho del monitor la tabla
 * quedaba con columnas muy separadas, y al reducirla para verla en un correo o
 * un chat el texto salía diminuto y borroso. A este ancho cabe todo y se lee.
 */
const ANCHO_CAPTURA = 1040;
/** Densidad: 3 px por px de pantalla, nítida aunque se haga zoom. */
const DENSIDAD_CAPTURA = 3;

/**
 * La tarjeta como PNG, tal como se ve (con el tema puesto). Se carga al usarla:
 * casi nadie la pide, y así no pesa en la carga del módulo.
 *
 * Se captura una copia fuera de pantalla con el ancho fijo, para no mover la
 * tarjeta que se está mirando.
 */
async function capturar(nodo: HTMLElement): Promise<Blob> {
  const { toBlob } = await import('html-to-image');
  // Sin esto, si Manrope aún no cargó, la imagen sale con la letra del sistema.
  await document.fonts.ready;

  const caja = document.createElement('div');
  caja.style.cssText = `position:fixed;left:-100000px;top:0;width:${ANCHO_CAPTURA}px;pointer-events:none`;
  const copia = nodo.cloneNode(true) as HTMLElement;
  copia.style.width = `${ANCHO_CAPTURA}px`;
  caja.appendChild(copia);
  document.body.appendChild(caja);
  try {
    // El fondo de la tarjeta, para que en modo oscuro no salga transparente.
    const fondo = getComputedStyle(copia).backgroundColor;
    const blob = await toBlob(copia, {
      pixelRatio: DENSIDAD_CAPTURA,
      width: copia.offsetWidth,
      height: copia.offsetHeight,
      backgroundColor: fondo && fondo !== 'rgba(0, 0, 0, 0)' ? fondo : getComputedStyle(document.body).backgroundColor,
      filter: (n) => !(n instanceof HTMLElement && n.hasAttribute(SIN_CAPTURA)),
    });
    if (!blob) throw new Error('No se pudo generar la imagen.');
    return blob;
  } finally {
    caja.remove();
  }
}

/**
 * Indicador MIR: representatividad de los datos.
 *
 * No mide contaminación, mide cuánto dato hay. Se promedia el porcentaje de
 * horas válidas de los contaminantes elegidos y se compara contra el 75%.
 *
 * Dos reglas del área técnica que están replicadas tal cual, porque cambiarlas
 * altera el resultado:
 *   · El promedio es simple entre contaminantes, no ponderado por horas.
 *   · Un contaminante sin equipo se EXCLUYE del promedio, no cuenta como cero.
 *
 * Los datos no distinguen «no hay equipo» de «hay equipo pero no dio ni un
 * dato»: los dos llegan vacíos. Eso lo sabe el usuario, y lo marca celda por
 * celda: un clic en un «—» lo pone en 0 —hay equipo, pero no da datos o no
 * funciona— y entra al promedio; otro clic lo devuelve a sin equipo. El cálculo lo hace el backend, así que el total, el «Cumple», las
 * fallas y el Excel del reporte salen con la misma decisión.
 */
// Columnas ordenables: la estación, cada contaminante (su cobertura), el total y si cumple.
const valorMir = (e: EstacionMir, clave: string): unknown =>
  clave === 'estacion' ? e.estacion
    : clave === 'total' ? e.total
      : clave === 'cumple' ? (e.cumple ? 1 : 0)
        : e.coberturas[clave] ?? null;

export default function TarjetaMir({
  mir,
  contaminantes,
  onCambiarContaminantes,
  onAlternarCero,
}: {
  mir: Mir;
  contaminantes: string[];
  onCambiarContaminantes: (c: string[]) => void;
  onAlternarCero?: (estacion: string, contaminante: string) => void;
}) {
  const hayCeros = mir.estaciones.some((e) => (e.como_cero ?? []).length > 0);

  const tarjeta = useRef<HTMLDivElement>(null);
  const [captura, setCaptura] = useState<'copiada' | 'guardada' | 'error' | null>(null);
  const { ordenadas, orden, alternar: ordenarPor } = useOrden(mir.estaciones, valorMir);
  const avisar = (estado: typeof captura) => {
    setCaptura(estado);
    window.setTimeout(() => setCaptura(null), 2500);
  };
  const nombreCaptura = `MIR_${mir.desde ?? ''}_a_${mir.hasta ?? ''}.png`.replace('__a_', '');

  const copiarCaptura = async () => {
    if (!tarjeta.current) return;
    try {
      // La promesa va dentro del ClipboardItem: así el permiso del clic sigue
      // vigente mientras se genera la imagen.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': capturar(tarjeta.current) })]);
      avisar('copiada');
    } catch {
      avisar('error');
    }
  };

  const descargarCaptura = async () => {
    if (!tarjeta.current) return;
    try {
      const url = URL.createObjectURL(await capturar(tarjeta.current));
      const a = document.createElement('a');
      a.href = url;
      a.download = nombreCaptura;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      avisar('guardada');
    } catch {
      avisar('error');
    }
  };

  // Estaciones medidas sobre un tramo distinto al del conjunto: cada una se
  // compara contra su propio primer y último día, y eso hay que decirlo.
  const tramoPropio = (e: Mir['estaciones'][number]) =>
    !!e.desde && !!e.hasta && (e.desde !== mir.desde || e.hasta !== mir.hasta);

  const alternar = (c: string) => {
    const siguiente = contaminantes.includes(c)
      ? contaminantes.filter((x) => x !== c)
      : [...CONTAMINANTES_CRITERIO.filter((x) => contaminantes.includes(x) || x === c)];
    // Nunca se deja la selección vacía: sin contaminantes el indicador no
    // significa nada y la tabla saldría en blanco sin explicación.
    if (siguiente.length > 0) onCambiarContaminantes(siguiente);
  };

  const color = (v: number | null) => {
    if (v === null) return 'text-slate-300';
    if (v >= mir.umbral) return 'text-slate-700';
    if (v < 25) return 'text-red-600 font-semibold';
    return 'text-amber-600 font-medium';
  };

  return (
    <div ref={tarjeta} className="bg-white rounded-lg border border-slate-200 shadow-sm">
      <div className="p-5 border-b border-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Indicador MIR</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Representatividad de los datos: promedio de horas válidas por estación,
              contra un umbral del {mir.umbral}%.
            </p>
            {mir.desde && mir.hasta && (
              <p className="flex items-center gap-1.5 text-sm text-slate-700 mt-2">
                <CalendarRange size={15} className="shrink-0 text-slate-500" />
                <span>
                  <span className="text-slate-500">Periodo comparado:</span>{' '}
                  <strong className="font-semibold">{tramo(mir.desde, mir.hasta)}</strong>
                  <span className="text-slate-500">
                    {' · '}{diasEntre(mir.desde, mir.hasta).toLocaleString('es-MX')} días
                    {' · '}{(diasEntre(mir.desde, mir.hasta) * 24).toLocaleString('es-MX')} horas esperadas por canal
                  </span>
                </span>
              </p>
            )}
          </div>
          <div className="flex items-start gap-6">
            <div {...{ [SIN_CAPTURA]: '' }} className="flex flex-col items-end gap-1">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={copiarCaptura}
                  title="Copiar la tarjeta como imagen, para pegarla en un correo o un chat"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  <Copy size={14} /> Copiar imagen
                </button>
                <button
                  type="button"
                  onClick={descargarCaptura}
                  title={`Descargar la tarjeta como ${nombreCaptura}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  <Download size={14} /> PNG
                </button>
              </div>
              <span role="status" className="h-4 text-xs">
                {captura === 'copiada' && <span className="inline-flex items-center gap-1 text-green-700"><Check size={12} /> Imagen copiada</span>}
                {captura === 'guardada' && <span className="inline-flex items-center gap-1 text-green-700"><Check size={12} /> Imagen descargada</span>}
                {captura === 'error' && <span className="text-red-600">No se pudo generar la imagen</span>}
              </span>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500 uppercase tracking-wide">Promedio</div>
              <div className="text-2xl font-bold text-slate-800 tabular-nums">
                {mir.promedio_periodo ?? '—'}%
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500 uppercase tracking-wide">Cumplen</div>
              <div className="text-2xl font-bold text-primary-600 tabular-nums">
                {mir.estaciones_que_cumplen}/{mir.total_estaciones}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            Contaminantes en el promedio
          </div>
          <div className="flex flex-wrap gap-2">
            {CONTAMINANTES_CRITERIO.map((c) => (
              <label
                key={c}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm cursor-pointer transition-colors ${
                  contaminantes.includes(c)
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-slate-300 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={contaminantes.includes(c)}
                  onChange={() => alternar(c)}
                  className="rounded border-slate-300"
                />
                {c}
              </label>
            ))}
          </div>
          <p className="flex items-start gap-1.5 text-xs text-slate-400 mt-2">
            <Info size={13} className="mt-0.5 shrink-0" />
            Solo contaminantes criterio de la NOM-172. La meteorología no entra en el indicador.
          </p>
          {mir.estaciones.some(tramoPropio) && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 mt-1">
              <CalendarRange size={13} className="mt-0.5 shrink-0" />
              Cada estación se mide entre su primer y su último día con datos; las que traen fecha
              abajo de su nombre cubren un tramo distinto al del periodo.
            </p>
          )}
          {onAlternarCero && (
            <p className="flex items-start gap-1.5 text-xs text-slate-400 mt-1">
              <Info size={13} className="mt-0.5 shrink-0" />
              <span>
                <strong className="text-slate-500">—</strong> sin equipo: no entra en el promedio.{' '}
                <strong className="text-slate-500">0</strong> hay equipo, pero no da datos o no funciona: cuenta
                en el promedio. Haz clic en un «—» para marcarlo como 0; otro clic lo devuelve.
                {hayCeros && (
                  <span className="text-amber-700"> Hay equipos marcados sin datos: el reporte lo indica.</span>
                )}
              </span>
            </p>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th aria-sort={ariaOrden(orden, 'estacion')} className="px-4 py-2.5 text-left font-medium text-slate-600">
                <TituloOrden clave="estacion" orden={orden} alternar={ordenarPor}>Estación</TituloOrden>
              </th>
              {mir.contaminantes.map((c) => (
                <th key={c} aria-sort={ariaOrden(orden, c)} className="px-4 py-2.5 text-right font-medium text-slate-600">
                  <TituloOrden clave={c} orden={orden} alternar={ordenarPor} derecha>{c}</TituloOrden>
                </th>
              ))}
              <th aria-sort={ariaOrden(orden, 'total')} className="px-4 py-2.5 text-right font-semibold text-slate-700">
                <TituloOrden clave="total" orden={orden} alternar={ordenarPor} derecha>Total</TituloOrden>
              </th>
              <th aria-sort={ariaOrden(orden, 'cumple')} className="px-4 py-2.5 text-center font-semibold text-slate-700">
                <TituloOrden clave="cumple" orden={orden} alternar={ordenarPor}>Cumple</TituloOrden>
              </th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((e) => (
              <tr
                key={e.estacion}
                className={`border-b border-slate-100 ${e.cumple ? '' : 'bg-red-50/40'}`}
              >
                <td
                  className="px-4 py-2 font-medium text-slate-700"
                  title={e.desde && e.hasta
                    ? `${e.estacion}: ${tramo(e.desde, e.hasta)} · ${e.horas_esperadas.toLocaleString('es-MX')} horas esperadas`
                    : undefined}
                >
                  {e.estacion}
                  {/* Solo cuando difiere del periodo: si todas coinciden, repetir
                      la fecha en cada fila es ruido. */}
                  {tramoPropio(e) && (
                    <div className="text-[11px] font-normal text-amber-700 whitespace-nowrap">
                      {tramo(e.desde!, e.hasta!)}
                    </div>
                  )}
                </td>
                {mir.contaminantes.map((c) => {
                  const v = e.coberturas[c] ?? null;
                  const forzado = (e.como_cero ?? []).includes(c);
                  // Solo el hueco sin lecturas se puede marcar: un canal con
                  // datos tiene su cobertura medida y no se toca.
                  const editable = onAlternarCero && (v === null || forzado);
                  return (
                    <td key={c} className={`px-4 py-2 text-right tabular-nums ${forzado ? '' : color(v)}`}>
                      {editable ? (
                        <button
                          type="button"
                          onClick={() => onAlternarCero(e.estacion, c)}
                          title={forzado
                            ? `${e.estacion} · ${c}: hay equipo, pero no da datos (0, cuenta en el promedio). Clic para volver a «sin equipo».`
                            : `${e.estacion} · ${c}: sin equipo (fuera del promedio). Clic si hay equipo pero no da datos o no funciona.`}
                          aria-label={forzado
                            ? `Marcar ${c} de ${e.estacion} como sin equipo`
                            : `Marcar ${c} de ${e.estacion} como equipo sin datos`}
                          className={forzado
                            ? 'px-1.5 rounded border border-dashed border-amber-400 bg-amber-50 text-amber-700 font-semibold hover:bg-amber-100'
                            : 'px-1.5 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100'}
                        >
                          {forzado ? '0' : '—'}
                        </button>
                      ) : (
                        // El hueco se deja vacío, no como 0: en la hoja original esa
                        // distinción separa "sin equipo" de "no reportó".
                        v === null ? '—' : Math.round(v)
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-800">
                  {e.total ?? '—'}
                </td>
                <td className="px-4 py-2 text-center">
                  {e.cumple ? (
                    <span className="inline-flex items-center gap-1 text-green-700">
                      <CheckCircle2 size={15} /> Sí
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                      <XCircle size={15} /> No
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-200">
              <td className="px-4 py-2.5 font-medium text-slate-600" colSpan={mir.contaminantes.length + 1}>
                Porcentaje de datos válidos del periodo
              </td>
              <td className="px-4 py-2.5 text-right font-bold tabular-nums text-slate-800">
                {mir.promedio_periodo ?? '—'}
              </td>
              <td className="px-4 py-2.5 text-center font-bold tabular-nums text-slate-800">
                {mir.estaciones_que_cumplen}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
