import { useEffect, useRef, useState } from 'react';
import {
  RefreshCw, X, ChevronDown, FileDown, Table2, Database,
  Upload, FileInput, DownloadCloud, Radio,
} from 'lucide-react';
import { useDatos, type Origen } from '../estado/DatosContexto';
import apiService from '../services/api';
import { minutalesApi } from '../services/minutales';
import SelectorPeriodo from './SelectorPeriodo';
import ModalDatos from './ModalDatos';
import { clasesIcono, useMenu } from './menu';

/**
 * Bloque de datos del menú: traer datos y exportarlos.
 *
 * Un solo botón que despliega los cuatro orígenes. Antes eran cuatro botones
 * sueltos y cada uno abría su panel dentro de una columna de 256 px, donde el
 * calendario no cabía y el formulario de acceso quedaba apretado.
 *
 * La lista cuelga del botón; lo que se abre en un diálogo es lo que viene
 * después —el archivo, el acceso, el periodo—, que sí necesita espacio. Ver
 * `ModalDatos`.
 *
 * Lo que se queda aquí es el estado: qué hay cargado, cómo va la descarga y qué
 * se puede exportar. Eso conviene tenerlo a la vista sin abrir nada.
 */

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


export default function OrigenDatos() {
  const {
    cargando, descripcion, error, limpiar, resultado, mir, contaminantesMir,
    progresoSimaj,
  } = useDatos();
  const { plegado, desplegar } = useMenu();

  const [lista, setLista] = useState(false);
  const [modal, setModal] = useState<Origen | null>(null);
  const caja = useRef<HTMLDivElement>(null);

  // La lista se cierra al pulsar fuera o con Escape. Un desplegable que solo se
  // cierra volviendo a su botón se queda abierto estorbando.
  useEffect(() => {
    if (!lista) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setLista(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setLista(false); };
    document.addEventListener('mousedown', fuera);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', fuera);
      window.removeEventListener('keydown', escape);
    };
  }, [lista]);

  const elegir = (id: Origen) => {
    setLista(false);
    setModal(id);
  };

  const pct = progresoSimaj && progresoSimaj.total > 0
    ? Math.round((progresoSimaj.hechos / progresoSimaj.total) * 100)
    : 0;

  const dialogo = modal ? <ModalDatos origen={modal} onCerrar={() => setModal(null)} /> : null;

  const exportaciones = resultado && !cargando ? (
    <>
      {resultado.output_filename && (
        <a
          href={apiService.downloadFile(resultado.output_filename)}
          title="Exportar validación. Excel con datos, banderas y resúmenes."
          aria-label="Exportar validación"
          className={plegado
            ? clasesIcono()
            : 'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-slate-600 hover:bg-slate-100 transition-colors'}
        >
          <FileDown size={plegado ? 20 : 17} className="shrink-0" />
          {!plegado && <span className="text-sm font-medium">Exportar validación</span>}
        </a>
      )}

      {/* El reporte MIR solo existe si los datos vienen del SIMAJ: un archivo no
          dice qué horas debería haber en el periodo. */}
      {mir && (
        <a
          href={minutalesApi.urlReporteCsv(contaminantesMir)}
          title="Exportar reporte MIR. CSV con cobertura por estación."
          aria-label="Exportar reporte MIR"
          className={plegado
            ? clasesIcono()
            : 'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-slate-600 hover:bg-slate-100 transition-colors'}
        >
          <Table2 size={plegado ? 20 : 17} className="shrink-0" />
          {!plegado && <span className="text-sm font-medium">Exportar reporte MIR</span>}
        </a>
      )}
    </>
  ) : null;

  if (plegado) {
    // Plegada se ven todos los iconos: el periodo, el de traer datos y las
    // exportaciones disponibles. Un icono que desaparece al plegar es una
    // función que deja de existir.
    return (
      <div className="border-t border-slate-200 pt-2 flex flex-col items-center gap-1">
        <button
          type="button"
          // Plegada no hay sitio para la lista, y sacarla fuera la recortaría el
          // desplazamiento de la barra. Se despliega y se abre ahí.
          onClick={() => { desplegar(); setLista(true); }}
          disabled={cargando}
          title="Consultar datos: archivo, SIMAJ o API de Emisiones"
          aria-label="Consultar datos"
          className="p-3 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
        >
          {cargando ? <RefreshCw size={20} className="animate-spin" /> : <Database size={20} />}
        </button>

        <SelectorPeriodo />

        {exportaciones}

        {descripcion && !cargando && (
          <span
            title={`Cargado: ${descripcion}`}
            className="mt-1 h-2 w-2 rounded-full bg-green-500"
            aria-label={`Cargado: ${descripcion}`}
          />
        )}

        {dialogo}
      </div>
    );
  }

  return (
    <div className="border-t border-slate-200 pt-3">
      <div className="px-3 pb-2 space-y-1">
        <div ref={caja}>
          <button
            type="button"
            onClick={() => setLista((v) => !v)}
            disabled={cargando}
            aria-expanded={lista}
            aria-haspopup="menu"
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {cargando ? <RefreshCw size={15} className="animate-spin" /> : <Database size={15} />}
            {cargando ? 'Trayendo datos…' : 'Consultar datos'}
            {!cargando && (
              <ChevronDown
                size={14}
                className={`transition-transform ${lista ? 'rotate-180' : ''}`}
              />
            )}
          </button>

          {lista && !cargando && (
            <div role="menu" className="mt-1 rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
              {ORIGENES.map(({ id, etiqueta, detalle, icono: Icono }) => (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  onClick={() => elegir(id)}
                  title={detalle}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left hover:bg-slate-50 transition-colors"
                >
                  <Icono size={17} className="shrink-0 text-primary-600" />
                  <span className="text-sm text-slate-700 leading-tight">{etiqueta}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <SelectorPeriodo />

        {cargando && (
          <div className="px-0.5 pt-2">
            {progresoSimaj ? (
              <>
                <div className="flex justify-between text-[11px] text-slate-500 mb-1 tabular-nums">
                  <span className="truncate">
                    {progresoSimaj.estacion} ({progresoSimaj.indice}/{progresoSimaj.estaciones})
                  </span>
                  <span>{pct}%</span>
                </div>
                <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-500 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-[11px] text-slate-500">Procesando…</p>
            )}
          </div>
        )}

        {descripcion && !cargando && (
          <div className="mt-2 px-2.5 py-2 rounded-md bg-green-50 border border-green-200">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] text-green-800 leading-snug break-words min-w-0">
                Cargado: {descripcion}
              </p>
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

        {/* El error del asistente se ve dentro del propio asistente; este es
            para cuando ya se cerró y se quiere volver a leer qué pasó. */}
        {error && !cargando && !modal && (
          <p className="mt-2 px-2.5 py-2 rounded-md bg-red-50 border border-red-200 text-[11px] text-red-700 leading-snug">
            {error}
          </p>
      )}

      {exportaciones}
      </div>

      {dialogo}
    </div>
  );
}
