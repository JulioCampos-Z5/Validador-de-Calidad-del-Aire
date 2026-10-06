import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, AlertCircle, CheckCircle2, Radio } from 'lucide-react';
import { useDatos } from '../estado/DatosContexto';
import {
  FECHA_MINIMA, historicoApi, mensajeError,
  type Analisis, type AvanceDescarga, type Cambio, type EstadoHistorico,
} from '../services/historico';

/**
 * Base local en SQLite (solo app de escritorio).
 *
 * - Descargar desde la API de Emisiones: un botón por año, que descarga el
 *   año completo mes a mes en segundo plano. Lo nuevo entra solo; lo que
 *   cambió respecto a lo guardado queda pendiente.
 * - Cambios pendientes: se revisan (antes → ahora) y se aplican o descartan.
 * - Guardar lo cargado (archivo CSV/Excel, SIMAJ o API): se compara antes de
 *   escribir y se decide si se actualiza.
 *
 * Todo cubre desde 2024-01-01 hasta hoy.
 */

const fmt = (v: number | null) =>
  v === null || v === undefined ? '—' : Number(v.toPrecision(6)).toString();

const celda = (v: number | null, bandera: string | null) =>
  bandera ? <span className="text-amber-700 font-medium">{bandera}</span> : fmt(v);

export function TablaCambios({ cambios }: { cambios: Cambio[] }) {
  return (
    <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 sticky top-0">
          <tr className="text-left text-gray-600">
            <th className="px-3 py-2">Estación</th>
            <th className="px-3 py-2">Parámetro</th>
            <th className="px-3 py-2">Fecha</th>
            <th className="px-3 py-2">Hora</th>
            <th className="px-3 py-2 text-right">Guardado</th>
            <th className="px-3 py-2 text-right">Nuevo</th>
          </tr>
        </thead>
        <tbody>
          {cambios.map((c, i) => (
            <tr key={i} className="border-t border-gray-100">
              <td className="px-3 py-1.5">{c.estacion}</td>
              <td className="px-3 py-1.5">{c.parametro}</td>
              <td className="px-3 py-1.5">{c.fecha}</td>
              <td className="px-3 py-1.5">{String(c.hora).padStart(2, '0')}:00</td>
              <td className="px-3 py-1.5 text-right text-gray-500">{celda(c.antes, c.bandera_antes)}</td>
              <td className="px-3 py-1.5 text-right font-medium">{celda(c.ahora, c.bandera_ahora)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const seccion = 'space-y-3 pt-4 border-t border-gray-100 first:border-t-0 first:pt-0';
const titulo = 'text-sm font-semibold text-gray-800';
const boton = 'px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-50';
const primario = `${boton} bg-primary-600 text-white hover:bg-primary-700`;
const secundario = `${boton} border border-gray-300 text-gray-700 hover:bg-gray-100`;

export default function ModalBaseLocal({ onCerrar }: { onCerrar: () => void }) {
  const { resultado, descripcion, origen, sesionEmisiones, config } = useDatos();
  const [estado, setEstado] = useState<EstadoHistorico | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const refrescar = useCallback(async () => {
    try {
      setEstado(await historicoApi.estado());
    } catch (e) {
      setError(mensajeError(e, 'No se pudo leer la base local.'));
    }
  }, []);

  // ── Descargar desde la API, por año completo ──────────────────────────────
  const anioMinimo = Number(FECHA_MINIMA.slice(0, 4));
  const anioActual = new Date().getFullYear();
  const anios = Array.from({ length: anioActual - anioMinimo + 1 }, (_, i) => anioMinimo + i);
  const [avance, setAvance] = useState<AvanceDescarga | null>(null);
  const sondeo = useRef<number | null>(null);

  const [pendientes, setPendientes] = useState<{ total: number; muestra: Cambio[] } | null>(null);
  const refrescarPendientes = useCallback(async () => {
    try {
      setPendientes(await historicoApi.pendientes());
    } catch { /* se reintenta al abrir otra vez */ }
  }, []);

  const seguir = useCallback(() => {
    if (sondeo.current) return;
    sondeo.current = window.setInterval(async () => {
      try {
        const a = await historicoApi.avanceDescarga();
        setAvance(a);
        if (!a.activo) {
          window.clearInterval(sondeo.current!);
          sondeo.current = null;
          refrescar();
          refrescarPendientes();
        }
      } catch { /* un sondeo fallido no corta la descarga */ }
    }, 1500);
  }, [refrescar, refrescarPendientes]);

  useEffect(() => () => { if (sondeo.current) window.clearInterval(sondeo.current); }, []);

  // El año completo: del 1 de enero al 1 de enero siguiente (excluido). El
  // backend lo recorta a hoy si es el año en curso.
  const descargarAnio = async (anio: number) => {
    setError(null); setAviso(null);
    try {
      setAvance(await historicoApi.descargar(`${anio}-01-01`, `${anio + 1}-01-01`, config));
      seguir();
    } catch (e) {
      setError(mensajeError(e, 'No se pudo iniciar la descarga.'));
    }
  };

  // ── Guardar lo cargado ────────────────────────────────────────────────────
  // Los archivos se guardan solos al importarlos; aquí queda lo consultado
  // del SIMAJ o de la API por periodo.
  const puedeGuardarCargado = !!resultado && (origen === 'simaj' || origen === 'emisiones');
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [trabajando, setTrabajando] = useState<'analizar' | 'aplicar' | 'pendientes' | null>(null);

  const analizar = useCallback(async () => {
    setTrabajando('analizar'); setError(null); setAviso(null);
    try {
      setAnalisis(await historicoApi.analizar());
    } catch (e) {
      setError(mensajeError(e, 'No se pudo comparar con la base local.'));
    } finally {
      setTrabajando(null);
    }
  }, []);

  // Al abrir: qué hay guardado, si hay una descarga corriendo y los pendientes.
  useEffect(() => {
    refrescar();
    refrescarPendientes();
    historicoApi.avanceDescarga().then(a => {
      if (a.activo !== undefined) setAvance(a.total ? a : null);
      if (a.activo) seguir();
    }).catch(() => {});
    if (puedeGuardarCargado) analizar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aplicar = async (actualizarCambios: boolean) => {
    if (!analisis?.id) return;
    setTrabajando('aplicar'); setError(null);
    try {
      const r = await historicoApi.aplicar(analisis.id, actualizarCambios);
      setAviso(
        `Guardado: ${r.nuevos.toLocaleString()} datos nuevos` +
        (r.actualizados ? `, ${r.actualizados.toLocaleString()} actualizados` : '') +
        (r.omitidos ? `, ${r.omitidos.toLocaleString()} cambios sin aplicar (se conservó lo guardado)` : '') + '.',
      );
      setAnalisis(null);
      await refrescar();
    } catch (e) {
      setError(mensajeError(e, 'No se pudo guardar en la base local.'));
    } finally {
      setTrabajando(null);
    }
  };

  const resolverPendientes = async (aplicarlos: boolean) => {
    setTrabajando('pendientes'); setError(null);
    try {
      if (aplicarlos) {
        const r = await historicoApi.aplicarPendientes();
        setAviso(`Actualizados ${r.actualizados.toLocaleString()} datos.`);
      } else {
        const r = await historicoApi.descartarPendientes();
        setAviso(`Descartados ${r.descartados.toLocaleString()} cambios; se conservó lo guardado.`);
      }
      await Promise.all([refrescar(), refrescarPendientes()]);
    } catch (e) {
      setError(mensajeError(e, 'No se pudieron resolver los pendientes.'));
    } finally {
      setTrabajando(null);
    }
  };

  // ── Cargas anteriores ─────────────────────────────────────────────────────
  const [cargaAbierta, setCargaAbierta] = useState<number | null>(null);
  const [cambiosCarga, setCambiosCarga] = useState<Cambio[]>([]);
  const verCambios = async (id: number) => {
    if (cargaAbierta === id) { setCargaAbierta(null); return; }
    setCargaAbierta(id);
    setCambiosCarga([]);
    try {
      setCambiosCarga(await historicoApi.cambiosDeCarga(id));
    } catch (e) {
      setError(mensajeError(e, 'No se pudieron leer los cambios.'));
    }
  };

  const cerrar = () => {
    // Un análisis sin aplicar no se queda ocupando memoria en el backend. El
    // descarga sigue en segundo plano aunque se cierre el diálogo.
    if (analisis?.id) historicoApi.descartar(analisis.id).catch(() => {});
    onCerrar();
  };

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape' && !trabajando) cerrar(); };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  });

  const pct = avance?.total ? Math.round(((avance.hechos ?? 0) / avance.total) * 100) : 0;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => { if (!trabajando) cerrar(); }}
      role="presentation"
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Base local"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
          <h2 className="font-semibold text-slate-800 flex-1">Base local</h2>
          <button
            type="button"
            onClick={cerrar}
            disabled={trabajando !== null}
            aria-label="Cerrar"
            className="p-1 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {error && (
            <p className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
            </p>
          )}
          {aviso && (
            <p className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <CheckCircle2 size={16} /> {aviso}
            </p>
          )}

          {!!estado?.anios?.length && (
            <p className="text-xs text-gray-500">
              Guardado: {estado.anios.map(a => `${a.anio} (${a.desde.slice(5)} a ${a.hasta.slice(5)})`).join(' · ')}
            </p>
          )}

          {/* ── Descargar desde la API de Emisiones ── */}
          <section className={seccion}>
            <h3 className={titulo}>Descargar desde la API de Emisiones</h3>
            <p className="text-xs text-gray-500 leading-snug">
              Elige un año: se descarga completo, se valida y se guarda. Lo nuevo entra solo; si un
              dato ya guardado llega distinto, no se pisa: queda en «Cambios pendientes» para que lo
              revises. Si se corta la red, lo ya guardado se queda y puedes volver a descargar el año.
            </p>
            {!sesionEmisiones.activa ? (
              <p className="flex items-center gap-2 text-sm text-amber-700">
                <Radio size={15} /> Inicia sesión primero en Consultar datos → API de Emisiones.
              </p>
            ) : avance?.activo ? (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-600 tabular-nums">
                  <span>Mes {avance.mes ?? '…'} ({avance.hechos}/{avance.total})</span>
                  <span>{(avance.nuevos ?? 0).toLocaleString()} nuevos · {pct}%</span>
                </div>
                <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-primary-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <button onClick={() => historicoApi.cancelarDescarga()} className="text-xs text-red-600 hover:underline">
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {anios.map(anio => {
                  const guardado = estado?.anios?.find(a => a.anio === anio);
                  return (
                    <button
                      key={anio}
                      onClick={() => descargarAnio(anio)}
                      title={guardado
                        ? `Guardado: ${guardado.desde} a ${guardado.hasta}. Vuelve a descargarlo para traer lo que falte y detectar cambios.`
                        : `Descargar ${anio} completo`}
                      className={`${boton} flex flex-col items-center min-w-[5.5rem] ${
                        guardado ? 'border border-primary-600 text-primary-700 hover:bg-primary-50' : 'bg-primary-600 text-white hover:bg-primary-700'
                      }`}
                    >
                      <span className="text-base">{anio}</span>
                      <span className="text-[10px] font-normal opacity-80">
                        {guardado ? `guardado hasta ${guardado.hasta.slice(5)}` : 'sin descargar'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {avance && !avance.activo && avance.total !== undefined && (
              <div className="text-xs text-gray-600 space-y-0.5">
                <p>
                  {avance.desde?.slice(0, 4)}: {avance.error ?? avance.mensaje ?? 'Terminado.'} {(avance.nuevos ?? 0).toLocaleString()} datos nuevos,
                  {' '}{(avance.pendientes ?? 0).toLocaleString()} cambios pendientes de revisar.
                </p>
                {!!avance.fallidos?.length && (
                  <p className="text-amber-700">
                    Meses que fallaron (vuelve a descargar el año para reintentarlos): {avance.fallidos.map(f => f.mes).join(', ')}
                  </p>
                )}
                {!!avance.vacios?.length && (
                  <p className="text-gray-400">Sin datos en la API: {avance.vacios.join(', ')}</p>
                )}
              </div>
            )}
          </section>

          {/* ── Cambios pendientes ── */}
          {!!pendientes?.total && (
            <section className={seccion}>
              <h3 className={titulo}>Cambios pendientes de revisar · {pendientes.total.toLocaleString()}</h3>
              <p className="text-xs text-gray-500">Datos que la descarga encontró distintos a lo guardado.</p>
              <TablaCambios cambios={pendientes.muestra} />
              {pendientes.total > pendientes.muestra.length && (
                <p className="text-xs text-gray-400">
                  Se muestran los primeros {pendientes.muestra.length.toLocaleString()}.
                </p>
              )}
              <div className="flex gap-2">
                <button onClick={() => resolverPendientes(true)} disabled={trabajando !== null} className={primario}>
                  Actualizar {pendientes.total.toLocaleString()} datos
                </button>
                <button onClick={() => resolverPendientes(false)} disabled={trabajando !== null} className={secundario}>
                  Descartar y conservar lo guardado
                </button>
              </div>
            </section>
          )}

          {/* ── Guardar lo cargado ── */}
          {puedeGuardarCargado && (
            <section className={seccion}>
              <h3 className={titulo}>Guardar lo cargado</h3>
              <p className="text-sm text-gray-600">
                {descripcion} · {resultado!.summary.total_registros.toLocaleString()} registros
              </p>
              {trabajando === 'analizar' && (
                <p className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 size={14} className="animate-spin" /> Comparando con lo guardado…
                </p>
              )}
              {analisis && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { etiqueta: 'Datos nuevos', valor: analisis.nuevos, color: 'text-blue-700 bg-blue-50' },
                      { etiqueta: 'Cambiaron', valor: analisis.cambiados, color: 'text-amber-700 bg-amber-50' },
                      { etiqueta: 'Sin cambios', valor: analisis.iguales, color: 'text-gray-700 bg-gray-50' },
                    ].map(t => (
                      <div key={t.etiqueta} className={`rounded-lg px-4 py-3 ${t.color}`}>
                        <div className="text-2xl font-bold">{t.valor.toLocaleString()}</div>
                        <div className="text-xs">{t.etiqueta}</div>
                      </div>
                    ))}
                  </div>
                  {analisis.cambiados > 0 && <TablaCambios cambios={analisis.muestra} />}
                  {analisis.nuevos === 0 && analisis.cambiados === 0 ? (
                    <p className="text-sm text-gray-600">Todo lo cargado ya está guardado y no hay diferencias.</p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {analisis.cambiados > 0 && (
                        <button onClick={() => aplicar(true)} disabled={trabajando !== null} className={primario}>
                          Guardar nuevos y actualizar {analisis.cambiados.toLocaleString()} cambios
                        </button>
                      )}
                      <button
                        onClick={() => aplicar(false)}
                        disabled={trabajando !== null || analisis.nuevos === 0}
                        className={analisis.cambiados > 0 ? secundario : primario}
                      >
                        {analisis.cambiados > 0 ? 'Guardar solo los nuevos' : `Guardar ${analisis.nuevos.toLocaleString()} datos nuevos`}
                      </button>
                      {trabajando === 'aplicar' && <Loader2 size={14} className="animate-spin text-gray-400" />}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ── Cargas anteriores ── */}
          {!!estado?.cargas?.length && (
            <section className={seccion}>
              <h3 className={titulo}>Últimas cargas guardadas</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600 border-b border-gray-200">
                    <th className="px-2 py-1.5">Fecha</th>
                    <th className="px-2 py-1.5">Origen</th>
                    <th className="px-2 py-1.5">Periodo</th>
                    <th className="px-2 py-1.5 text-right">Nuevos</th>
                    <th className="px-2 py-1.5 text-right">Actualizados</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {estado.cargas.map(c => (
                    <Fragment key={c.id}>
                      <tr className="border-b border-gray-100">
                        <td className="px-2 py-1.5 whitespace-nowrap">{c.fecha.replace('T', ' ')}</td>
                        <td className="px-2 py-1.5 truncate max-w-[12rem]" title={c.descripcion || ''}>{c.descripcion || c.origen}</td>
                        <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{c.desde} a {c.hasta}</td>
                        <td className="px-2 py-1.5 text-right">{c.nuevos.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right">{c.cambiados.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right">
                          {c.cambiados > 0 && (
                            <button onClick={() => verCambios(c.id)} className="text-xs text-primary-600 hover:underline whitespace-nowrap">
                              {cargaAbierta === c.id ? 'Ocultar' : 'Ver cambios'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {cargaAbierta === c.id && (
                        <tr>
                          <td colSpan={6} className="px-2 py-2"><TablaCambios cambios={cambiosCarga} /></td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {estado?.ruta && (
            <p className="text-[11px] text-gray-400 break-all">
              {estado.ruta} · {((estado.tamano ?? 0) / 1048576).toFixed(1)} MB
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
