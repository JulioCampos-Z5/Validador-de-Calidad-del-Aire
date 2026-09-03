/**
 * App de escritorio del Validador de Calidad del Aire.
 *
 * Arranca el backend Flask como proceso hijo y abre una ventana apuntando a él.
 *
 * Por qué se carga por http y no como file://
 * -------------------------------------------
 * El frontend llama a /api. Abierto como file:// esas rutas no resuelven contra
 * nada y habría que reescribirlas o abrir CORS. Sirviendo el HTML desde el
 * propio Flask, página y API comparten origen y todo funciona sin tocar el
 * código del frontend: la misma compilación sirve para web y para escritorio.
 */

import { app, BrowserWindow, dialog, shell } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..');
const PUERTO = 8000;
const BASE = `http://127.0.0.1:${PUERTO}`;

let backend = null;

/**
 * Busca un intérprete de Python utilizable.
 *
 * En Windows conviven varios lanzadores y no siempre está `python` en el PATH,
 * así que se prueban los habituales en orden y se comprueba que respondan de
 * verdad, no solo que el ejecutable exista.
 */
function buscarPython() {
  for (const candidato of ['python', 'py', 'python3']) {
    try {
      const r = spawnSync(candidato, ['--version'], { encoding: 'utf8', timeout: 8000 });
      if (r.status === 0) return candidato;
    } catch {
      // Se prueba el siguiente.
    }
  }
  return null;
}

function arrancarBackend(python) {
  backend = spawn(python, ['app.py'], {
    cwd: join(raiz, 'backend'),
    env: { ...process.env, VALIDADOR_HOST: '127.0.0.1', VALIDADOR_DEBUG: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  backend.stderr.on('data', (d) => process.stderr.write(`[backend] ${d}`));
}

/**
 * Espera a que el backend responda antes de abrir la ventana.
 *
 * Flask tarda unos segundos en levantar porque importa pandas. Sin esta espera
 * la ventana carga primero y el usuario ve un error de conexión que se arregla
 * solo, que es la peor clase de error: parece roto cuando no lo está.
 */
async function esperarBackend(intentos = 40) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch {
      // Todavía no levanta.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function crearVentana() {
  const ventana = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    backgroundColor: '#f8fafc',
    title: 'Validador de Calidad del Aire',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  ventana.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  ventana.loadURL(BASE);
  return ventana;
}

app.whenReady().then(async () => {
  if (!existsSync(join(raiz, 'frontend', 'dist', 'index.html'))) {
    dialog.showErrorBox(
      'Falta compilar el frontend',
      'No se encontró frontend/dist.\n\nEjecuta:\n  npm --prefix frontend run build',
    );
    app.quit();
    return;
  }

  const python = buscarPython();
  if (!python) {
    dialog.showErrorBox(
      'Python no encontrado',
      'La aplicación necesita Python 3.10 o superior para el backend de validación.\n\n' +
      'Instálalo desde python.org y vuelve a abrir la aplicación.',
    );
    app.quit();
    return;
  }

  arrancarBackend(python);

  if (!await esperarBackend()) {
    dialog.showErrorBox(
      'El backend no respondió',
      'El servidor de validación no arrancó en 20 segundos.\n\n' +
      'Comprueba que las dependencias estén instaladas:\n  pip install -r backend/requirements.txt',
    );
    app.quit();
    return;
  }

  crearVentana();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentana();
  });
});

/**
 * El backend es un proceso hijo: si no se mata explícitamente queda vivo
 * ocupando el puerto 8000 y el siguiente arranque falla sin explicar por qué.
 */
function detenerBackend() {
  if (backend && !backend.killed) {
    backend.kill();
    backend = null;
  }
}

app.on('window-all-closed', () => {
  detenerBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', detenerBackend);
process.on('exit', detenerBackend);
