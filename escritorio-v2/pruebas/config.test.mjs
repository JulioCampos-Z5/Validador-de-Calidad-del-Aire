import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PUERTO_API, PUERTO_MOTOR, USUARIO_INICIAL, asegurarConfig, entornoApi, entornoMotor, leerConfig,
} from '../config.mjs';

const carpeta = () => mkdtempSync(join(tmpdir(), 'validador-v2-'));

test('config.env se crea una vez, con llave de sesión aleatoria', () => {
  const dir = carpeta();
  const ruta = asegurarConfig(dir);
  const primera = leerConfig(ruta);
  assert.match(primera.API_LLAVE_JWT, /^[0-9a-f]{64}$/);
  assert.equal(primera.AMBIENT_WEATHER_API_KEY, '');

  // Lo que escriba el usuario se respeta al volver a abrir.
  writeFileSync(ruta, readFileSync(ruta, 'utf8').replace('AMBIENT_WEATHER_API_KEY=', 'AMBIENT_WEATHER_API_KEY=mi-llave'));
  asegurarConfig(dir);
  const despues = leerConfig(ruta);
  assert.equal(despues.API_LLAVE_JWT, primera.API_LLAVE_JWT);
  assert.equal(despues.AMBIENT_WEATHER_API_KEY, 'mi-llave');
});

test('la API usa SQLite en la carpeta de datos y solo escucha en localhost', () => {
  const e = entornoApi({
    base: { PATH: 'x', API_LLAVE_JWT: 'heredada', MYSQL_DSN_PUERTOS: 'mysql://algo' },
    carpetaDatos: 'C:\\datos', carpetaWeb: 'C:\\web', archivoConfig: 'C:\\datos\\config.env',
  });
  assert.equal(e.API_DIRECCION, `127.0.0.1:${PUERTO_API}`);
  assert.match(e.MYSQL_DSN_SEMADET, /^sqlite:.*usuarios\.sqlite$/);
  assert.match(e.MYSQL_DSN_AMBIENT_WEATHER, /^sqlite:.*ambient_weather\.sqlite$/);
  assert.equal(e.MYSQL_DSN_PUERTOS, '', 'Estaciones no va en el escritorio');
  assert.equal(e.MYSQL_DSN_INVENTARIO, '');
  assert.equal(e.API_LLAVE_JWT, undefined, 'la llave sale de config.env, no del sistema');
  assert.equal(e.VALIDADOR_BACKEND_URL, `http://127.0.0.1:${PUERTO_MOTOR}`);
  assert.equal(e.PATH, 'x');
});

test('el usuario inicial va con hash bcrypt, nunca la contraseña', () => {
  const e = entornoApi({ base: {}, carpetaDatos: 'd', carpetaWeb: 'w', archivoConfig: 'c' });
  assert.equal(e.API_USUARIO_INICIAL_CORREO, 'julio.campos@jalisco.gob.mx');
  assert.match(USUARIO_INICIAL.hash, /^\$2[aby]\$\d\d\$/);
  assert.ok(!JSON.stringify(e).includes('12345678'));
});

test('el motor de Python va en su puerto, con UTF-8', () => {
  const e = entornoMotor({ base: {}, carpetaDatos: 'C:\\datos' });
  assert.equal(e.VALIDADOR_PUERTO, String(PUERTO_MOTOR));
  assert.equal(e.VALIDADOR_HOST, '127.0.0.1');
  assert.equal(e.PYTHONUTF8, '1');
  assert.match(e.VALIDADOR_HISTORICO, /historico\.sqlite$/);
});

test('las llaves del instalador llenan las vacías y no pisan las escritas', () => {
  const dir = carpeta();
  const llaves = join(dir, 'llaves.env');
  writeFileSync(llaves, 'AMBIENT_WEATHER_API_KEY=de-instalador\r\nAMBIENT_WEATHER_APPLICATION_KEY=app-instalador\r\n');

  // Instalación nueva: entran las dos.
  const ruta = asegurarConfig(join(dir, 'datos'), llaves);
  let c = leerConfig(ruta);
  assert.equal(c.AMBIENT_WEATHER_API_KEY, 'de-instalador');
  assert.equal(c.AMBIENT_WEATHER_APPLICATION_KEY, 'app-instalador');
  assert.match(c.API_LLAVE_JWT, /^[0-9a-f]{64}$/);

  // Una llave cambiada a mano se respeta en el siguiente arranque.
  writeFileSync(ruta, readFileSync(ruta, 'utf8').replace('=de-instalador', '=mia'));
  asegurarConfig(join(dir, 'datos'), llaves);
  c = leerConfig(ruta);
  assert.equal(c.AMBIENT_WEATHER_API_KEY, 'mia');
  assert.equal(c.AMBIENT_WEATHER_APPLICATION_KEY, 'app-instalador');
});

test('un instalador sin llaves no borra nada', () => {
  const dir = carpeta();
  const vacias = join(dir, 'llaves.env');
  writeFileSync(vacias, 'AMBIENT_WEATHER_API_KEY=\r\nAMBIENT_WEATHER_APPLICATION_KEY=\r\n');
  const ruta = asegurarConfig(join(dir, 'datos'));
  writeFileSync(ruta, readFileSync(ruta, 'utf8').replace('AMBIENT_WEATHER_API_KEY=', 'AMBIENT_WEATHER_API_KEY=mia'));
  asegurarConfig(join(dir, 'datos'), vacias);
  assert.equal(leerConfig(ruta).AMBIENT_WEATHER_API_KEY, 'mia');
});

test('Emisiones: espacios vacíos en config.env, también en uno viejo', () => {
  const dir = carpeta();
  const nuevo = readFileSync(asegurarConfig(join(dir, 'a')), 'utf8');
  assert.match(nuevo, /^EMISIONES_CORREO=$/m);
  assert.match(nuevo, /^EMISIONES_CONTRASENA=$/m);

  const viejo = join(dir, 'b');
  asegurarConfig(viejo);
  const ruta = join(viejo, 'config.env');
  writeFileSync(ruta, 'API_LLAVE_JWT=x\r\nAMBIENT_WEATHER_API_KEY=k\r\n');
  asegurarConfig(viejo);
  asegurarConfig(viejo);
  const texto = readFileSync(ruta, 'utf8');
  assert.equal(texto.match(/^EMISIONES_CORREO=/gm).length, 1);
  assert.match(texto, /^AMBIENT_WEATHER_API_KEY=k$/m);
});

test('Emisiones: el motor las toma solo de config.env', () => {
  const dir = carpeta();
  const ruta = asegurarConfig(dir);
  const sistema = { EMISIONES_CORREO: 'del@sistema', EMISIONES_CONTRASENA: 'otra' };
  assert.equal(entornoMotor({ base: sistema, carpetaDatos: dir, archivoConfig: ruta }).EMISIONES_CORREO, undefined);

  writeFileSync(ruta, readFileSync(ruta, 'utf8')
    .replace('EMISIONES_CORREO=', 'EMISIONES_CORREO=quien@ejemplo.mx')
    .replace('EMISIONES_CONTRASENA=', 'EMISIONES_CONTRASENA=secreta'));
  const e = entornoMotor({ base: sistema, carpetaDatos: dir, archivoConfig: ruta });
  assert.equal(e.EMISIONES_CORREO, 'quien@ejemplo.mx');
  assert.equal(e.EMISIONES_CONTRASENA, 'secreta');
  // La API de Go no las recibe.
  assert.equal(entornoApi({ base: {}, carpetaDatos: dir, carpetaWeb: 'w', archivoConfig: ruta }).EMISIONES_CONTRASENA, undefined);
});
