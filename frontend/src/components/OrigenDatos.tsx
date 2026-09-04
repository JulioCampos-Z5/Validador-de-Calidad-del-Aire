import { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, FileCheck2, DownloadCloud, RefreshCw, X } from 'lucide-react';
import { useDatos, type Origen } from '../estado/DatosContexto';
import { minutalesApi, type Progreso } from '../services/minutales';

/**
 * Selector de origen de datos, en el menú lateral.
 *
 * Los tres orígenes viven aquí y no dentro de una página porque el conjunto de
 * datos es del sistema entero, no de una pantalla: se elige una vez y tanto el
 * tablero como las gráficas leen lo mismo. Antes había un cargador por página y
 * cambiar de sección obligaba a volver a cargar.
 */

const OPCIONES: {
  id: Origen;
  etiqueta: string;
  detalle: string;
  icono: typeof FileSpreadsheet;
}[] = [
  {
    id: 'envista',
    etiqueta: 'Archivo ENVISTA',
    detalle: 'Trs.xlsx o .csv crudo. Se convierte y se valida.',
    icono: FileSpreadsheet,
  },
  {
    id: 'validado',
    etiqueta: 'Archivo ya validado',
    detalle: 'BD_{año}.xlsx o .csv procesado. Solo se muestra.',
    icono: FileCheck2,
  },
  {
    id: 'simaj',
    etiqueta: 'Conexión SIMAJ',
    detalle: 'Descarga directa de las 13 estaciones.',
    icono: DownloadCloud,
  },
];

export default function OrigenDatos() {
  const { cargarArchivo, cargarSimaj, cargando, origen, descripcion, error, limpiar } = useDatos();
  const [abierto, setAbierto] = useState<Origen | null>(null);
  const [meses, setMeses] = useState(1);
  const [progreso, setProgreso] = useState<Progreso | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const sondeo = useRef<number | null>(null);

  // El sondeo se detiene siempre al desmontar: si no, seguiría corriendo y
  // escribiría estado de un componente ya destruido.
  useEffect(() => () => { if (sondeo.current) window.clearInterval(sondeo.current); }, []);

  const elegir = (id: Origen) => {
    if (cargando) return;
    if (id === 'simaj') {
      setAbierto(abierto === 'simaj' ? null : 'simaj');
      return;
    }
    // Para archivo no hace falta un paso intermedio: se abre el selector del
    // sistema directamente, que es lo que la persona venía a hacer.
    setAbierto(id);
    entrada.current?.click();
  };

  const alElegirArchivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (archivo && abierto && abierto !== 'simaj') cargarArchivo(archivo, abierto);
  };

  const descargar = async () => {
    setProgreso(null);
    sondeo.current = window.setInterval(async () => {
      try {
        const p = await minutalesApi.progreso();
        setProgreso(p.activo ? p : null);
      } catch {
        // Un sondeo fallido no aborta la descarga; se reintenta solo.
      }
    }, 1000);
    try {
      await cargarSimaj(meses);
    } finally {
      if (sondeo.current) window.clearInterval(sondeo.current);
      setProgreso(null);
    }
  };

  const pct = progreso && progreso.total > 0
    ? Math.round((progreso.hechos / progreso.total) * 100)
    : 0;

  return (
    <div className="px-3 py-4 border-t border-slate-200">
      <h2 className="px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
        Origen de datos
      </h2>

      <input
        ref={entrada}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={alElegirArchivo}
        className="hidden"
      />

      <div className="space-y-1">
        {OPCIONES.map(({ id, etiqueta, detalle, icono: Icono }) => {
          const activo = origen === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => elegir(id)}
              disabled={cargando}
              title={detalle}
              className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors disabled:opacity-50 ${
                activo
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icono size={17} className="mt-0.5 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight">{etiqueta}</span>
                <span className="block text-[11px] text-slate-400 leading-snug mt-0.5">{detalle}</span>
              </span>
            </button>
          );
        })}
      </div>

      {abierto === 'simaj' && (
        <div className="mt-2 px-2.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200">
          <select
            value={meses}
            disabled={cargando}
            onChange={(e) => setMeses(Number(e.target.value))}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white disabled:opacity-50"
          >
            <option value={1}>Último mes</option>
            <option value={3}>Últimos 3 meses</option>
            <option value={6}>Últimos 6 meses</option>
            <option value={12}>Último año</option>
          </select>
          <button
            type="button"
            onClick={descargar}
            disabled={cargando}
            className="w-full mt-2 inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {cargando ? <RefreshCw size={14} className="animate-spin" /> : <DownloadCloud size={14} />}
            {cargando ? 'Descargando…' : 'Descargar'}
          </button>
        </div>
      )}

      {cargando && (
        <div className="mt-3 px-2">
          {progreso ? (
            <>
              <div className="flex justify-between text-[11px] text-slate-500 mb-1 tabular-nums">
                <span className="truncate">{progreso.estacion} ({progreso.indice}/{progreso.estaciones})</span>
                <span>{pct}%</span>
              </div>
              <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-primary-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
            </>
          ) : (
            <p className="text-[11px] text-slate-500">Procesando…</p>
          )}
        </div>
      )}

      {descripcion && !cargando && (
        <div className="mt-3 mx-2 px-2.5 py-2 rounded-md bg-green-50 border border-green-200">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] text-green-800 leading-snug break-words min-w-0">{descripcion}</p>
            <button
              type="button"
              onClick={limpiar}
              title="Descartar los datos cargados"
              className="text-green-700 hover:text-green-900 shrink-0"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {error && !cargando && (
        <p className="mt-3 mx-2 px-2.5 py-2 rounded-md bg-red-50 border border-red-200 text-[11px] text-red-700 leading-snug">
          {error}
        </p>
      )}
    </div>
  );
}
