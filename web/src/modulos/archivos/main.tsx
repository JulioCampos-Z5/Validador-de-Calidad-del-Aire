// Archivos: los Excel/CSV importados en la app de escritorio, con vista previa
// y para volver a abrirlos en el validador.
import { montarLegado } from '../../legado/montar'
import AvisoDescarga from '../../legado/components/AvisoDescarga'
import Archivos from '../../legado/pages/Archivos'

montarLegado(({ ir }) => (
  <div className="p-5 space-y-4">
    <AvisoDescarga />
    <Archivos ir={ir} />
  </div>
))
