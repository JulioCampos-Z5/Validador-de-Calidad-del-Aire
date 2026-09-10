import { createContext, useCallback, useContext, useEffect, useMemo, useState,
  type Dispatch, type ReactNode, type SetStateAction } from 'react';
import apiService, { type ValidationResponse } from '../services/api';
import { minutalesApi, CONTAMINANTES_CRITERIO, type Mir, type Falla, type Progreso } from '../services/minutales';
import { emisionesApi, type SesionEmisiones } from '../services/emisiones';

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

export type Origen = 'envista' | 'validado' | 'simaj' | 'emisiones';

/** Los origenes que entran por un archivo del disco; los otros dos son de red. */
export type OrigenArchivo = Extract<Origen, 'envista' | 'validado'>;

/**
 * Periodo a consultar, en 'AAAA-MM-DD'. Vive aqui y no en cada panel porque es
 * una propiedad de lo que se quiere mirar, no del sitio de donde se baja: al
 * comparar el SIMAJ con la API de Emisiones hay que pedirles el mismo tramo, y
 * con un selector por panel es facil que no coincidan sin que se note.
 */
export interface Periodo {
  desde: string;
  /** Inclusivo: el dia elegido entra en la consulta. Ver `rangoConsultable`. */
  hasta: string;
}

/**
 * Pasa el periodo que se ve en pantalla al rango que esperan los backends.
 *
 * En el calendario, pulsar el 5 y el 20 significa «del 5 al 20, ambos
 * incluidos» — es lo que entiende cualquiera al marcar dos dias. Los backends,
 * en cambio, tratan `hasta` como excluyente, que es lo correcto para un rango
 * de horas.
 *
 * Traducir aqui, en el borde, evita el error silencioso que habia antes: elegir
 * «1 a 7 de septiembre» devolvia datos hasta el 6 y nadie se enteraba de que
 * faltaba el ultimo dia.
 */
export function rangoConsultable(periodo: Periodo): { desde: string; hasta: string } {
  const fin = new Date(`${periodo.hasta}T00:00:00`);
  fin.setDate(fin.getDate() + 1);
  const iso = `${fin.getFullYear()}-${String(fin.getMonth() + 1).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`;
  return { desde: periodo.desde, hasta: iso };
}

/** Dias que abarca el periodo, contando los dos extremos. */
export function diasDelPeriodo(periodo: Periodo): number {
  const ms = new Date(`${periodo.hasta}T00:00:00`).getTime()
    - new Date(`${periodo.desde}T00:00:00`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export interface ConfigValidacion {
  rangos: boolean;
  temperatura: boolean;
  series: boolean;
  series_constantes: boolean;
  series_nox: boolean;
  series_pm: boolean;
  series_radiacion: boolean;
  series_viento: boolean;
  series_temp_externa: boolean;
  series_presion: boolean;
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
  /** Sesión con la API de Emisiones. El token vive en el backend, no aquí. */
  sesionEmisiones: SesionEmisiones;
  /** Periodo elegido, común a todos los orígenes de red. */
  periodo: Periodo;
  /** Avance de la descarga del SIMAJ en curso, o null si no hay ninguna. */
  progresoSimaj: Progreso | null;
  setPeriodo: Dispatch<SetStateAction<Periodo>>;
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
  cargarArchivo: (archivo: File, origen: OrigenArchivo) => Promise<void>;
  // Aceptan el periodo explicito porque quien las llama acaba de elegirlo: si
  // se dejara leer del estado, la primera descarga tras cambiar las fechas se
  // haria con las anteriores. Ver la nota en `cargarSimaj`.
  cargarSimaj: (rango?: Periodo) => Promise<void>;
  cargarEmisiones: (rango?: Periodo) => Promise<void>;
  entrarEmisiones: (email: string, password: string, recordar?: boolean) => Promise<void>;
  salirEmisiones: () => Promise<void>;
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
  series_radiacion: true,
  series_viento: true,
  series_temp_externa: true,
  // Desactivada a proposito: con el umbral de 0.75 mmHg del script, medido
  // contra un mes de la red, marca el 54.6% de los datos. Ver la nota de
  // SALTO_ATM en app.py.
  series_presion: false,
  nox_tolerance: 0.15,
  pm_tolerance: 0.15,
  rangos_custom: {
    O3: { min: -0.003, max: 0.5 }, SO2: { min: -0.003, max: 0.5 },
    NO2: { min: -0.003, max: 0.5 }, NO: { min: -0.003, max: 0.5 },
    NOX: { min: -0.006, max: 0.5 }, CO: { min: -0.04, max: 50 },
    PM10: { min: 0, max: 1000 }, 'PM2.5': { min: 0, max: 1000 },
    ET: { min: -5, max: 50 }, IT: { min: 0, max: 50 },
    RH: { min: 0, max: 100 }, WS: { min: 0, max: 50 },
    WD: { min: 0, max: 360 }, PP: { min: 0, max: 10 },
    ATM: { min: 500, max: 760 }, RS: { min: 0, max: 2000 },
    UVI: { min: 0, max: 300 },
  },
  temp_min: 20,
  temp_max: 30,
};

/** Fecha de hace `dias` dias, en el formato que espera <input type=date>. */
function isoDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Ultimos 30 dias. Mantiene lo que hacia el SIMAJ por defecto ("ultimo mes") y
 * cabe en el tope de 31 dias por consulta de la API de Emisiones, asi que el
 * mismo periodo inicial sirve para los dos origenes sin que ninguno arranque
 * en un estado invalido.
 */
export const PERIODO_POR_DEFECTO: Periodo = { desde: isoDias(29), hasta: isoDias(0) };

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
  const [sesionEmisiones, setSesionEmisiones] = useState<SesionEmisiones>({
    activa: false, email: null, caduca: null, recordada: false,
  });
  const [periodo, setPeriodo] = useState<Periodo>(PERIODO_POR_DEFECTO);
  const [progresoSimaj, setProgresoSimaj] = useState<Progreso | null>(null);

  // El token vive en el backend y sobrevive a un recargado de la pagina, asi
  // que al arrancar hay que preguntar si sigue vivo: si no, la interfaz
  // mostraria el formulario de acceso con una sesion perfectamente valida
  // abierta al otro lado.
  useEffect(() => {
    emisionesApi.sesion().then(setSesionEmisiones).catch(() => {
      // Backend aun levantando; el estado por defecto (sin sesion) ya sirve.
    });
  }, []);

  const configBackend = useCallback(() => ({
    rangos: config.rangos,
    temperatura: config.temperatura,
    series: config.series,
    series_constantes: config.series_constantes,
    series_nox: config.series_nox,
    series_pm: config.series_pm,
    series_radiacion: config.series_radiacion,
    series_viento: config.series_viento,
    series_temp_externa: config.series_temp_externa,
    series_presion: config.series_presion,
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

  const cargarArchivo = useCallback(async (archivo: File, modo: OrigenArchivo) => {
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

  /**
   * Descarga del SIMAJ.
   *
   * El rango llega por parametro y no se lee de `periodo` a proposito. El
   * asistente hace `setPeriodo(rango)` y acto seguido llama aqui, y en ese
   * momento el estado todavia es el anterior: React no lo actualiza hasta el
   * siguiente render. El sintoma era desconcertante —se elegian 7 dias y se
   * descargaban los 30 de antes, sin un solo error— y encima caro, porque cada
   * dia de mas son miles de peticiones al SIMAJ.
   */
  const cargarSimaj = useCallback(async (rango?: Periodo) => {
    setCargando(true);
    setError(null);
    setExito(null);

    // El sondeo del avance vive aquí y no en el menú porque acompaña a la
    // descarga: quien la lance, desde donde la lance, ve lo mismo. Un mes son
    // decenas de miles de peticiones y sin esto no hay forma de saber si sigue
    // viva.
    const sondeo = window.setInterval(async () => {
      try {
        const p = await minutalesApi.progreso();
        setProgresoSimaj(p.activo ? p : null);
      } catch {
        // Un sondeo fallido no aborta la descarga; se reintenta solo.
      }
    }, 1000);

    try {
      const r = await minutalesApi.descargar(rangoConsultable(rango ?? periodo), contaminantesMir, configBackend());
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
      window.clearInterval(sondeo);
      setProgresoSimaj(null);
      setCargando(false);
    }
  }, [configBackend, contaminantesMir, periodo]);

  const entrarEmisiones = useCallback(async (
    email: string, password: string, recordar = false,
  ) => {
    // El error se propaga en vez de guardarse en `error`: el formulario de
    // acceso lo pinta junto al campo, y un mensaje de credenciales en el panel
    // general de errores queda lejos de donde se escribio la contrasena.
    const s = await emisionesApi.login(email, password, recordar);
    setSesionEmisiones(s);
  }, []);

  const salirEmisiones = useCallback(async () => {
    const s = await emisionesApi.salir();
    setSesionEmisiones(s);
  }, []);

  /** Lo mismo que en `cargarSimaj`: el rango elegido manda sobre el estado. */
  const cargarEmisiones = useCallback(async (rango?: Periodo) => {
    setCargando(true);
    setError(null);
    setExito(null);
    try {
      // El backend de Emisiones espera la hora explícita; el selector da solo
      // el día, y el día empieza a las 00:00.
      const consultable = rangoConsultable(rango ?? periodo);
      const r = await emisionesApi.descargar(
        { desde: `${consultable.desde} 00:00`, hasta: `${consultable.hasta} 00:00` },
        configBackend(),
      );
      setResultado(r);
      // El MIR sale tambien de aqui: lo que hace falta para calcularlo es el
      // periodo pedido —las horas que deberia haber—, y eso lo sabemos igual
      // que con el SIMAJ. Lo que no da para MIR es un archivo suelto, que no
      // dice que tramo pretende cubrir.
      setMir(r.mir ?? null);
      setFallas(r.fallas ?? []);
      setOrigen('emisiones');
      setDescripcion(`Emisiones Jalisco - ${r.summary.fecha_inicio} a ${r.summary.fecha_fin}`);
      setExito(
        `Consultados ${r.summary.total_registros.toLocaleString()} registros ` +
        `de ${r.summary.estaciones} estaciones.`,
      );
    } catch (e) {
      const respuesta = (e as { response?: { status?: number; data?: { error?: string } } }).response;
      // Un 401 aqui significa que el token murio a mitad de sesion. El backend
      // ya lo descarto; hay que reflejarlo para que vuelva a salir el acceso.
      if (respuesta?.status === 401) setSesionEmisiones({ activa: false, email: null, caduca: null, recordada: false });
      setError(respuesta?.data?.error ?? 'No se pudo consultar la API de Emisiones.');
    } finally {
      setCargando(false);
    }
  }, [configBackend, periodo]);

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
    cargando, error, exito, revalidar, config, sesionEmisiones, periodo,
    progresoSimaj,
    setConfig, setRevalidar, setError, setPeriodo,
    cargarArchivo, cargarSimaj, cargarEmisiones,
    entrarEmisiones, salirEmisiones, cambiarContaminantesMir, limpiar,
  }), [
    resultado, mir, fallas, contaminantesMir, origen, descripcion,
    cargando, error, exito, revalidar, config, sesionEmisiones, periodo,
    progresoSimaj,
    cargarArchivo, cargarSimaj, cargarEmisiones,
    entrarEmisiones, salirEmisiones, cambiarContaminantesMir, limpiar,
  ]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
