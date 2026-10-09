/**
 * App de escritorio del Validador de Calidad del Aire, v2.
 *
 * No hay servidor: todo corre en esta computadora. Se arrancan dos procesos
 * hijos y se abre una ventana sobre la API:
 *
 *   validador-api.exe      API de Go. Usuarios y Ambient Weather en SQLite
 *                          (carpeta de datos del usuario) y el front v2.
 *   validador-backend.exe  Motor de análisis en Python (el mismo de la v1),
 *                          al que la API reenvía /api/analisis/*.
 *
 * La v1 de escritorio (escritorio/) sigue aparte, con su propio instalador.
 * Configuración y rutas en config.mjs.
 */

import { app, BrowserWindow, dialog, Menu, MenuItem, shell } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { esWeb } from './seguridad.mjs';
import { crearBitacora } from './bitacora.mjs';
import { BASE, PUERTO_MOTOR, asegurarConfig, entornoApi, entornoMotor, leerConfig } from './config.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
// En la app instalada apunta a resources/ (donde van los extraResources); en
// desarrollo, a la carpeta del proyecto.
const raiz = join(aqui, '..');
const empaquetada = app.isPackaged;

// Todo lo del usuario (bases, configuración, bitácora) en su perfil: instalada
// en Archivos de programa, la carpeta de la app no se puede escribir.
const carpetaDatos = join(app.getPath('userData'), 'datos');
const bitacora = crearBitacora(carpetaDatos);
const verBitacora = `Bitácora:\n${bitacora.ruta}`;

process.on('uncaughtException', (e) => {
  bitacora.error('Excepción no controlada:', e);
  dialog.showErrorBox('Error inesperado', `${e.message}\n\n${verBitacora}`);
});
process.on('unhandledRejection', (e) => bitacora.error('Promesa rechazada sin atender:', e));

const hijos = { api: null, motor: null };
const ultimoError = { api: null, motor: null };
const terminados = { api: false, motor: false };

// Una sola instancia: la segunda no puede abrir los puertos 18081/18010 (ya
// son de la primera) y antes abría su ventana sobre la API de la otra. Ahora
// solo trae al frente la ventana que ya está abierta.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const v = BrowserWindow.getAllWindows()[0];
    if (!v) return;
    if (v.isMinimized()) v.restore();
    v.show();
    v.focus();
  });
}

/** Dónde está cada pieza: empaquetada en resources/, o el código en desarrollo. */
function piezas() {
  if (empaquetada) {
    return {
      api: { exe: join(raiz, 'api', 'validador-api.exe') },
      motor: { exe: join(raiz, 'backend-exe', 'validador-backend.exe') },
      web: join(raiz, 'web'),
      llaves: join(raiz, 'llaves.env'),
    };
  }
  const apiCompilada = join(aqui, 'build', 'validador-api.exe');
  return {
    // En desarrollo, la API compilada por `pnpm api`, o `go run` si no está.
    api: existsSync(apiCompilada)
      ? { exe: apiCompilada }
      : { comando: 'go', args: ['-C', join(raiz, 'api'), 'run', './cmd/api'] },
    motor: { python: buscarPython(), cwd: join(raiz, 'backend') },
    web: join(raiz, 'web', 'dist'),
    llaves: join(aqui, 'build', 'llaves.env'),
  };
}

/** Python para el motor en desarrollo (en la app instalada va empaquetado). */
function buscarPython() {
  for (const candidato of ['python', 'py', 'python3']) {
    try {
      if (spawnSync(candidato, ['--version'], { timeout: 8000 }).status === 0) return candidato;
    } catch {
      // Se prueba el siguiente.
    }
  }
  return null;
}

function lanzar(nombre, comando, args, opciones) {
  const hijo = spawn(comando, args, { ...opciones, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  bitacora.info(`Arrancando ${nombre}: ${comando} ${args.join(' ')}`);
  const salida = bitacora.flujo(nombre.toUpperCase());
  hijo.stdout.on('data', (d) => { process.stdout.write(`[${nombre}] ${d}`); salida(d); });
  hijo.stderr.on('data', (d) => { process.stderr.write(`[${nombre}] ${d}`); salida(d); });
  // Un fallo al lanzar llega como evento, no como excepción: sin escucharlo,
  // el proceso moría en silencio y solo se sabía que «no respondió».
  hijo.on('error', (e) => {
    ultimoError[nombre] = `No se pudo lanzar: ${e.message}`;
    bitacora.error(`${nombre}: ${ultimoError[nombre]}`);
  });
  hijo.on('exit', (codigo, senal) => {
    terminados[nombre] = true;
    if (codigo) ultimoError[nombre] = `Terminó con código ${codigo}.`;
    bitacora[codigo ? 'error' : 'info'](`${nombre} terminó (${codigo ?? senal}).`);
  });
  hijos[nombre] = hijo;
}

/**
 * Espera a que responda `url`. Si el proceso propio ya terminó, no cuenta
 * aunque algo conteste: sería otro programa en el mismo puerto, y abrir la
 * ventana sobre él mostraría datos que no son de esta app.
 */
async function esperar(nombre, url, intentos) {
  for (let i = 0; i < intentos; i++) {
    if (terminados[nombre]) return false;
    try {
      if ((await fetch(url)).ok) {
        // Un instante más, por si el proceso propio murió al no poder abrir el puerto.
        await new Promise((r) => setTimeout(r, 300));
        return !terminados[nombre];
      }
    } catch {
      // Todavía no levanta.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function crearVentana() {
  const ventana = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    title: 'Validador de Calidad del Aire',
    icon: join(aqui, 'icono.png'),
    // Sin destello blanco al abrir en tema oscuro: la ventana se muestra
    // cuando la página ya pintó.
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  ventana.once('ready-to-show', () => ventana.show());

  // Enlaces que abren ventana nueva: al navegador del sistema, y solo http(s).
  // shell.openExternal abre cualquier protocolo registrado en Windows.
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (esWeb(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  ventana.webContents.on('will-navigate', (evento, url) => {
    if (url === BASE || url.startsWith(BASE + '/')) return;
    evento.preventDefault();
    if (esWeb(url)) shell.openExternal(url);
  });

  ventana.loadURL(BASE + '/');
  return ventana;
}

function agregarMenu(archivoConfig) {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  menu.append(new MenuItem({
    label: 'Datos',
    submenu: [
      { label: 'Abrir la carpeta de datos', click: () => shell.openPath(carpetaDatos) },
      { label: 'Configuración (llaves de Ambient Weather)', click: () => shell.openPath(archivoConfig) },
      { type: 'separator' },
      { label: 'Ver la bitácora', click: () => shell.openPath(bitacora.ruta) },
    ],
  }));
  Menu.setApplicationMenu(menu);
}

function fallo(titulo, mensaje) {
  bitacora.error(`${titulo}: ${mensaje.replace(/\s+/g, ' ')}`);
  dialog.showErrorBox(titulo, `${mensaje}\n\n${verBitacora}`);
}

function detener() {
  for (const k of Object.keys(hijos)) {
    if (hijos[k] && !hijos[k].killed) hijos[k].kill();
    hijos[k] = null;
  }
}

app.whenReady().then(async () => {
  // La segunda instancia ya pidió salir (ver requestSingleInstanceLock).
  if (!app.hasSingleInstanceLock()) return;
  bitacora.info(`Inicia la app v2, versión ${app.getVersion()}${empaquetada ? '' : ' (desarrollo)'}`);
  const p = piezas();
  // Las llaves de Ambient Weather viajan con el instalador: se copian a
  // config.env si ahí están vacías (ver preparar-llaves.mjs).
  const archivoConfig = asegurarConfig(carpetaDatos, p.llaves);
  agregarMenu(archivoConfig);

  if (!existsSync(join(p.web, 'index.html'))) {
    fallo('Falta el front', `No se encontró ${p.web}.\n\nEn desarrollo: pnpm --dir web build`);
    app.quit();
    return;
  }

  // API de Go.
  const envApi = entornoApi({ base: process.env, carpetaDatos, carpetaWeb: p.web, archivoConfig });
  if (p.api.exe) lanzar('api', p.api.exe, [], { cwd: carpetaDatos, env: envApi });
  else lanzar('api', p.api.comando, p.api.args, { cwd: carpetaDatos, env: envApi });

  // Motor de análisis en Python.
  const envMotor = entornoMotor({ base: process.env, carpetaDatos, archivoConfig });
  if (p.motor.exe) lanzar('motor', p.motor.exe, [], { cwd: dirname(p.motor.exe), env: envMotor });
  else if (p.motor.python) lanzar('motor', p.motor.python, ['app.py'], { cwd: p.motor.cwd, env: envMotor });
  else ultimoError.motor = 'No hay motor empaquetado ni Python para arrancarlo.';

  // La API compila en desarrollo (go run) y el motor importa pandas: se espera
  // a los dos en paralelo antes de abrir, para no mostrar un error que se
  // arregla solo segundos después.
  const [apiLista, motorListo] = await Promise.all([
    esperar('api', `${BASE}/api/salud`, empaquetada ? 40 : 240),
    hijos.motor ? esperar('motor', `http://127.0.0.1:${PUERTO_MOTOR}/api/health`, 80) : false,
  ]);

  if (!apiLista) {
    fallo('La API no respondió',
      'El servidor local no arrancó.\n\n' + (ultimoError.api ? ultimoError.api + '\n\n' : '')
      + 'Puede que un antivirus haya bloqueado validador-api.exe o que el puerto 18081 esté ocupado.');
    detener();
    app.quit();
    return;
  }
  if (!motorListo) {
    // Sin motor se puede entrar (usuarios, Ambient Weather), pero no validar.
    fallo('El motor de análisis no respondió',
      'Validación, Gráficas y Registros no van a funcionar en esta sesión.\n\n'
      + (ultimoError.motor ? ultimoError.motor + '\n\n' : '')
      + 'Puede que un antivirus lo haya bloqueado o que el puerto 18010 esté ocupado.');
  }

  const config = leerConfig(archivoConfig);
  if (!config.AMBIENT_WEATHER_API_KEY || !config.AMBIENT_WEATHER_APPLICATION_KEY) {
    bitacora.info('Ambient Weather sin llaves: se ve lo guardado. Menú Datos → Configuración.');
  }

  bitacora.info('Todo listo, abriendo la ventana.');
  crearVentana();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) crearVentana(); });
});

// Los procesos hijos quedarían vivos ocupando los puertos y el siguiente
// arranque fallaría sin explicar por qué.
app.on('window-all-closed', () => {
  detener();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  bitacora.info('Se cierra la app.');
  detener();
});
process.on('exit', detener);
