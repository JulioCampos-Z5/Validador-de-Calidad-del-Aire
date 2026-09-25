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

import { app, BrowserWindow, dialog, Menu, MenuItem, shell } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { esWeb } from './seguridad.mjs';
import { crearBitacora } from './bitacora.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..');
const PUERTO = 8000;
const BASE = `http://127.0.0.1:${PUERTO}`;

let backend = null;

// registro.log va en el perfil del usuario, no junto al ejecutable: instalada
// en Archivos de programa esa carpeta no se puede escribir.
const bitacora = crearBitacora(join(app.getPath('userData'), 'datos'));
const verBitacora = `Bitácora:\n${bitacora.ruta}`;

process.on('uncaughtException', (e) => {
  bitacora.error('Excepción no controlada:', e);
  dialog.showErrorBox('Error inesperado', `${e.message}\n\n${verBitacora}`);
});
process.on('unhandledRejection', (e) => bitacora.error('Promesa rechazada sin atender:', e));

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
    // Por tubería Python escribe en cp1252 y los acentos llegaban rotos a
    // registro.log, que se lee como UTF-8.
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
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
  bitacora.info(`Arrancando backend: ${exe ?? `${python} app.py`}`);
  const salida = bitacora.flujo('BACKEND');
  const errores = bitacora.flujo('BACKEND');
  backend.stdout.on('data', (d) => { process.stdout.write(`[backend] ${d}`); salida(d); });
  backend.stderr.on('data', (d) => { process.stderr.write(`[backend] ${d}`); errores(d); });
  // Un fallo al lanzar el backend llega como EVENTO, no como excepcion. Sin
  // escucharlo, el proceso moria en silencio y la app se limitaba a decir "no
  // respondio" veinte segundos despues, sin una sola pista de por que.
  backend.on('error', (e) => {
    ultimoError = `No se pudo lanzar el backend: ${e.message}`;
    bitacora.error(ultimoError);
    process.stderr.write(`[backend] ${ultimoError}` + String.fromCharCode(10));
  });
  backend.on('exit', (codigo, senal) => {
    if (codigo) ultimoError = `El backend terminó con código ${codigo}.`;
    // Sin código es que lo detuvo la propia app al cerrar (detenerBackend).
    bitacora[codigo ? 'error' : 'info'](
      codigo === null ? `Backend detenido (${senal}).` : `El backend terminó (código ${codigo}).`,
    );
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
    // El instalador ya pone el icono en el acceso directo; esto es para la
    // ventana y la barra de tareas, que si no salen con el de Electron.
    icon: join(aqui, 'icono.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // Un enlace que abre ventana nueva va al navegador del sistema, pero solo si
  // es http(s). shell.openExternal abre cualquier protocolo —file:, ms-msdt:,
  // lo que haya registrado en Windows—, y pasárselo sin mirar convertía un
  // fallo de inyección en la página en ejecutar programas en el equipo.
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (esWeb(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // La ventana principal solo muestra la app. Si algo intenta llevarla a otro
  // sitio, se abre fuera y la app se queda donde estaba.
  ventana.webContents.on('will-navigate', (evento, url) => {
    if (url.startsWith(BASE + '/') || url === BASE) return;
    evento.preventDefault();
    if (esWeb(url)) shell.openExternal(url);
  });

  ventana.loadURL(BASE);
  return ventana;
}

/**
 * Agrega "Ver la bitácora" al menú que Electron pone por omisión, sin
 * reemplazarlo: así se conservan Recargar, Zoom, etc.
 */
function agregarMenuBitacora() {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  menu.append(new MenuItem({
    label: 'Bitácora',
    submenu: [
      { label: 'Ver la bitácora', click: () => shell.openPath(bitacora.ruta) },
      { label: 'Abrir la carpeta de datos', click: () => shell.openPath(dirname(bitacora.ruta)) },
    ],
  }));
  Menu.setApplicationMenu(menu);
}

/** Muestra el error y lo deja escrito en la bitácora. */
function fallo(titulo, mensaje) {
  bitacora.error(`${titulo}: ${mensaje.replace(/\s+/g, ' ')}`);
  dialog.showErrorBox(titulo, `${mensaje}\n\n${verBitacora}`);
}

app.whenReady().then(async () => {
  bitacora.info(`Inicia la app, versión ${app.getVersion()}`);
  agregarMenuBitacora();

  if (!existsSync(join(raiz, 'frontend', 'dist', 'index.html'))) {
    fallo(
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
    fallo(
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
    fallo(
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

  bitacora.info('Backend listo, abriendo la ventana.');
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

app.on('before-quit', () => {
  bitacora.info('Se cierra la app.');
  detenerBackend();
});
process.on('exit', detenerBackend);
