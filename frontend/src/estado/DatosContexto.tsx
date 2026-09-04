import { createContext, useCallback, useContext, useMemo, useState,
  type Dispatch, type ReactNode, type SetStateAction } from 'react';
import apiService, { type ValidationResponse } from '../services/api';
import { minutalesApi, CONTAMINANTES_CRITERIO, type Mir, type Falla } from '../services/minutales';

/**
 * Estado compartido del conjunto de datos cargado.
 *
 * Antes cada página guardaba su propio resultado en un useState local, así que
 * ir del tablero a las gráficas obligaba a volver a cargar los datos: el estado
 * moría al desmontar la página. Con la descarga del SIMAJ eso pasó de molesto a
 * inaceptable, porque son decenas de miles de peticiones cada vez.
 *
 * Aquí viven los datos y la configuración de validación, de modo que el origen
 * se elige una vez —desde el menú— y todas las páginas leen lo mismo.
 */

export type Origen = 'envista' | 'validado' | 'simaj';

export interface ConfigValidacion {
  rangos: boolean;
  temperatura: boolean;
  series: boolean;
  series_constantes: boolean;
  series_nox: boolean;
  series_pm: boolean;
  nox_tolerance: number;
  pm_tolerance: number;
  rangos_custom: Record<string, { min: number; max: number }>;
  temp_min: number;
  temp_max: number;
}

interface Estado {
  resultado: ValidationResponse | null;
  /** Solo lo hay cuando los datos vienen del SIMAJ: necesita las horas esperadas. */
  mir: Mir | null;
  fallas: Falla[];
  contaminantesMir: string[];
  origen: Origen | null;
  descripcion: string | null;
  cargando: boolean;
  error: string | null;
  exito: string | null;
  revalidar: boolean;
  config: ConfigValidacion;

  // Se expone el setter de useState tal cual (acepta la forma funcional
  // `setConfig(prev => ...)`), que es como el editor de parametros lo usa.
  setConfig: Dispatch<SetStateAction<ConfigValidacion>>;
  setRevalidar: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  cargarArchivo: (archivo: File, origen: Exclude<Origen, 'simaj'>) => Promise<void>;
  cargarSimaj: (meses: number) => Promise<void>;
  cambiarContaminantesMir: (c: string[]) => Promise<void>;
  limpiar: () => void;
}

export const CONFIG_POR_DEFECTO: ConfigValidacion = {
  rangos: true,
  temperatura: true,
  series: true,
  series_constantes: true,
  series_nox: true,
  series_pm: true,
  nox_tolerance: 0.10,
  pm_tolerance: 0.15,
  rangos_custom: {
    O3: { min: -0.003, max: 0.5 }, SO2: { min: -0.003, max: 0.5 },
    NO2: { min: -0.003, max: 0.5 }, NO: { min: -0.003, max: 0.5 },
    NOX: { min: -0.006, max: 0.5 }, CO: { min: -0.04, max: 50 },
    PM10: { min: 0, max: 900 }, 'PM2.5': { min: 0, max: 900 },
    ET: { min: -5, max: 50 }, IT: { min: 0, max: 50 },
    RH: { min: 0, max: 100 }, WS: { min: 0, max: 50 },
    WD: { min: 0, max: 360 }, PP: { min: 0, max: 10 },
    ATM: { min: 500, max: 760 }, RS: { min: 0, max: 2000 },
    UVI: { min: 0, max: 300 },
  },
  temp_min: 20,
  temp_max: 30,
};

const Contexto = createContext<Estado | null>(null);

export function useDatos(): Estado {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useDatos debe usarse dentro de <DatosProvider>');
  return ctx;
}

export function DatosProvider({ children }: { children: ReactNode }) {
  const [resultado, setResultado] = useState<ValidationResponse | null>(null);
  const [mir, setMir] = useState<Mir | null>(null);
  const [fallas, setFallas] = useState<Falla[]>([]);
  const [contaminantesMir, setContaminantesMir] = useState<string[]>(CONTAMINANTES_CRITERIO);
  const [origen, setOrigen] = useState<Origen | null>(null);
  const [descripcion, setDescripcion] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [revalidar, setRevalidar] = useState(true);
  const [config, setConfig] = useState<ConfigValidacion>(CONFIG_POR_DEFECTO);

  const configBackend = useCallback(() => ({
    rangos: config.rangos,
    temperatura: config.temperatura,
    series: config.series,
    series_constantes: config.series_constantes,
    series_nox: config.series_nox,
    series_pm: config.series_pm,
    nox_tolerance: config.nox_tolerance,
    pm_tolerance: config.pm_tolerance,
    rangos_custom: config.rangos ? config.rangos_custom : undefined,
    temp_min: config.temp_min,
    temp_max: config.temp_max,
  }), [config]);

  const limpiar = useCallback(() => {
    setResultado(null);
    setMir(null);
    setFallas([]);
    setOrigen(null);
    setDescripcion(null);
    setError(null);
    setExito(null);
  }, []);

  const cargarArchivo = useCallback(async (archivo: File, modo: Exclude<Origen, 'simaj'>) => {
    setCargando(true);
    setError(null);
    setExito(null);
    try {
      const subida = await apiService.uploadFile(archivo);
      const r = modo === 'validado'
        ? await apiService.previewValidated(subida.filename)
        : await apiService.validateFull(subida.filename, configBackend(), revalidar);

      setResultado(r);
      // Un archivo no permite calcular el MIR: no dice qué horas debería haber
      // en el periodo, solo las que trae.
      setMir(null);
      setFallas([]);
      setOrigen(modo);
      setDescripcion(archivo.name);
      setExito(`${r.summary.total_registros.toLocaleString()} registros de ${archivo.name}.`);
    } catch (e) {
      const detalle = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      setError(detalle ?? 'Error al procesar el archivo.');
    } finally {
      setCargando(false);
    }
  }, [configBackend, revalidar]);

  const cargarSimaj = useCallback(async (meses: number) => {
    setCargando(true);
    setError(null);
    setExito(null);
    try {
      const r = await minutalesApi.descargar(meses, contaminantesMir, configBackend());
      setResultado(r);
      setMir(r.mir ?? null);
      setFallas(r.fallas ?? []);
      setOrigen('simaj');
      setDescripcion(`SIMAJ · ${r.summary.fecha_inicio} a ${r.summary.fecha_fin}`);
      setExito(
        `Descargados ${r.summary.total_registros.toLocaleString()} registros ` +
        `de ${r.summary.estaciones} estaciones.`,
      );
    } catch (e) {
      const detalle = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      setError(detalle ?? 'No se pudo descargar del SIMAJ.');
    } finally {
      setCargando(false);
    }
  }, [configBackend, contaminantesMir]);

  const cambiarContaminantesMir = useCallback(async (nuevos: string[]) => {
    setContaminantesMir(nuevos);
    try {
      const r = await minutalesApi.recalcularMir(nuevos);
      setMir(r.mir);
      setFallas(r.fallas);
    } catch {
      setError('No se pudo recalcular el indicador MIR.');
    }
  }, []);

  const valor = useMemo<Estado>(() => ({
    resultado, mir, fallas, contaminantesMir, origen, descripcion,
    cargando, error, exito, revalidar, config,
    setConfig, setRevalidar, setError,
    cargarArchivo, cargarSimaj, cambiarContaminantesMir, limpiar,
  }), [
    resultado, mir, fallas, contaminantesMir, origen, descripcion,
    cargando, error, exito, revalidar, config,
    cargarArchivo, cargarSimaj, cambiarContaminantesMir, limpiar,
  ]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
