// Ambient Weather como fuente de las graficas: las lecturas de la API de Go
// (/api/ambient-weather) pasadas al formato de filas de la red (STATION, DATE,
// HOUR y parametros con los nombres y unidades del SIMAJ), para que las vistas
// de Graficas las dibujen sin saber de donde vienen.

import type { Cliente } from '../../compartido/api';
import {
  horaLocal, nombreCorto, type Dispositivo, type Lectura,
} from '../../compartido/ambientweather';

export interface FilaRed {
  STATION: string;
  DATE: string;
  HOUR: number;
  [parametro: string]: string | number | null;
}

/**
 * Campo de Ambient Weather -> parametro de la red, con la conversion de sus
 * unidades imperiales a las de la red (ver legado/constants.ts). El `uv` de
 * Ambient Weather no entra: es índice UV y el UVI de la red es radiación en
 * mW/m²; ponerlos en la misma columna los haría parecer comparables.
 */
export const EQUIVALENCIAS: { aw: string; red: string; convertir: (v: number) => number }[] = [
  { aw: 'tempf', red: 'ET', convertir: v => (v - 32) * 5 / 9 },           // °F -> °C
  { aw: 'tempinf', red: 'IT', convertir: v => (v - 32) * 5 / 9 },
  { aw: 'humidity', red: 'RH', convertir: v => v },                       // %
  { aw: 'windspeedmph', red: 'WS', convertir: v => v * 0.44704 },         // mph -> m/s
  { aw: 'winddir', red: 'WD', convertir: v => v },                        // °
  { aw: 'hourlyrainin', red: 'PP', convertir: v => v * 25.4 },            // in/h -> mm en la hora
  { aw: 'baromrelin', red: 'ATM', convertir: v => v * 25.4 },             // inHg -> mmHg
  { aw: 'solarradiation', red: 'RS', convertir: v => v },                 // W/m²
  { aw: 'pm25', red: 'PM2.5', convertir: v => v },                        // µg/m³
];

const redondear = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Lecturas (crudas o en cubetas de hasta 1 h) -> una fila por hora de
 * Guadalajara. Promedio en todo, salvo la direccion del viento, que se
 * promedia como vector (350° y 10° dan 0°, no 180°).
 */
export function aFilasHorarias(estacion: string, lecturas: Lectura[]): FilaRed[] {
  const horas = new Map<string, Lectura[]>();
  for (const l of lecturas) {
    const clave = horaLocal(l.fecha).slice(0, 13); // 'AAAA-MM-DD HH'
    const g = horas.get(clave);
    if (g) g.push(l); else horas.set(clave, [l]);
  }
  const filas: FilaRed[] = [];
  for (const [clave, ls] of horas) {
    const fila: FilaRed = { STATION: estacion, DATE: clave.slice(0, 10), HOUR: Number(clave.slice(11, 13)) };
    for (const { aw, red, convertir } of EQUIVALENCIAS) {
      const vs = ls.map(l => l.valores[aw]).filter((v): v is number => v !== undefined && v !== null);
      if (!vs.length) continue;
      let v: number;
      if (aw === 'winddir') {
        const s = vs.reduce((a, x) => a + Math.sin(x * Math.PI / 180), 0);
        const c = vs.reduce((a, x) => a + Math.cos(x * Math.PI / 180), 0);
        v = ((Math.atan2(s, c) * 180 / Math.PI) + 360) % 360;
      } else {
        v = vs.reduce((a, x) => a + x, 0) / vs.length;
      }
      fila[red] = redondear(convertir(v));
    }
    filas.push(fila);
  }
  return filas.sort((a, b) => a.DATE.localeCompare(b.DATE) || a.HOUR - b.HOUR);
}

/** Fecha 'AAAA-MM-DD' de Guadalajara (UTC-6, sin horario de verano) a ISO UTC. */
const inicioDelDia = (fecha: string) => new Date(`${fecha}T00:00:00-06:00`).toISOString();

/**
 * Todas las estaciones con lecturas, del dia `desde` al dia `hasta` (ambos
 * incluidos), en filas horarias. Se pide una cubeta de 1 h como mucho: tantos
 * puntos como horas tiene el tramo.
 */
export async function cargarAmbientWeather(api: Cliente, desde: string, hasta: string): Promise<FilaRed[]> {
  const fin = new Date(`${hasta}T00:00:00-06:00`);
  fin.setUTCDate(fin.getUTCDate() + 1);
  const desdeIso = inicioDelDia(desde);
  const hastaIso = fin.toISOString();
  const puntos = Math.ceil((fin.getTime() - new Date(desdeIso).getTime()) / 3_600_000);

  const { dispositivos } = await api.get<{ dispositivos: Dispositivo[] }>('/api/ambient-weather/dispositivos');
  const conLecturas = dispositivos.filter(d => d.lecturas > 0);
  const series = await Promise.all(conLecturas.map(d =>
    api.get<{ lecturas: Lectura[] }>(
      `/api/ambient-weather/serie?mac=${encodeURIComponent(d.mac)}&desde=${desdeIso}&hasta=${hastaIso}&puntos=${puntos}`)
      .then(r => aFilasHorarias(nombreCorto(d), r.lecturas))));
  return series.flat();
}
