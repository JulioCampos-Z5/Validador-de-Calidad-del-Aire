// Graficas: las siete vistas del frontend actual (series, comportamiento
// horario, distribucion, calendario, categorias NOM-172, dia x hora, viento)
// sobre el conjunto cargado en Validacion.
import { montarLegado } from '../../legado/montar'
import AvisoDescarga from '../../legado/components/AvisoDescarga'
import Charts from '../../legado/pages/Charts'

montarLegado(() => (
  <div className="p-5 space-y-4">
    <AvisoDescarga />
    <Charts />
  </div>
))
