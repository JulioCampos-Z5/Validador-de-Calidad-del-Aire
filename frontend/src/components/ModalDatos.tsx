import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Upload, FileInput, DownloadCloud, Radio, X, ChevronLeft, ChevronRight,
  UploadCloud, RefreshCw, Search, CalendarDays, AlertCircle,
} from 'lucide-react';
import {
  diasDelPeriodo, useDatos, type Origen, type OrigenArchivo,
} from '../estado/DatosContexto';
import { DIAS_AVISO, DIAS_MAXIMOS } from '../services/emisiones';
import { PanelCalendario } from './CalendarioRango';
import AccesoEmisiones from './AccesoEmisiones';

/**
 * Asistente para traer datos, en pasos.
 *
 * Antes los cuatro orígenes eran una lista de botones en el menú, y cada uno
 * desplegaba su propio panel dentro de una columna de 256 px: el calendario no
 * cabía, el formulario de acceso quedaba apretado y no había sitio para una
 * zona de arrastrar archivos.
 *
 * Aquí el menú tiene un solo botón y todo lo demás pasa en un diálogo con
 * espacio: se elige el origen y el asistente pide lo que ese origen necesite,
 * en el orden en que hace falta.
 *
 *   archivo   →  soltar o buscar el archivo
 *   SIMAJ     →  periodo → confirmar
 *   Emisiones →  acceso (solo si no hay token) → periodo → confirmar
 *
 * El acceso va primero porque sin token no hay nada que consultar, y descubrirlo
 * después de elegir las fechas obligaría a repetirlas.
 */

type Paso = 'origenes' | 'archivo' | 'acceso' | 'periodo' | 'confirmar';

const ORIGENES: {
  id: Origen;
  etiqueta: string;
  detalle: string;
  icono: typeof Upload;
}[] = [
  {
    id: 'envista',
    etiqueta: 'Archivo ENVISTA',
    detalle: 'Trs.xlsx o .csv crudo. Se convierte y se valida.',
    icono: Upload,
  },
  {
    id: 'validado',
    etiqueta: 'Archivo ya validado',
    detalle: 'Un BD_{año}.xlsx procesado, para volver a mirarlo.',
    icono: FileInput,
  },
  {
    id: 'simaj',
    etiqueta: 'Descargar del SIMAJ',
    detalle: 'Las 13 estaciones de aire.jalisco.gob.mx.',
    icono: DownloadCloud,
  },
  {
    id: 'emisiones',
    etiqueta: 'API de Emisiones',
    detalle: 'emisiones.jalisco.gob.mx. Requiere iniciar sesión.',
    icono: Radio,
  },
];

const ES_DE_RED = (o: Origen | null) => o === 'simaj' || o === 'emisiones';

export default function ModalDatos({ onCerrar }: { onCerrar: () => void }) {
  const {
    periodo, setPeriodo, sesionEmisiones, cargando, error,
    cargarArchivo, cargarSimaj, cargarEmisiones, progresoSimaj,
  } = useDatos();

  const [paso, setPaso] = useState<Paso>('origenes');
  const [origen, setOrigen] = useState<Origen | null>(null);
  const [rango, setRango] = useState<{ desde: string; hasta: string } | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  // Escapar cierra, salvo mientras se descarga: ahí cerrar por accidente deja
  // la consulta corriendo sin nada que enseñe su avance.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !cargando) onCerrar();
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [onCerrar, cargando]);

  const elegirOrigen = (id: Origen) => {
    setOrigen(id);
    if (id === 'envista' || id === 'validado') return setPaso('archivo');
    // Sin token no hay consulta posible; se pide antes que las fechas para no
    // hacer elegirlas dos veces.
    if (id === 'emisiones' && !sesionEmisiones.activa) return setPaso('acceso');
    setPaso('periodo');
  };

  const tomarArchivo = async (archivo: File | undefined) => {
    if (!archivo || !origen) return;
    await cargarArchivo(archivo, origen as OrigenArchivo);
    onCerrar();
  };

  const confirmar = async () => {
    if (rango) setPeriodo(rango);
    if (origen === 'simaj') await cargarSimaj();
    else await cargarEmisiones();
    onCerrar();
  };

  const dias = diasDelPeriodo(rango ?? periodo);
  const demasiado = origen === 'emisiones' && dias > DIAS_MAXIMOS;
  const largo = origen === 'emisiones' && dias > DIAS_AVISO && !demasiado;

  const atras = () => {
    if (paso === 'confirmar' && ES_DE_RED(origen)) return setPaso('periodo');
    if (paso === 'periodo' && origen === 'emisiones' && !sesionEmisiones.activa) {
      return setPaso('acceso');
    }
    setPaso('origenes');
    setOrigen(null);
  };

  const titulos: Record<Paso, string> = {
    origenes: 'Consultar datos',
    archivo: 'Elegir el archivo',
    acceso: 'Entrar en la API de Emisiones',
    periodo: 'Elegir el periodo',
    confirmar: origen === 'simaj' ? 'Descargar del SIMAJ' : 'Consultar la API',
  };

  const pct = progresoSimaj && progresoSimaj.total > 0
    ? Math.round((progresoSimaj.hechos / progresoSimaj.total) * 100)
    : 0;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => { if (!cargando) onCerrar(); }}
      role="presentation"
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={titulos[paso]}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
          {paso !== 'origenes' && !cargando && (
            <button
              type="button"
              onClick={atras}
              aria-label="Atrás"
              className="p-1 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          <h2 className="font-semibold text-slate-800 flex-1">{titulos[paso]}</h2>
          <button
            type="button"
            onClick={onCerrar}
            disabled={cargando}
            aria-label="Cerrar"
            className="p-1 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Elegir el origen ── */}
        {paso === 'origenes' && (
          <div className="p-4 space-y-2">
            {ORIGENES.map(({ id, etiqueta, detalle, icono: Icono }) => (
              <button
                key={id}
                type="button"
                onClick={() => elegirOrigen(id)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-slate-200 text-left hover:border-primary-400 hover:bg-primary-50/40 transition-colors"
              >
                <Icono size={20} className="shrink-0 text-primary-600" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-800">{etiqueta}</span>
                  <span className="block text-xs text-slate-500 leading-snug">{detalle}</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-slate-300" />
              </button>
            ))}
          </div>
        )}

        {/* ── Soltar o buscar el archivo ── */}
        {paso === 'archivo' && (
          <div className="p-4">
            <div
              onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={(e) => {
                e.preventDefault();
                setArrastrando(false);
                tomarArchivo(e.dataTransfer.files?.[0]);
              }}
              onClick={() => entrada.current?.click()}
              role="presentation"
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                arrastrando
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-slate-300 hover:border-primary-400 hover:bg-slate-50'
              }`}
            >
              {cargando ? (
                <>
                  <RefreshCw size={32} className="mx-auto text-primary-500 mb-3 animate-spin" />
                  <p className="text-slate-600">Procesando el archivo…</p>
                </>
              ) : (
                <>
                  <UploadCloud size={32} className="mx-auto text-slate-400 mb-3" />
                  <p className="text-slate-700">
                    Arrastra el archivo aquí o haz clic para buscarlo
                  </p>
                  <p className="text-xs text-slate-500 mt-1">.xlsx, .xls o .csv</p>
                </>
              )}
            </div>

            <input
              ref={entrada}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const archivo = e.target.files?.[0];
                e.target.value = '';   // permite volver a elegir el mismo
                tomarArchivo(archivo);
              }}
            />

            {error && !cargando && (
              <p className="mt-3 flex items-start gap-1.5 text-xs text-red-700">
                <AlertCircle size={14} className="shrink-0 mt-px" />
                {error}
              </p>
            )}
          </div>
        )}

        {/* ── Acceso a Emisiones ── */}
        {paso === 'acceso' && (
          <div className="p-4">
            <AccesoEmisiones onEntrado={() => setPaso('periodo')} />
          </div>
        )}

        {/* ── Periodo ── */}
        {paso === 'periodo' && (
          <>
            <PanelCalendario
              desde={periodo.desde}
              hasta={periodo.hasta}
              onRango={setRango}
            />
            <div className="flex justify-end px-4 py-3 border-t border-slate-200">
              <button
                type="button"
                disabled={!rango}
                onClick={() => setPaso('confirmar')}
                className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Siguiente
              </button>
            </div>
          </>
        )}

        {/* ── Confirmar y traer los datos ── */}
        {paso === 'confirmar' && (
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <CalendarDays size={16} className="shrink-0 text-slate-400" />
              <span className="text-sm text-slate-700">
                {(rango ?? periodo).desde} — {(rango ?? periodo).hasta}
                <span className="text-slate-400 tabular-nums"> · {dias} días</span>
              </span>
            </div>

            {origen === 'emisiones' && sesionEmisiones.email && (
              <p className="text-xs text-slate-500">
                Sesión de {sesionEmisiones.email}
              </p>
            )}

            {demasiado && (
              <p className="text-xs text-amber-700 leading-snug">
                Esta API no acepta más de {DIAS_MAXIMOS} días por consulta.
                Vuelve atrás y acorta el periodo.
              </p>
            )}
            {largo && (
              <p className="text-xs text-slate-500 leading-snug">
                {dias} días es un periodo largo: la primera consulta puede tardar
                un par de minutos. Las siguientes van rápidas, porque los días ya
                descargados quedan guardados.
              </p>
            )}

            {cargando && progresoSimaj && (
              <div>
                <div className="flex justify-between text-xs text-slate-500 mb-1 tabular-nums">
                  <span className="truncate">
                    {progresoSimaj.estacion} ({progresoSimaj.indice}/{progresoSimaj.estaciones})
                  </span>
                  <span>{pct}%</span>
                </div>
                <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-500 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}

            {error && !cargando && (
              <p className="flex items-start gap-1.5 text-xs text-red-700">
                <AlertCircle size={14} className="shrink-0 mt-px" />
                {error}
              </p>
            )}

            <button
              type="button"
              disabled={cargando || demasiado}
              onClick={confirmar}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {cargando
                ? <RefreshCw size={15} className="animate-spin" />
                : origen === 'simaj' ? <DownloadCloud size={15} /> : <Search size={15} />}
              {cargando
                ? 'Trayendo los datos…'
                : origen === 'simaj' ? 'Descargar' : 'Consultar'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
