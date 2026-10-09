// Catalogo de modulos del front. Un modulo esta disponible si su pagina ya
// existe aqui y su modulo de la API esta activo (GET /api/modulos); si no,
// sale atenuado como "en proceso".

import {
  IconAdjustmentsHorizontal, IconBroadcast, IconChartLine, IconChecklist, IconCloudRain, IconFiles, IconLayoutDashboard,
  IconListDetails, IconPackage, IconSettings, type Icon,
} from '@tabler/icons-react'
import type { Rol } from './tipos'

export interface ModuloFront {
  id: string
  nombre: string
  icono: Icon
  api: string | null      // modulo de la API del que depende
  pagina: string | null   // null = el front de este modulo aun no se construye
  roles?: Rol[]           // sin roles = lo ven todos
  soloEscritorio?: boolean // solo en la app de escritorio (ver compartido/escritorio.ts)
}

export const MODULOS: ModuloFront[] = [
  { id: 'tablero', nombre: 'Tablero', icono: IconLayoutDashboard, api: null, pagina: '/m/tablero/' },
  { id: 'validacion', nombre: 'Validación', icono: IconChecklist, api: 'validacion', pagina: '/m/validacion/' },
  { id: 'graficas', nombre: 'Gráficas', icono: IconChartLine, api: 'validacion', pagina: '/m/graficas/' },
  { id: 'registros', nombre: 'Registros (MIR, fallas y MIDE)', icono: IconListDetails, api: 'validacion', pagina: '/m/registros/' },
  { id: 'archivos', nombre: 'Archivos', icono: IconFiles, api: 'validacion', pagina: '/m/archivos/', soloEscritorio: true },
  { id: 'parametros', nombre: 'Parámetros', icono: IconAdjustmentsHorizontal, api: 'validacion', pagina: '/m/parametros/' },
  { id: 'estaciones', nombre: 'Estaciones', icono: IconBroadcast, api: 'puertos', pagina: '/m/estaciones/' },
  { id: 'ambientweather', nombre: 'Ambient Weather', icono: IconCloudRain, api: 'ambientweather', pagina: '/m/ambientweather/' },
  { id: 'inventario', nombre: 'Inventario', icono: IconPackage, api: 'inventario', pagina: '/m/inventario/' },
  { id: 'admin', nombre: 'Admin', icono: IconSettings, api: 'usuarios', pagina: '/m/admin/', roles: ['root', 'admin'] },
]

// Los que puede ver un rol (Admin, solo root y admin); los de escritorio, solo ahí.
export const visiblesPara = (rol: Rol, escritorio = false) =>
  MODULOS.filter((m) => (!m.roles || m.roles.includes(rol)) && (!m.soloEscritorio || escritorio))

export function disponible(m: ModuloFront, activos: Set<string>) {
  return m.pagina !== null && (m.api === null || activos.has(m.api))
}
