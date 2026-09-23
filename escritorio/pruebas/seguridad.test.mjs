import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esWeb } from '../seguridad.mjs';

test('las páginas web se abren en el navegador', () => {
  assert.equal(esWeb('https://aire.jalisco.gob.mx/contaysalud'), true);
  assert.equal(esWeb('http://127.0.0.1:8000/'), true);
});

test('otros protocolos no llegan a shell.openExternal', () => {
  // Windows abre cada uno de estos con un programa: file: ejecuta, y ms-msdt:
  // fue la puerta de «Follina».
  for (const url of [
    'file:///C:/Windows/System32/calc.exe',
    'ms-msdt:/id PCWDiagnostic',
    'javascript:alert(1)',
    'smb://servidor/recurso',
    'vbscript:msgbox',
  ]) {
    assert.equal(esWeb(url), false, url);
  }
});

test('lo que no es una URL se rechaza', () => {
  for (const url of ['', 'no es una url', '//sin-protocolo.com', null, undefined]) {
    assert.equal(esWeb(url), false, String(url));
  }
});
