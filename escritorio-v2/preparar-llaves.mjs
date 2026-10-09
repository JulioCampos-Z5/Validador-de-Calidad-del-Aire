/**
 * Paso del build: copia las llaves de Ambient Weather de api/.env a
 * build/llaves.env, que el instalador lleva dentro (extraResources). Así la
 * app ya las trae y nadie tiene que capturarlas.
 *
 * Ni api/.env ni build/ se suben a git: las llaves no quedan en el
 * repositorio, solo en el instalador. Quien tenga el instalador puede
 * sacarlas; si se comparte fuera del laboratorio, regenerarlas.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const origen = join(aqui, '..', 'api', '.env');
const destino = join(aqui, 'build', 'llaves.env');
const CLAVES = ['AMBIENT_WEATHER_API_KEY', 'AMBIENT_WEATHER_APPLICATION_KEY'];

const valores = {};
if (existsSync(origen)) {
  for (const linea of readFileSync(origen, 'utf8').split(/\r?\n/)) {
    const i = linea.indexOf('=');
    if (i < 0 || linea.trimStart().startsWith('#')) continue;
    const k = linea.slice(0, i).trim();
    if (CLAVES.includes(k)) valores[k] = linea.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
}

mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, CLAVES.map((k) => `${k}=${valores[k] ?? ''}`).join('\r\n') + '\r\n', 'utf8');

const faltan = CLAVES.filter((k) => !valores[k]);
if (faltan.length) {
  console.warn(`Aviso: sin ${faltan.join(' ni ')} en api/.env; la app se instalará sin llaves de Ambient Weather.`);
} else {
  console.log('Llaves de Ambient Weather listas para el instalador (build/llaves.env).');
}
