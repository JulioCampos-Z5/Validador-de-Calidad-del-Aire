import { useEffect, useState } from 'react';
import { MonitorDown, ChevronDown } from 'lucide-react';
import apiService, { type ArchivoApp } from '../services/api';

/**
 * Descarga de la app de escritorio, en el menú lateral.
 *
 * Solo aparece en el navegador. Dentro de la propia app de escritorio se
 * oculta: ofrecerle a alguien descargar el programa que ya está usando es
 * ruido, y el ejecutable ni siquiera está en el equipo que sirve la página
 * cuando el backend corre empaquetado.
 *
 * También se oculta si el servidor no tiene los .exe compilados, en vez de
 * mostrar un botón que devolvería un 404. Que la opción exista es la señal de
 * que hay algo que descargar.
 */

/** Electron marca su propio user agent; es la forma estándar de detectarlo. */
function enEscritorio(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');
}

export default function DescargarApp() {
  const [archivos, setArchivos] = useState<ArchivoApp[]>([]);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (enEscritorio()) return;
    apiService.appEscritorio()
      .then((r) => setArchivos(r.archivos))
      .catch(() => {
        // Sin ejecutables compilados o backend antiguo: no se muestra nada.
      });
  }, []);

  if (archivos.length === 0) return null;

  return (
    <div className="border-t border-slate-200">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="w-full flex items-center justify-between px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hover:bg-slate-50"
      >
        App de escritorio
        <ChevronDown size={15} className={`transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>

      {abierto && (
        <div className="px-3 pb-4 space-y-1">
          {archivos.map((a) => (
            <a
              key={a.nombre}
              href={a.url}
              title={a.detalle}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <MonitorDown size={17} className="shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight">{a.etiqueta}</span>
                <span className="block text-[11px] text-slate-400 tabular-nums">
                  {a.tamano_mb} MB
                </span>
              </span>
            </a>
          ))}
          {/* Windows avisa la primera vez porque los ejecutables no están
              firmados. Decirlo antes evita que parezca un problema del
              archivo descargado. */}
          <p className="px-2.5 pt-2 text-[11px] text-slate-400 leading-snug">
            Windows 11, 64 bits. Requiere Python 3.10+. Al abrirlo, SmartScreen
            avisa la primera vez: «Más información» → «Ejecutar de todas formas».
          </p>
        </div>
      )}
    </div>
  );
}
