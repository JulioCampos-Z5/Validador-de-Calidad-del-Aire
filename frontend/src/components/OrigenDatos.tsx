import { useEffect, useRef, useState } from 'react';
import {
  FileSpreadsheet, FileCheck2, DownloadCloud, RefreshCw, X,
  ChevronDown, FileDown, Table2, Radio,
} from 'lucide-react';
import { useDatos, type Origen, type OrigenArchivo } from '../estado/DatosContexto';
import apiService from '../services/api';
import { minutalesApi, type Progreso } from '../services/minutales';
import PanelEmisiones from './PanelEmisiones';
import SelectorPeriodo from './SelectorPeriodo';

/**
 * Carga y exportación de datos, en el menú lateral.
 *
 * Va aquí y no dentro de una página porque el conjunto de datos es del sistema
 * entero, no de una pantalla: se carga una vez y tanto el tablero como las
 * gráficas leen lo mismo.
 *
 * Es un único acordeón y cada botón cabe en una línea: el verbo va en la propia
 * etiqueta ("Importar archivo ENVISTA") en vez de en un rótulo de sección
 * aparte. La explicación de cada opción vive en el tooltip, no debajo del
 * botón: en una barra de 256 px, tres líneas por opción convertían el menú en
 * un muro de texto.
 */

const ORIGENES: {
  id: Origen;
  etiqueta: string;
  detalle: string;
  icono: typeof FileSpreadsheet;
}[] = [
  {
    id: 'envista',
    etiqueta: 'Importar archivo ENVISTA',
    detalle: 'Trs.xlsx o .csv crudo. Se convierte y se valida.',
    icono: FileSpreadsheet,
  },
  {
    id: 'validado',
    etiqueta: 'Importar archivo validado',
    detalle: 'BD_{año}.xlsx o .csv procesado. Solo se muestra.',
    icono: FileCheck2,
  },
  {
    id: 'simaj',
    etiqueta: 'Importar del SIMAJ',
    detalle: 'Descarga directa de las 13 estaciones.',
    icono: DownloadCloud,
  },
  {
    id: 'emisiones',
    etiqueta: 'Importar de Emisiones',
    detalle: 'API de emisiones.jalisco.gob.mx. Pide iniciar sesión.',
    icono: Radio,
  },
];

/** Agrupa filas sin rótulo encima: la etiqueta de cada botón ya dice la acción. */
function Grupo({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1 mt-1 first:mt-0">{children}</div>;
}

/** Fila de una línea. `detalle` no se pinta: va al tooltip del botón. */
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
  const clases = `w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors disabled:opacity-50 ${
    activo ? 'bg-primary-50 text-primary-700' : 'text-slate-600 hover:bg-slate-100'
  }`;
  const contenido = (
    <>
      <Icono size={17} className="shrink-0" />
      <span className="text-sm font-medium leading-tight min-w-0">{etiqueta}</span>
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
    resultado, mir, contaminantesMir, periodo,
  } = useDatos();

  const [abierto, setAbierto] = useState(true);
  const [panelSimaj, setPanelSimaj] = useState(false);
  const [panelEmisiones, setPanelEmisiones] = useState(false);
  const [progreso, setProgreso] = useState<Progreso | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const sondeo = useRef<number | null>(null);

  // El sondeo se detiene siempre al desmontar: si no, seguiría corriendo y
  // escribiría estado de un componente ya destruido.
  useEffect(() => () => { if (sondeo.current) window.clearInterval(sondeo.current); }, []);

  const elegir = (id: Origen) => {
    if (cargando) return;
    if (id === 'simaj') {
      setPanelEmisiones(false);
      setPanelSimaj((v) => !v);
      return;
    }
    if (id === 'emisiones') {
      setPanelSimaj(false);
      setPanelEmisiones((v) => !v);
      return;
    }
    setPanelSimaj(false);
    setPanelEmisiones(false);
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
    const modo = e.target.dataset.modo as OrigenArchivo | undefined;
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (archivo && modo) cargarArchivo(archivo, modo);
  };

  // El SIMAJ acepta periodos largos, así que aquí solo estorba el rango
  // imposible; el tope de 31 días es cosa de la API de Emisiones.
  const periodoInvertido =
    new Date(periodo.hasta).getTime() <= new Date(periodo.desde).getTime();

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
      await cargarSimaj();
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
        <>
          <SelectorPeriodo />
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
                {/* Sin selector de fechas propio: el periodo se elige arriba,
                    una sola vez y para todos los orígenes. */}
                <button
                  type="button"
                  onClick={descargar}
                  disabled={cargando || periodoInvertido}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
                >
                  {cargando ? <RefreshCw size={14} className="animate-spin" /> : <DownloadCloud size={14} />}
                  {cargando ? 'Descargando…' : 'Descargar'}
                </button>
              </div>
            )}

            {panelEmisiones && <PanelEmisiones />}
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
                  etiqueta="Exportar validación"
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
                  etiqueta="Exportar reporte MIR"
                  detalle="CSV con cobertura por estación y cumplimiento."
                />
              )}
            </Grupo>
          )}
          </div>
        </>
      )}
    </div>
  );
}
