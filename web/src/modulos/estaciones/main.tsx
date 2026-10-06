import '../../compartido/fuentes'
import './estaciones.css'
import { montarModulo } from '../../compartido/modulo'
import { Estaciones } from './Estaciones'

montarModulo(({ api }) => <Estaciones api={api} />)
