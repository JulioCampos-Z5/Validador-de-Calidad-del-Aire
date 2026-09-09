import { useEffect, useState } from 'react';
import { MonitorDown } from 'lucide-react';
import apiService, { type ArchivoApp } from '../services/api';
import { clasesIcono, useMenu } from './menu';

/**
 * Descarga de la app de escritorio, en el menú lateral.
 *
 * Un solo botón: el instalador. Antes había una sección plegable con dos
 * descargas y un párrafo de advertencias, y eso es mucha barra para algo que se
 * pulsa una vez en la vida del equipo. El portable lo sigue sirviendo la API
 * para quien lo necesite; lo que se ofrece aquí es el camino normal.
 *
 * Solo aparece en el navegador. Dentro de la propia app de escritorio se
 * oculta: ofrecerle a alguien descargar el programa que ya está usando es
 * ruido, y el ejecutable ni siquiera está en el equipo que sirve la página
 * cuando el backend corre empaquetado.
 *
 * También se oculta si el servidor no tiene nada compilado, en vez de mostrar un
 * botón que devolvería un 404. Que el botón exista es la señal de que hay algo
 * que descargar.
 */

/** Electron marca su propio user agent; es la forma estándar de detectarlo. */
function enEscritorio(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');
}

export default function DescargarApp() {
  const { plegado } = useMenu();
  const [archivo, setArchivo] = useState<ArchivoApp | null>(null);

  useEffect(() => {
    if (enEscritorio()) return;
    apiService.appEscritorio()
      .then((r) => {
        // El instalador es el camino normal. Si por lo que sea solo se compiló
        // el portable, se ofrece ese antes que no ofrecer nada.
        const instalador = r.archivos.find((a) => a.nombre.includes('instalador'));
        setArchivo(instalador ?? r.archivos[0] ?? null);
      })
      .catch(() => {
        // Sin ejecutables compilados o backend antiguo: no se muestra nada.
      });
  }, []);

  if (!archivo) return null;

  // Las advertencias van al tooltip y no debajo del botón: sirven cuando se
  // duda antes de pulsar, no ocupando media barra el resto del tiempo.
  const detalle =
    `${archivo.detalle} ${archivo.tamano_mb} MB, Windows 64 bits. ` +
    'No necesita instalar nada más: el motor de validación viaja dentro. ' +
    'Al abrirlo, SmartScreen avisa la primera vez: «Más información» → ' +
    '«Ejecutar de todas formas».';

  if (plegado) {
    return (
      <div className="border-t border-slate-200 pt-2 flex flex-col items-center">
        <a
          href={archivo.url}
          title={detalle}
          aria-label="Descargar la app de escritorio"
          className={clasesIcono()}
        >
          <MonitorDown size={20} />
        </a>
      </div>
    );
  }

  return (
    <div className="border-t border-slate-200 pt-3 px-3 pb-4">
      <a
        href={archivo.url}
        title={detalle}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-slate-600 hover:bg-slate-100 transition-colors"
      >
        <MonitorDown size={17} className="shrink-0" />
        <span className="min-w-0">
          <span className="block text-sm font-medium leading-tight">
            Descargar la app
          </span>
          <span className="block text-[11px] text-slate-400 tabular-nums">
            {archivo.tamano_mb} MB · Windows
          </span>
        </span>
      </a>
    </div>
  );
}
