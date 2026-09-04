import { useEffect, useRef, useState } from 'react';
import {
  FileSpreadsheet, FileCheck2, DownloadCloud, RefreshCw, X,
  ChevronDown, FileDown, Table2,
} from 'lucide-react';
import { useDatos, type Origen } from '../estado/DatosContexto';
import apiService from '../services/api';
import { minutalesApi, type Progreso } from '../services/minutales';

/**
 * Carga y exportación de datos, en el menú lateral.
 *
 * Va aquí y no dentro de una página porque el conjunto de datos es del sistema
 * entero, no de una pantalla: se carga una vez y tanto el tablero como las
 * gráficas leen lo mismo.
 *
 * Es un único acordeón, y cada botón enuncia la acción entera —"Cargar datos de
 * un archivo ENVISTA"— en vez de apoyarse en un rótulo de sección. Un nombre
 * suelto como "Archivo ENVISTA" bajo un título "Origen" obliga a relacionar dos
 * cosas separadas para entender qué hace el botón; dicho completo, se entiende
 * mirando solo el botón.
 */

const ORIGENES: {
  id: Origen;
  etiqueta: string;
  detalle: string;
  icono: typeof FileSpreadsheet;
}[] = [
  {
    id: 'envista',
    etiqueta: 'Cargar datos de un archivo ENVISTA',
    detalle: 'Trs.xlsx o .csv crudo. Se convierte y se valida.',
    icono: FileSpreadsheet,
  },
  {
    id: 'validado',
    etiqueta: 'Cargar datos de un archivo ya validado',
    detalle: 'BD_{año}.xlsx o .csv procesado. Solo se muestra.',
    icono: FileCheck2,
  },
  {
    id: 'simaj',
    etiqueta: 'Cargar datos de la conexión al SIMAJ',
    detalle: 'Descarga directa de las 13 estaciones.',
    icono: DownloadCloud,
  },
];

/**
 * Agrupa filas sin rótulo encima: cada botón dice ya la acción completa
 * ("Cargar datos de un archivo ENVISTA"), así que un título repetiría lo mismo.
 */
function Grupo({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1 mt-1 first:mt-0">{children}</div>;
}

/** Fila con icono, nombre y explicación. La usan la carga y la exportación. */
function Fila({
  icono: Icono, etiqueta, detalle, activo, ...resto
}: {
  icono: typeof FileSpreadsheet;
  etiqueta: string;
  detalle: string;
  activo?: boolean;
} & (
  | ({ as: 'boton' } & React.ButtonHTMLAttributes<HTMLButtonElement>)
  | ({ as: 'enlace' } & React.AnchorHTMLAttributes<HTMLAnchorElement>)
)) {
  const clases = `w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors disabled:opacity-50 ${
    activo ? 'bg-primary-50 text-primary-700' : 'text-slate-600 hover:bg-slate-100'
  }`;
  const contenido = (
    <>
      <Icono size={17} className="mt-0.5 shrink-0" />
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-tight">{etiqueta}</span>
        <span className="block text-[11px] text-slate-400 leading-snug mt-0.5">{detalle}</span>
      </span>
    </>
  );

  if (resto.as === 'enlace') {
    const { as: _, ...props } = resto;
    return <a className={clases} title={detalle} {...props}>{contenido}</a>;
  }
  const { as: _, ...props } = resto;
  return <button type="button" className={clases} title={detalle} {...props}>{contenido}</button>;
}

export default function OrigenDatos() {
  const {
    cargarArchivo, cargarSimaj, cargando, origen, descripcion, error, limpiar,
    resultado, mir, contaminantesMir,
  } = useDatos();

  const [abierto, setAbierto] = useState(true);
  const [panelSimaj, setPanelSimaj] = useState(false);
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
      setPanelSimaj((v) => !v);
      return;
    }
    setPanelSimaj(false);
    // El modo viaja en el propio input: el diálogo del sistema es asíncrono y
    // guardarlo en estado abriría la puerta a que llegue el archivo con un modo
    // ya cambiado.
    if (entrada.current) {
      entrada.current.dataset.modo = id;
      entrada.current.click();
    }
  };

  const alElegirArchivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    const modo = e.target.dataset.modo as Exclude<Origen, 'simaj'> | undefined;
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (archivo && modo) cargarArchivo(archivo, modo);
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
      setPanelSimaj(false);
    } finally {
      if (sondeo.current) window.clearInterval(sondeo.current);
      setProgreso(null);
    }
  };

  const pct = progreso && progreso.total > 0
    ? Math.round((progreso.hechos / progreso.total) * 100)
    : 0;

  return (
    <div className="border-t border-slate-200">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="w-full flex items-center justify-between px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hover:bg-slate-50"
      >
        Datos
        <ChevronDown size={15} className={`transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>

      {abierto && (
        <div className="px-3 pb-4">
          <input
            ref={entrada}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={alElegirArchivo}
            className="hidden"
          />

          <Grupo>
            {ORIGENES.map(({ id, etiqueta, detalle, icono }) => (
              <Fila
                key={id}
                as="boton"
                icono={icono}
                etiqueta={etiqueta}
                detalle={detalle}
                activo={origen === id}
                disabled={cargando}
                onClick={() => elegir(id)}
              />
            ))}

            {panelSimaj && (
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
          </Grupo>

          {cargando && (
            <div className="px-2.5 pt-3">
              {progreso ? (
                <>
                  <div className="flex justify-between text-[11px] text-slate-500 mb-1 tabular-nums">
                    <span className="truncate">
                      {progreso.estacion} ({progreso.indice}/{progreso.estaciones})
                    </span>
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
            <div className="mx-2.5 mt-3 px-2.5 py-2 rounded-md bg-green-50 border border-green-200">
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

          {error && !cargando && (
            <p className="mx-2.5 mt-3 px-2.5 py-2 rounded-md bg-red-50 border border-red-200 text-[11px] text-red-700 leading-snug">
              {error}
            </p>
          )}

          {resultado && !cargando && (
            <Grupo>
              {resultado.output_filename && (
                <Fila
                  as="enlace"
                  href={apiService.downloadFile(resultado.output_filename)}
                  icono={FileDown}
                  etiqueta="Exportando datos de la validación completa"
                  detalle="Excel con datos, banderas y resúmenes."
                />
              )}

              {/* El reporte MIR solo existe si los datos vienen del SIMAJ: un
                  archivo no dice qué horas debería haber en el periodo. */}
              {mir && (
                <Fila
                  as="enlace"
                  href={minutalesApi.urlReporteCsv(contaminantesMir)}
                  icono={Table2}
                  etiqueta="Exportando datos del indicador MIR"
                  detalle="CSV con cobertura por estación y cumplimiento."
                />
              )}
            </Grupo>
          )}
        </div>
      )}
    </div>
  );
}
