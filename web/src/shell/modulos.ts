// Catalogo de modulos del front. Un modulo esta disponible si su pagina ya
// existe aqui y su modulo de la API esta activo (GET /api/modulos); si no,
// sale atenuado como "en proceso".

import {
  IconAdjustmentsHorizontal, IconBroadcast, IconChartLine, IconChecklist, IconLayoutDashboard, IconListDetails,
  IconPackage, IconSettings, type Icon,
} from '@tabler/icons-react'
import type { Rol } from '../compartido/tipos'

export interface ModuloFront {
  id: string
  nombre: string
  icono: Icon
  api: string | null      // modulo de la API del que depende
  pagina: string | null   // null = el front de este modulo aun no se construye
  roles?: Rol[]           // sin roles = lo ven todos
}

export const MODULOS: ModuloFront[] = [
  { id: 'tablero', nombre: 'Tablero', icono: IconLayoutDashboard, api: null, pagina: '/m/tablero/' },
  { id: 'validacion', nombre: 'Validación', icono: IconChecklist, api: 'validacion', pagina: '/m/validacion/' },
  { id: 'graficas', nombre: 'Gráficas', icono: IconChartLine, api: 'validacion', pagina: '/m/graficas/' },
  { id: 'registros', nombre: 'Registros (MIR y fallas)', icono: IconListDetails, api: 'validacion', pagina: '/m/registros/' },
  { id: 'parametros', nombre: 'Parámetros', icono: IconAdjustmentsHorizontal, api: 'validacion', pagina: '/m/parametros/' },
  { id: 'estaciones', nombre: 'Estaciones', icono: IconBroadcast, api: 'puertos', pagina: '/m/estaciones/' },
  { id: 'inventario', nombre: 'Inventario', icono: IconPackage, api: 'inventario', pagina: '/m/inventario/' },
  { id: 'admin', nombre: 'Admin', icono: IconSettings, api: 'usuarios', pagina: '/m/admin/', roles: ['root', 'admin'] },
]

export function disponible(m: ModuloFront, activos: Set<string>) {
  return m.pagina !== null && (m.api === null || activos.has(m.api))
}
