// Parametros: rangos, estaciones y banderas con los que valida el backend.
import { montarLegado } from '../../legado/montar'
import Config from '../../legado/pages/Config'

montarLegado(() => (
  <div className="p-5">
    <Config />
  </div>
))
