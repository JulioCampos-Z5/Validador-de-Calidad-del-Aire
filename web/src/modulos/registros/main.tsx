// Registros: el indicador MIR, el reporte de fallas por canal y los errores
// del servidor de analisis. La pagina del frontend actual, tal cual.
import { montarLegado } from '../../legado/montar'
import AvisoDescarga from '../../legado/components/AvisoDescarga'
import Registros from '../../legado/pages/Registros'

montarLegado(() => (
  <div className="p-5 space-y-4">
    <AvisoDescarga />
    <Registros />
  </div>
))
