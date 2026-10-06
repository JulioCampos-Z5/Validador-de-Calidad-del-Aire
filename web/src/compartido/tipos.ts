// Formas que devuelve la API central (api/). Mantener alineado con los
// model.go de cada modulo.

export type Rol = 'root' | 'admin' | 'tecnico' | 'user'

export interface Usuario {
  id: number
  nombre: string
  correo: string
  rol: Rol
  estatus: string
}

export interface Sesion {
  token: string
  expira: string
  usuario: Usuario
}

export type Tema = 'claro' | 'oscuro'

export interface ModuloApi {
  nombre: string
  estado: 'activo' | 'en_proceso'
  ruta: string
}

// --- puertos ---

export type Nivel = 'reciente' | 'aviso' | 'critico' | 'incumple'

export interface EstadoPuerto {
  clave: string
  nombre?: string
  estado: 'arriba' | 'caido'
  desde?: string
  nivel?: Nivel
}

export interface EstadoEstacion {
  id: number
  nombre: string
  ultimoLatido: string | null
  sinComunicacion: boolean
  nivel?: Nivel
  puertos: EstadoPuerto[]
}

export interface EventoPuerto {
  id: number
  estacion: string
  tipo: 'puerto_caido' | 'puerto_arriba' | 'sin_comunicacion' | 'comunicacion_restablecida'
  clave?: string
  nombre?: string
  momento: string
  recibido: string
}

// --- analisis (backend de Python, via /api/analisis) ---

// Una fila del formato BD: estacion, fecha, hora y un valor por parametro.
// Un dato invalidado trae su bandera (texto: 'IR', 'ND'...) en lugar del valor.
export interface Registro {
  STATION: string
  DATE: string
  HOUR: number
  [parametro: string]: string | number | null
}

export interface EstadisticaDetallada {
  'Estación': string
  Contaminante: string
  'Total de registros': number
  'Valores válidos': number
  'Mínimo': number
  'Máximo': number
  Promedio: number
  'Desviación estándar': number
}

export interface RespuestaValidacion {
  output_filename: string
  file_format?: string
  summary: {
    total_registros: number
    estaciones: number
    fecha_inicio: string
    fecha_fin: string
    banderas: Record<string, Record<string, number | string>>
  }
  data_preview: Registro[]
  estadisticas_detalladas: EstadisticaDetallada[]
}

// El conjunto validado que se esta mirando, compartido entre modulos.
export interface Conjunto {
  origen: string        // "Archivo Trs.xlsx", "SIMAJ 2026-09-01 a 2026-09-30"
  cargado: string       // ISO
  respuesta: RespuestaValidacion
  // Estado completo de los modulos de analisis (MIR, fallas, contaminantes
  // elegidos, aviso de descarga incompleta...). Lo interpreta src/legado.
  compartido?: unknown
}
