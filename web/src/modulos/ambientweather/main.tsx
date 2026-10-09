// Ambient Weather: las estaciones meteorologicas de la cuenta, en vivo, con
// graficas e historico. Los datos los trae la API (modulo ambientweather).
import '../../compartido/fuentes'
import './ambientweather.css'
import { montarModulo } from '../../compartido/modulo'
import { AmbientWeather } from './AmbientWeather'

montarModulo(({ api, usuario }) => <AmbientWeather api={api} usuario={usuario} />)
