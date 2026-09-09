import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

/**
 * Calendario para elegir un rango: primero una fecha, después la otra.
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
];

interface Props {
  desde: string;
  hasta: string;
  onAceptar: (rango: { desde: string; hasta: string }) => void;
  onCerrar: () => void;
}

export default function CalendarioRango({ desde, hasta, onAceptar, onCerrar }: Props) {
  const [inicio, setInicio] = useState<Date | null>(aFecha(desde));
  const [fin, setFin] = useState<Date | null>(aFecha(hasta));
  const [mes, setMes] = useState(() => aFecha(desde));
  const [encima, setEncima] = useState<Date | null>(null);

  const hoy = useMemo(() => new Date(), []);

  /**
   * Un atajo deja el rango elegido, no lo aplica: sigue haciendo falta aceptar.
   * Así se ve en el calendario qué se acaba de seleccionar antes de confirmar,
   * y un clic de más no cambia el periodo sin querer.
   */
  const atajo = (dias: number) => {
    const fin = new Date();
    const ini = new Date();
    ini.setDate(ini.getDate() - (dias - 1));
    setInicio(ini);
    setFin(fin);
    setMes(new Date(ini.getFullYear(), ini.getMonth(), 1));
  };

  // Escapar cierra el diálogo. Es lo que espera cualquiera que lo abra sin
  // querer, y evita tener que buscar la aspa con el ratón.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [onCerrar]);

  /**
   * Primer clic: fija el inicio y deja el fin abierto. Segundo clic: cierra el
   * rango. Si cae antes del inicio no se rechaza —eso obligaría a adivinar el
   * orden—, se toma como nuevo inicio.
   */
  const elegir = (dia: Date) => {
    if (dia > hoy) return;
    if (!inicio || fin) {
      setInicio(dia);
      setFin(null);
      return;
    }
    if (dia < inicio) {
      setInicio(dia);
      return;
    }
    setFin(dia);
  };

  // Mientras falta el segundo clic, el rango se previsualiza con el ratón.
  const finVisible = fin ?? (inicio && encima && encima >= inicio ? encima : null);

  const dentro = (dia: Date) =>
    inicio && finVisible && dia > inicio && dia < finVisible;

  const dias = inicio && fin
    ? Math.round((fin.getTime() - inicio.getTime()) / 86_400_000) + 1
    : null;

  // Se monta en el <body> y no donde vive el componente. El menú lateral tiene
  // un `transform` para deslizarse, y un ancestro transformado se convierte en
  // el marco de referencia de sus descendientes `fixed`: sin el portal, el
  // diálogo quedaba encajonado en los 256 px del menú en vez de centrado en la
  // pantalla.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCerrar}
      role="presentation"
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-sm"
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

        <div className="px-4 py-3">
          <div className="flex gap-1 mb-3">
            {ATAJOS.map(({ etiqueta, dias: d }) => (
              <button
                key={d}
                type="button"
                onClick={() => atajo(d)}
                className="flex-1 px-2 py-1.5 rounded-md text-xs font-medium border border-slate-300 text-slate-600 bg-white hover:bg-slate-100 transition-colors"
              >
                {etiqueta}
              </button>
            ))}
          </div>

          {/* Qué falta por pulsar, dicho en una línea. Sin esto, el segundo clic
              es adivinar si el calendario está esperando algo. */}
          <p className="text-xs text-slate-500 mb-3">
            {!inicio || fin
              ? 'Pulsa la fecha de inicio.'
              : 'Ahora pulsa la fecha de fin.'}
          </p>

          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}
              aria-label="Mes anterior"
              className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-medium text-slate-700">
              {MESES[mes.getMonth()]} {mes.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}
              aria-label="Mes siguiente"
              className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {DIAS.map((d, i) => (
              <span key={i} className="text-center text-[11px] font-medium text-slate-400 py-1">
                {d}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5" onMouseLeave={() => setEncima(null)}>
            {celdasDelMes(mes).map((dia, i) => {
              if (!dia) return <span key={i} />;

              // El futuro no se puede consultar: no hay datos que pedir.
              const futuro = dia > hoy;
              const esInicio = inicio && mismoDia(dia, inicio);
              const esFin = fin && mismoDia(dia, fin);
              const enMedio = dentro(dia);

              let clases = 'text-slate-700 hover:bg-slate-100';
              if (futuro) clases = 'text-slate-300 cursor-not-allowed';
              else if (esInicio || esFin) clases = 'bg-primary-600 text-white font-semibold';
              else if (enMedio) clases = 'bg-primary-50 text-primary-700';

              return (
                <button
                  key={i}
                  type="button"
                  disabled={futuro}
                  onClick={() => elegir(dia)}
                  onMouseEnter={() => setEncima(dia)}
                  className={`h-9 rounded-md text-sm transition-colors ${clases}`}
                >
                  {dia.getDate()}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-200">
          <span className="text-xs text-slate-500 tabular-nums">
            {inicio && fin
              ? `${aTexto(inicio)} → ${aTexto(fin)} · ${dias} ${dias === 1 ? 'día' : 'días'}`
              : inicio
                ? `${aTexto(inicio)} → …`
                : 'Sin periodo'}
          </span>

          <div className="flex gap-2">
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
              // de completar por nuestra cuenta: inventar el fin daría un
              // periodo que nadie pidió.
              disabled={!inicio || !fin}
              onClick={() => inicio && fin && onAceptar({ desde: aTexto(inicio), hasta: aTexto(fin) })}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Aceptar
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
