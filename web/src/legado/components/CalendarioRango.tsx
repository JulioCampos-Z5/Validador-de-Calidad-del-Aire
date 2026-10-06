import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

/**
 * Calendario para elegir un rango: dos meses lado a lado, uno por fecha.
 *
 * Sustituye a dos `<input type="date">`. Aquellos delegaban en el selector del
 * navegador, que cambia de aspecto en cada uno y obliga a abrir dos veces para
 * elegir un rango — sin ver nunca las dos fechas a la vez ni cuántos días hay
 * entre ellas, que es lo único que de verdad se está decidiendo.
 *
 * Aquí se pulsa el inicio, se pulsa el fin y se acepta. Mientras tanto el rango
 * se pinta sobre el propio calendario, y el resumen dice cuántos días son.
 */

const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** `Date` -> `AAAA-MM-DD` sin pasar por UTC, que desplazaría el día. */
function aTexto(f: Date): string {
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
}

/** `AAAA-MM-DD` -> `Date` local. `new Date('2026-09-01')` daría el 31 de agosto. */
function aFecha(texto: string): Date {
  const [a, m, d] = texto.split('-').map(Number);
  return new Date(a, (m || 1) - 1, d || 1);
}

function mismoDia(a: Date, b: Date): boolean {
  return aTexto(a) === aTexto(b);
}

/**
 * Las celdas del mes, alineadas a lunes y con los huecos del principio.
 *
 * `getDay()` cuenta desde el domingo; aquí la semana empieza en lunes, que es
 * como se lee un calendario en español.
 */
function celdasDelMes(mes: Date): (Date | null)[] {
  const primero = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const dias = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
  const hueco = (primero.getDay() + 6) % 7;

  return [
    ...Array<null>(hueco).fill(null),
    ...Array.from({ length: dias }, (_, i) => new Date(mes.getFullYear(), mes.getMonth(), i + 1)),
  ];
}

/**
 * Atajos para los periodos que se piden siempre. Viven aquí y no en el menú
 * porque son la misma decisión que el calendario: tenerlos en dos sitios
 * obligaba a mirar en ambos para saber qué periodo estaba puesto.
 */
const ATAJOS: { etiqueta: string; dias: number }[] = [
  { etiqueta: '7 días', dias: 7 },
  { etiqueta: '30 días', dias: 30 },
  { etiqueta: '90 días', dias: 90 },
  // Un año son 8.760 horas por estación: la API de Emisiones lo admite justo
  // (su tope son 366 días) y el SIMAJ tarda lo suyo. Dos años se ofrecen para
  // el histórico, y quien lo pida ya verá el aviso de que va a tardar.
  { etiqueta: '1 año', dias: 365 },
  { etiqueta: '2 años', dias: 730 },
];

interface PropsPanel {
  desde: string;
  hasta: string;
  /** Avisa con el rango completo, o con null mientras falta la segunda fecha. */
  onRango: (rango: { desde: string; hasta: string } | null) => void;
}

interface PropsMes {
  titulo: string;
  valor: Date | null;
  mes: Date;
  setMes: (m: Date) => void;
  /** Días que no se pueden elegir en este calendario. */
  bloqueado: (dia: Date) => boolean;
  onElegir: (dia: Date) => void;
  onEscribir: (texto: string) => void;
  min?: string;
  max: string;
  inicio: Date | null;
  fin: Date | null;
}

/** Un mes con su casilla de fecha encima: una de las dos mitades del panel. */
function Mes({ titulo, valor, mes, setMes, bloqueado, onElegir, onEscribir, min, max, inicio, fin }: PropsMes) {
  return (
    <div className="flex-1 min-w-[16rem]">
      <label className="block rounded-md border border-slate-300 bg-white px-3 py-2 mb-3">
        <span className="block text-xs font-medium text-slate-500">{titulo}</span>
        <input
          type="date"
          value={valor ? aTexto(valor) : ''}
          min={min}
          max={max}
          onChange={(e) => onEscribir(e.target.value)}
          className="w-full bg-transparent text-base text-slate-800 tabular-nums focus:outline-none"
        />
      </label>

      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}
          aria-label={`${titulo}: mes anterior`}
          className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm font-semibold text-slate-700">
          {MESES[mes.getMonth()]} {mes.getFullYear()}
        </span>
        <button
          type="button"
          onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}
          aria-label={`${titulo}: mes siguiente`}
          className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {DIAS.map((d, i) => (
          <span key={i} className="text-center text-xs font-medium text-slate-400 py-1">{d}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {celdasDelMes(mes).map((dia, i) => {
          if (!dia) return <span key={i} />;
          const fuera = bloqueado(dia);
          const esInicio = inicio && mismoDia(dia, inicio);
          const esFin = fin && mismoDia(dia, fin);
          const enMedio = inicio && fin && dia > inicio && dia < fin;

          let clases = 'text-slate-700 hover:bg-slate-100';
          if (fuera) clases = 'text-slate-300 cursor-not-allowed';
          else if (esInicio || esFin) clases = 'bg-primary-600 text-white font-semibold';
          else if (enMedio) clases = 'bg-primary-50 text-primary-700';

          return (
            <button
              key={i}
              type="button"
              disabled={fuera}
              onClick={() => onElegir(dia)}
              className={`h-10 rounded-md text-sm transition-colors ${clases}`}
            >
              {dia.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * El calendario en sí, sin envoltorio: dos meses lado a lado, el de la
 * izquierda para la fecha de inicio y el de la derecha para la de fin, cada
 * uno con su propia navegación. Así las dos fechas se eligen por separado y a
 * la vista, aunque estén a años de distancia.
 *
 * Se usa en dos sitios con pies distintos: como modal suelto desde el menú
 * (Cancelar / Aceptar) y como un paso del asistente de datos (Siguiente).
 */
export function PanelCalendario({ desde, hasta, onRango }: PropsPanel) {
  const [inicio, setInicio] = useState<Date | null>(aFecha(desde));
  const [fin, setFin] = useState<Date | null>(aFecha(hasta));
  const [mesInicio, setMesInicio] = useState(() => aFecha(desde));
  const [mesFin, setMesFin] = useState(() => aFecha(hasta));

  const hoy = useMemo(() => new Date(), []);

  /**
   * Un atajo deja el rango elegido, no lo aplica: sigue haciendo falta aceptar.
   */
  const atajo = (dias: number) => {
    const f = new Date();
    const ini = new Date();
    ini.setDate(ini.getDate() - (dias - 1));
    setInicio(ini);
    setFin(f);
    setMesInicio(new Date(ini.getFullYear(), ini.getMonth(), 1));
    setMesFin(new Date(f.getFullYear(), f.getMonth(), 1));
  };

  const ponerInicio = (dia: Date) => {
    if (Number.isNaN(dia.getTime()) || dia > hoy) return;
    setInicio(dia);
    // Un inicio posterior al fin dejaría un rango imposible: el fin se borra.
    if (fin && dia > fin) setFin(null);
    setMesInicio(new Date(dia.getFullYear(), dia.getMonth(), 1));
  };

  const ponerFin = (dia: Date) => {
    if (Number.isNaN(dia.getTime()) || dia > hoy || (inicio && dia < inicio)) return;
    setFin(dia);
    setMesFin(new Date(dia.getFullYear(), dia.getMonth(), 1));
  };

  const dias = inicio && fin
    ? Math.round((fin.getTime() - inicio.getTime()) / 86_400_000) + 1
    : null;

  // Se avisa al padre con el rango completo, o con null si falta una fecha.
  useEffect(() => {
    onRango(inicio && fin ? { desde: aTexto(inicio), hasta: aTexto(fin) } : null);
  }, [inicio, fin, onRango]);

  return (
    <>
      <div className="px-5 py-4">
        <div className="flex flex-wrap gap-2 mb-4">
          {ATAJOS.map(({ etiqueta, dias: d }) => (
            <button
              key={d}
              type="button"
              onClick={() => atajo(d)}
              className="flex-1 min-w-[4rem] px-2 py-1.5 rounded-md text-sm font-medium border border-slate-300 text-slate-600 bg-white hover:bg-slate-100 transition-colors"
            >
              {etiqueta}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-6">
          <Mes
            titulo="Desde"
            valor={inicio}
            mes={mesInicio}
            setMes={setMesInicio}
            bloqueado={(dia) => dia > hoy}
            onElegir={ponerInicio}
            onEscribir={(t) => t && ponerInicio(aFecha(t))}
            max={aTexto(hoy)}
            inicio={inicio}
            fin={fin}
          />
          <Mes
            titulo="Hasta"
            valor={fin}
            mes={mesFin}
            setMes={setMesFin}
            bloqueado={(dia) => dia > hoy || (!!inicio && dia < inicio)}
            onElegir={ponerFin}
            onEscribir={(t) => t && ponerFin(aFecha(t))}
            min={inicio ? aTexto(inicio) : undefined}
            max={aTexto(hoy)}
            inicio={inicio}
            fin={fin}
          />
        </div>
      </div>

      <div className="px-5 py-2 border-t border-slate-200">
        <span className="text-sm text-slate-500 tabular-nums">
          {inicio && fin
            ? `${aTexto(inicio)} → ${aTexto(fin)} · ${dias} ${dias === 1 ? 'día' : 'días'}`
            : inicio
              ? `${aTexto(inicio)} → elige la fecha de fin`
              : 'Sin periodo'}
        </span>
      </div>
    </>
  );
}



interface Props {
  desde: string;
  hasta: string;
  onAceptar: (rango: { desde: string; hasta: string }) => void;
  onCerrar: () => void;
}

/** El calendario como diálogo suelto, que es como lo abre el menú. */
export default function CalendarioRango({ desde, hasta, onAceptar, onCerrar }: Props) {
  const [rango, setRango] = useState<{ desde: string; hasta: string } | null>(null);

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [onCerrar]);

  // Se monta en el <body> y no donde vive el componente. El menú lateral tiene
  // un `transform` para deslizarse, y un ancestro transformado se convierte en
  // el marco de referencia de sus descendientes `fixed`: sin el portal, el
  // diálogo quedaba encajonado en los 256 px del menú en vez de centrado.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCerrar}
      role="presentation"
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Elegir periodo"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h2 className="font-semibold text-slate-800">Elegir periodo</h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="p-1 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <PanelCalendario desde={desde} hasta={hasta} onRango={setRango} />

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onCerrar}
            className="px-3 py-1.5 rounded-md text-sm text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            // Sin las dos fechas no hay rango que aceptar. Deshabilitado en vez
            // de completar por nuestra cuenta: inventar el fin daría un periodo
            // que nadie pidió.
            disabled={!rango}
            onClick={() => rango && onAceptar(rango)}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
