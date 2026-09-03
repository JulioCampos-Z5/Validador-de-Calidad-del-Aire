import { useEffect, useRef, useState } from 'react';
import { DownloadCloud, RefreshCw } from 'lucide-react';
import { minutalesApi, CONTAMINANTES_CRITERIO, type Progreso } from '../services/minutales';

/**
 * Origen alternativo de datos: descarga directa del SIMAJ.
 *
 * Va junto al recuadro de subir archivo, no en una página aparte, porque no es
 * otra herramienta: es la misma validación con los datos llegando por otra vía.
 * El backend devuelve la misma respuesta que /api/validate/full, así que lo que
 * viene después —tablero, gráficas, tabla, banderas, descarga del Excel— no se
 * entera de por dónde entraron los datos.
 */
export default function FuenteSimaj({
  onResultado,
  onError,
  deshabilitado,
  config,
}: {
  onResultado: (r: any) => void;
  onError: (m: string) => void;
  deshabilitado?: boolean;
  config: Record<string, unknown>;
}) {
  const [meses, setMeses] = useState(1);
  const [cargando, setCargando] = useState(false);
  const [progreso, setProgreso] = useState<Progreso | null>(null);
  const sondeo = useRef<number | null>(null);

  // El sondeo se cancela siempre al desmontar: si no, seguiría corriendo
  // después de salir y actualizaría estado de un componente ya destruido.
  useEffect(() => () => { if (sondeo.current) window.clearInterval(sondeo.current); }, []);

  const descargar = async () => {
    setCargando(true);
    setProgreso(null);

    sondeo.current = window.setInterval(async () => {
      try {
        const p = await minutalesApi.progreso();
        setProgreso(p.activo ? p : null);
      } catch {
        // Un sondeo fallido no debe abortar la descarga; se reintenta solo.
      }
    }, 1000);

    try {
      const r = await minutalesApi.descargar(meses, CONTAMINANTES_CRITERIO, config);
      onResultado(r);
    } catch (e) {
      const detalle = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      onError(detalle ?? 'No se pudo descargar del SIMAJ.');
    } finally {
      if (sondeo.current) window.clearInterval(sondeo.current);
      setProgreso(null);
      setCargando(false);
    }
  };

  const pct = progreso && progreso.total > 0
    ? Math.round((progreso.hechos / progreso.total) * 100)
    : 0;

  const bloqueado = cargando || deshabilitado;

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/60">
      <div className="flex items-center gap-2 mb-1">
        <DownloadCloud className="h-5 w-5 text-primary-600" />
        <h3 className="font-medium text-slate-800">O descargar directo del SIMAJ</h3>
      </div>
      <p className="text-sm text-slate-500 mb-3">
        Baja los minutales publicados de las 13 estaciones y los valida con la misma
        configuración de arriba. No hace falta exportar nada desde ENVISTA.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={meses}
          disabled={bloqueado}
          onChange={(e) => setMeses(Number(e.target.value))}
          className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white disabled:opacity-50"
        >
          <option value={1}>Último mes</option>
          <option value={3}>Últimos 3 meses</option>
          <option value={6}>Últimos 6 meses</option>
          <option value={12}>Último año</option>
        </select>

        <button
          onClick={descargar}
          disabled={bloqueado}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
        >
          {cargando ? <RefreshCw size={16} className="animate-spin" /> : <DownloadCloud size={16} />}
          {cargando ? 'Descargando…' : 'Descargar y validar'}
        </button>
      </div>

      {cargando && progreso && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-slate-500 mb-1 tabular-nums">
            <span>{progreso.estacion} ({progreso.indice}/{progreso.estaciones})</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-primary-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
