// Validacion: ajustar las validaciones y revisar el resultado. Los datos se
// traen desde el Tablero (tarjeta «Carga de datos»), que comparte el conjunto
// cargado con este modulo a traves del shell.
import { montarLegado } from '../../legado/montar'
import DescargarApp from '../../legado/components/DescargarApp'
import AvisoDescarga from '../../legado/components/AvisoDescarga'
import Dashboard from '../../legado/pages/Dashboard'

montarLegado(() => (
  <div className="p-5 space-y-4">
    <AvisoDescarga />
    <Dashboard />
    <DescargarApp />
  </div>
))
