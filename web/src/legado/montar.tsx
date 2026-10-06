// Monta una pagina del frontend actual como modulo de v2: sesion contra la API
// de Go, descargas con sesion, y el estado de datos sincronizado con el shell.

import './estilos.css'
import './pulido.css'
import { useMemo, type ComponentType } from 'react'
import { montarModulo, type PropsModulo } from '../compartido/modulo'
import type { Conjunto, RespuestaValidacion } from '../compartido/tipos'
import { DatosProvider, type EstadoCompartido } from './estado/DatosContexto'
import { MenuContexto } from './components/menu'
import { configurarSesion, instalarDescargas } from './sesion'

instalarDescargas()

// Lo que viene del shell, como estado del contexto de datos.
function aEstado(d: Conjunto | null): EstadoCompartido | null {
  if (!d) return null
  if (d.compartido) return d.compartido as EstadoCompartido
  // Conjunto sin estado completo: solo la respuesta de validacion.
  return {
    resultado: d.respuesta as never, mir: null, fallas: [], contaminantesMir: ['O3', 'NO2', 'CO', 'SO2', 'PM10', 'PM2.5'],
    comoCeroMir: [], origen: null, descripcion: d.origen, advertencia: null,
  }
}

export interface PropsLegado {
  ir: (modulo: string) => void
  props: PropsModulo
}

export function montarLegado(Pagina: ComponentType<PropsLegado>) {
  montarModulo((props) => {
    const { token, avisarVencida, datos, versionDatos, guardarDatos } = props
    configurarSesion(token, avisarVencida)
    // Solo cambia cuando el shell manda datos: lo que guarda este mismo modulo
    // no debe reiniciarle el estado.
    const inicial = useMemo(() => aEstado(datos), [versionDatos])

    const alCambiar = (e: EstadoCompartido) => {
      if (!e.resultado) {
        guardarDatos(null)
        return
      }
      guardarDatos({
        origen: e.descripcion ?? 'Datos cargados',
        cargado: new Date().toISOString(),
        respuesta: e.resultado as unknown as RespuestaValidacion,
        compartido: e,
      })
    }

    return (
      <MenuContexto.Provider value={{ plegado: false, desplegar: () => {} }}>
        <DatosProvider key={versionDatos} inicial={inicial} alCambiar={alCambiar}>
          <Pagina ir={props.ir} props={props} />
        </DatosProvider>
      </MenuContexto.Provider>
    )
  })
}
