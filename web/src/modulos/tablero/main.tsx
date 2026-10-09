// El Tablero se monta como las páginas del validador (montarLegado) para poder
// incluir el panel de carga de datos, el mismo de Validación.
import { montarLegado } from '../../legado/montar'
import { Tablero } from './Tablero'

montarLegado(({ props }) => <Tablero {...props} />)
