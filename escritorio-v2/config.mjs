/**
 * Configuración de la app de escritorio v2, aparte de main.mjs para poder
 * probarla sin arrancar Electron.
 *
 * La app levanta dos procesos locales:
 *   · la API de Go (validador-api.exe): usuarios y Ambient Weather en SQLite,
 *     y además sirve el front (web/dist) en la misma dirección;
 *   · el motor de análisis en Python (validador-backend.exe), al que la API
 *     reenvía /api/analisis/*.
 *
 * Puertos propios (18081 y 18010) para no chocar con la v1 de escritorio
 * (8000) ni con el entorno de desarrollo (8081, 8010, 3100).
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PUERTO_API = 18081;
export const PUERTO_MOTOR = 18010;
export const BASE = `http://127.0.0.1:${PUERTO_API}`;

/**
 * Usuario principal: se crea la primera vez que se abre la app, cuando la
 * base de usuarios está vacía. Va el hash bcrypt (`admin hash-contrasena`),
 * nunca la contraseña. Si después se cambia desde Admin, este ya no se usa.
 */
export const USUARIO_INICIAL = {
  nombre: 'Julio Campos',
  correo: 'julio.campos@jalisco.gob.mx',
  hash: '$2a$10$O2X3knKqOUZtBE85RA3T7ee2kMZI8Dth4cuQs4DDdU.SU/YDeOH7O',
};

const LLAVES_AMBIENT = ['AMBIENT_WEATHER_API_KEY', 'AMBIENT_WEATHER_APPLICATION_KEY'];

/**
 * Acceso automático a la API de Emisiones (backend/emisiones/rutas.py). Solo
 * las escribe el usuario en su config.env: no viajan en el instalador ni las
 * llena preparar-llaves.mjs.
 */
const EMISIONES = ['EMISIONES_CORREO', 'EMISIONES_CONTRASENA'];
const BLOQUE_EMISIONES = [
  '# API de Emisiones: con correo y contraseña, la app entra sola cuando no hay sesión.',
  '# La contraseña queda en este archivo, en tu perfil. Vacías: se entra a mano.',
  'EMISIONES_CORREO=',
  'EMISIONES_CONTRASENA=',
  '',
];

/**
 * config.env en la carpeta de datos del usuario. Se crea la primera vez con
 * una llave de sesión aleatoria y los espacios para las llaves de Ambient
 * Weather, y luego no se toca: lo que el usuario escriba ahí se respeta.
 *
 * `llavesIniciales` es el llaves.env que viaja con el instalador (ver
 * preparar-llaves.mjs): llena las llaves de Ambient Weather que estén
 * vacías, también en un config.env de una instalación anterior. Una llave ya
 * escrita no se pisa.
 */
export function asegurarConfig(carpetaDatos, llavesIniciales = null) {
  mkdirSync(carpetaDatos, { recursive: true });
  const ruta = join(carpetaDatos, 'config.env');
  crearConfig(ruta);
  agregarEspaciosEmisiones(ruta);
  if (llavesIniciales && existsSync(llavesIniciales)) completarLlaves(ruta, leerConfig(llavesIniciales));
  return ruta;
}

function completarLlaves(ruta, nuevas) {
  const lineas = readFileSync(ruta, 'utf8').split(/\r?\n/);
  let cambio = false;
  for (const k of LLAVES_AMBIENT) {
    if (!nuevas[k]) continue;
    const i = lineas.findIndex((l) => l.trim().startsWith(`${k}=`));
    if (i < 0) {
      lineas.push(`${k}=${nuevas[k]}`);
      cambio = true;
    } else if (lineas[i].trim() === `${k}=`) {
      lineas[i] = `${k}=${nuevas[k]}`;
      cambio = true;
    }
  }
  if (cambio) writeFileSync(ruta, lineas.join('\r\n'), 'utf8');
}

// Un config.env de una instalación anterior no tiene los renglones de
// Emisiones: se agregan vacíos para que se vea dónde van.
function agregarEspaciosEmisiones(ruta) {
  const texto = readFileSync(ruta, 'utf8');
  if (EMISIONES.every((k) => new RegExp(`^\\s*${k}=`, 'm').test(texto))) return;
  const fin = texto.endsWith('\n') ? '' : '\r\n';
  writeFileSync(ruta, texto + fin + '\r\n' + BLOQUE_EMISIONES.join('\r\n'), 'utf8');
}

function crearConfig(ruta) {
  if (!existsSync(ruta)) {
    writeFileSync(ruta, [
      '# Configuración de la app de escritorio del Validador (v2).',
      '# Se lee al abrir la app; después de cambiar algo, ciérrala y vuelve a abrirla.',
      '',
      '# Firma de las sesiones. Si cambia, todas las sesiones se cierran.',
      `API_LLAVE_JWT=${randomBytes(32).toString('hex')}`,
      '',
      '# Ambient Weather: sin las dos llaves se ve lo guardado pero no se consultan lecturas nuevas.',
      '# apiKey: ambientweather.net -> Account -> API Keys. applicationKey: support@ambientweather.com.',
      'AMBIENT_WEATHER_API_KEY=',
      'AMBIENT_WEATHER_APPLICATION_KEY=',
      '',
      ...BLOQUE_EMISIONES,
    ].join('\r\n'), { encoding: 'utf8' });
  }
}

/** Lee CLAVE=valor de config.env (lo justo para saber si hay llaves). */
export function leerConfig(ruta) {
  const res = {};
  try {
    for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
      const t = linea.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      res[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch {
    // Sin archivo: sin valores.
  }
  return res;
}

// Variables que la API lee del entorno y que NO deben heredarse del sistema:
// si el equipo tuviera alguna puesta (de un desarrollo, por ejemplo), la API
// la tomaría antes que config.env.
const DE_LA_API = [
  'API_LLAVE_JWT', 'AMBIENT_WEATHER_API_KEY', 'AMBIENT_WEATHER_APPLICATION_KEY', 'AMBIENT_WEATHER_URL',
  'AMBIENT_WEATHER_INTERVALO', 'API_DURACION_SESION',
];

/** Entorno de la API: todo en la carpeta de datos, SQLite y solo localhost. */
export function entornoApi({ base, carpetaDatos, carpetaWeb, archivoConfig }) {
  const entorno = { ...base };
  for (const k of DE_LA_API) delete entorno[k];
  return {
    ...entorno,
    // Solo esta computadora: la API no queda expuesta en la red.
    API_DIRECCION: `127.0.0.1:${PUERTO_API}`,
    API_ARCHIVO_ENV: archivoConfig,
    API_ESTATICOS: carpetaWeb,
    MYSQL_DSN_SEMADET: `sqlite:${join(carpetaDatos, 'usuarios.sqlite')}`,
    MYSQL_DSN_AMBIENT_WEATHER: `sqlite:${join(carpetaDatos, 'ambient_weather.sqlite')}`,
    // Estaciones e Inventario no van en el escritorio: vacías, quedan
    // «en proceso» aunque config.env o el sistema dijeran otra cosa.
    MYSQL_DSN_PUERTOS: '',
    MYSQL_DSN_INVENTARIO: '',
    VALIDADOR_BACKEND_URL: `http://127.0.0.1:${PUERTO_MOTOR}`,
    API_USUARIO_INICIAL_NOMBRE: USUARIO_INICIAL.nombre,
    API_USUARIO_INICIAL_CORREO: USUARIO_INICIAL.correo,
    API_USUARIO_INICIAL_HASH: USUARIO_INICIAL.hash,
  };
}

/**
 * Entorno del motor de Python, igual que en la v1 pero en su propio puerto.
 * Las credenciales de Emisiones salen solo de config.env, no del sistema.
 */
export function entornoMotor({ base, carpetaDatos, archivoConfig = null }) {
  const entorno = { ...base };
  for (const k of EMISIONES) delete entorno[k];
  const config = archivoConfig ? leerConfig(archivoConfig) : {};
  for (const k of EMISIONES) if (config[k]) entorno[k] = config[k];
  return {
    ...entorno,
    VALIDADOR_HOST: '127.0.0.1',
    VALIDADOR_PUERTO: String(PUERTO_MOTOR),
    VALIDADOR_DEBUG: '0',
    VALIDADOR_SIN_RECARGA: '1',
    // La base local (histórico para comparar años) es propia de esta app.
    VALIDADOR_HISTORICO: join(carpetaDatos, 'historico.sqlite'),
    // Por tubería Python escribe en cp1252 y los acentos llegaban rotos a la bitácora.
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  };
}
