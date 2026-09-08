/**
 * App de escritorio del Validador de Calidad del Aire.
 *
 * Arranca el backend Flask como proceso hijo y abre una ventana apuntando a él.
 *
 * El backend viaja empaquetado
 * ----------------------------
 * En la app instalada, el intérprete de Python y las librerías van dentro de
 * `resources/backend-exe`, generados con PyInstaller. Quien recibe el .exe no
 * necesita instalar Python. En desarrollo esa carpeta no existe, así que se cae
 * al `python app.py` de siempre y el ciclo de trabajo no cambia.
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

// Ultimo motivo conocido de que el backend no arranque, para poder decirlo en
// el dialogo en vez de dejar al usuario adivinando.
let ultimoError = null;

/**
 * El backend ya compilado que viaja con la app, si está.
 *
 * `raiz` apunta a la carpeta del proyecto en desarrollo y a `resources/` en la
 * app empaquetada, así que la misma ruta sirve para los dos casos: en
 * desarrollo simplemente no existe.
 */
function backendEmpaquetado() {
  const exe = join(raiz, 'backend-exe', 'validador-backend.exe');
  return existsSync(exe) ? exe : null;
}

/**
 * Busca un intérprete de Python utilizable.
 *
 * Solo hace falta en desarrollo. En la app instalada nunca se llama, porque el
 * backend empaquetado se encuentra antes.
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

function arrancarBackend({ exe, python }) {
  // Sin recarga automatica en ninguno de los dos modos: quien arranca aqui es
  // la aplicacion, no alguien editando codigo. Con el recargador, el proceso
  // que sirve es un hijo del que lanzamos, y al cerrar la ventana se quedaba
  // vivo ocupando el puerto 8000.
  const entorno = {
    ...process.env,
    VALIDADOR_HOST: '127.0.0.1',
    VALIDADOR_DEBUG: '0',
    VALIDADOR_SIN_RECARGA: '1',
  };

  backend = exe
    // El ejecutable empaquetado se lanza desde su propia carpeta y se le oculta
    // la consola: está compilado como aplicación de consola a propósito —así
    // conserva stdout para las trazas—, pero al usuario no tiene por qué
    // aparecerle una ventana negra detrás de la aplicación.
    ? spawn(exe, [], {
        cwd: dirname(exe),
        env: entorno,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    : spawn(python, ['app.py'], {
        cwd: join(raiz, 'backend'),
        env: entorno,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  backend.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  backend.stderr.on('data', (d) => process.stderr.write(`[backend] ${d}`));
  // Un fallo al lanzar el backend llega como EVENTO, no como excepcion. Sin
  // escucharlo, el proceso moria en silencio y la app se limitaba a decir "no
  // respondio" veinte segundos despues, sin una sola pista de por que.
  backend.on('error', (e) => {
    ultimoError = `No se pudo lanzar el backend: ${e.message}`;
    process.stderr.write(`[backend] ${ultimoError}` + String.fromCharCode(10));
  });
  backend.on('exit', (codigo) => {
    if (codigo) ultimoError = `El backend terminó con código ${codigo}.`;
  });
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

  // El backend empaquetado manda: si esta, no se busca Python siquiera.
  const exe = backendEmpaquetado();
  const python = exe ? null : buscarPython();

  if (!exe && !python) {
    // Solo puede pasar en desarrollo: la app instalada trae su propio backend.
    dialog.showErrorBox(
      'No se encontró el backend',
      'No está el backend empaquetado (resources/backend-exe) ni hay un ' +
      'intérprete de Python para arrancarlo desde el código.\n\n' +
      'En desarrollo: instala Python 3.10 o superior.\n' +
      'Si esto ocurre en la app instalada, la instalación está incompleta: ' +
      'vuelve a instalarla.',
    );
    app.quit();
    return;
  }

  arrancarBackend({ exe, python });

  if (!await esperarBackend()) {
    dialog.showErrorBox(
      'El backend no respondió',
      'El servidor de validación no arrancó en 20 segundos.\n\n' +
      (ultimoError ? ultimoError + '\n\n' : '') +
      (backendEmpaquetado()
        ? 'Puede que un antivirus haya bloqueado el backend empaquetado, o que '
          + 'el puerto 8000 esté ocupado por otro programa.'
        : 'Comprueba que las dependencias estén instaladas:\n'
          + '  pip install -r backend/requirements.txt'),
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
