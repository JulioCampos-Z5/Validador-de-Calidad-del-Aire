import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearBitacora, LIMITE_BYTES, marcaDeTiempo } from '../bitacora.mjs';

const carpetaNueva = () => mkdtempSync(join(tmpdir(), 'bitacora-'));

test('escribe líneas con fecha y nivel', () => {
  const b = crearBitacora(carpetaNueva());
  b.info('hola');
  b.error(new Error('se rompió'));
  const texto = readFileSync(b.ruta, 'utf8');
  assert.match(texto, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d \[INFO\] hola$/m);
  assert.match(texto, /\[ERROR\] Error: se rompió/);
});

test('crea la carpeta si no existe', () => {
  const b = crearBitacora(join(carpetaNueva(), 'a', 'b'));
  b.info('x');
  assert.ok(existsSync(b.ruta));
});

test('flujo junta pedazos hasta tener la línea completa', () => {
  const b = crearBitacora(carpetaNueva());
  const f = b.flujo('BACKEND');
  f('primera mit');
  f('ad\r\nsegunda\n\n');
  f('sin terminar');
  const lineas = readFileSync(b.ruta, 'utf8').trim().split('\n');
  assert.equal(lineas.length, 2);
  assert.match(lineas[0], /\[BACKEND\] primera mitad$/);
  assert.match(lineas[1], /\[BACKEND\] segunda$/);
});

test('aparta el archivo cuando pasa del límite', () => {
  const carpeta = carpetaNueva();
  writeFileSync(join(carpeta, 'registro.log'), 'x'.repeat(LIMITE_BYTES + 1));
  const b = crearBitacora(carpeta);
  b.info('nuevo');
  assert.ok(existsSync(b.ruta + '.1'));
  assert.match(readFileSync(b.ruta, 'utf8'), /^\S+ \S+ \[INFO\] nuevo\n$/);
});

test('marcaDeTiempo usa hora local', () => {
  assert.equal(marcaDeTiempo(new Date(2026, 0, 5, 7, 8, 9)), '2026-01-05 07:08:09');
});
