import { useCallback, useEffect, useState } from 'react';
import {
  ScrollText, RefreshCw, Trash2, ChevronRight, AlertCircle, AlertTriangle, Check,
} from 'lucide-react';
import apiService, { type RegistroServidor } from '../services/api';
import ReporteFallas from '../components/ReporteFallas';
import TarjetaMir from '../components/TarjetaMir';
import { useDatos } from '../estado/DatosContexto';

/**
 * Lo que falla, en un solo sitio: la red y el servidor.
 *
 * Son dos cosas distintas y por eso van en secciones separadas, pero la
 * pregunta que traen a esta pantalla es la misma —«¿qué está fallando?»—, y
 * tenerlas en pestañas distintas obligaba a recordar cuál mirar.
 *
 * La red: el indicador MIR y, debajo, qué canales no llegan al umbral. Van
 * juntos porque el indicador plantea la pregunta —esta estación se queda en
 * 64— y la lista la contesta: cuál de sus canales la hunde. Vivían en el
 * tablero, entre las gráficas y los resúmenes del periodo, que es donde se mira
 * el dato; esto es lo contrario, es la lista de lo que hay que ir a arreglar.
 *
 * El servidor: cuando algo fallaba, la traza se iba a la salida estándar y ahí
 * moría. En desarrollo se ve en la terminal, pero en un servidor —y más dentro
 * de un contenedor— no la ve nadie: el usuario decía «no funciona» y había que
 * entrar por SSH para enterarse de qué había pasado.
 */

type Nivel = 'todos' | 'ERROR' | 'WARNING';

const ESTILOS: Record<string, { fondo: string; texto: string; icono: typeof AlertCircle }> = {
  ERROR: { fondo: 'bg-red-50 border-red-200', texto: 'text-red-700', icono: AlertCircle },
  WARNING: { fondo: 'bg-amber-50 border-amber-200', texto: 'text-amber-700', icono: AlertTriangle },
};

function estiloDe(nivel: string) {
  return ESTILOS[nivel] ?? {
    fondo: 'bg-slate-50 border-slate-200',
    texto: 'text-slate-600',
    icono: AlertCircle,
  };
}

/** `2026-09-09T11:43:07` -> `09/09 11:43:07`, que es lo que se mira al comparar. */
function momento(iso: string): string {
  const f = new Date(iso);
  if (Number.isNaN(f.getTime())) return iso;
  return f.toLocaleString([], {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function Entrada({ registro }: { registro: RegistroServidor }) {
  const [abierta, setAbierta] = useState(false);
  const { fondo, texto, icono: Icono } = estiloDe(registro.nivel);

  return (
    <div className={`border rounded-lg ${fondo}`}>
      <div className="flex items-start gap-3 p-3">
        <Icono size={16} className={`${texto} shrink-0 mt-0.5`} />

        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-800 break-words">{registro.mensaje}</p>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            {momento(registro.momento)} · {registro.origen}
          </p>

          {registro.traza && (
            <>
              <button
                type="button"
                onClick={() => setAbierta((v) => !v)}
                className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${texto} hover:underline`}
              >
                <ChevronRight
                  size={13}
                  className={`transition-transform ${abierta ? 'rotate-90' : ''}`}
                />
                {abierta ? 'Ocultar la traza' : 'Ver la traza'}
              </button>

              {abierta && (
                /* La traza entera y sin recortar: recortada obliga a ir al
                   servidor a por el resto, que es lo que esta pantalla evita.
                   Se desplaza dentro de su caja para no ensanchar la página. */
                <pre className="mt-2 p-3 bg-slate-900 text-slate-100 rounded-md text-[11px] leading-relaxed overflow-x-auto">
                  {registro.traza}
                </pre>
              )}
            </>
          )}
        </div>

        <span className={`shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold ${texto}`}>
          {registro.nivel}
        </span>
      </div>
    </div>
  );
}

export default function Registros() {
  // Las fallas de la red salen del periodo que haya cargado, no de una consulta
  // propia: solo existen cuando los datos vienen del SIMAJ, porque un archivo
  // suelto no dice qué horas deberia haber en el periodo.
  const { fallas, mir, descripcion, contaminantesMir, cambiarContaminantesMir } = useDatos();

  const [registros, setRegistros] = useState<RegistroServidor[]>([]);
  const [nivel, setNivel] = useState<Nivel>('todos');
  const [capacidad, setCapacidad] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (n: Nivel) => {
    setCargando(true);
    setError(null);
    try {
      const r = await apiService.registros(n === 'todos' ? undefined : n);
      setRegistros(r.registros);
      setCapacidad(r.capacidad);
    } catch {
      setError('No se pudo leer el registro. ¿Está el servidor en marcha?');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(nivel); }, [cargar, nivel]);

  const vaciar = async () => {
    await apiService.limpiarRegistros();
    cargar(nivel);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ScrollText className="w-8 h-8 text-primary-600" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Registros</h1>
          <p className="text-slate-600">
            Lo que falla en la red y lo que falla en el servidor
          </p>
        </div>
      </div>

      {/* ── La red ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Red de monitoreo
          </h2>
          {descripcion && (
            <span className="text-xs text-slate-400">{descripcion}</span>
          )}
        </div>

        {mir ? (
          <>
            <TarjetaMir
              mir={mir}
              contaminantes={contaminantesMir}
              onCambiarContaminantes={cambiarContaminantesMir}
            />
            <ReporteFallas fallas={fallas} />
          </>
        ) : (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-8 text-center">
            <p className="text-slate-600">Sin periodo del SIMAJ cargado.</p>
            <p className="text-sm text-slate-500 mt-1">
              Descarga uno desde «Consultar datos» para ver qué canales no
              llegan al umbral. Un archivo suelto no sirve: no dice cuántas
              horas debería haber en el periodo.
            </p>
          </div>
        )}
      </section>

      {/* ── El servidor ── */}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 pt-2">
        Servidor
      </h2>

      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(['todos', 'ERROR', 'WARNING'] as Nivel[]).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNivel(n)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                nivel === n
                  ? 'bg-primary-50 border-primary-300 text-primary-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {n === 'todos' ? 'Todos' : n === 'ERROR' ? 'Errores' : 'Avisos'}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => cargar(nivel)}
          disabled={cargando}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} />
          Actualizar
        </button>

        <button
          type="button"
          onClick={vaciar}
          disabled={cargando || registros.length === 0}
          title="Vaciar la lista para reproducir un fallo desde cero"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-50"
        >
          <Trash2 size={14} />
          Vaciar
        </button>

        <span className="ml-auto text-xs text-slate-400">
          {registros.length} de los últimos {capacidad} · se pierden al reiniciar
        </span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {!error && registros.length === 0 && !cargando && (
        /* Que no haya nada es la situación normal, así que se dice con alivio y
           no con cara de error: una pantalla vacía y gris haría dudar de si
           falló la consulta. */
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
          <Check className="w-10 h-10 mx-auto text-green-500 mb-3" />
          <p className="text-slate-700 font-medium">Sin errores registrados.</p>
          <p className="text-sm text-slate-500 mt-1">
            {nivel === 'todos'
              ? 'El servidor no ha tenido ningún problema desde que arrancó.'
              : 'Nada de ese tipo. Prueba con «Todos».'}
          </p>
        </div>
      )}

      {registros.length > 0 && (
        <div className="space-y-2">
          {registros.map((r) => <Entrada key={r.id} registro={r} />)}
        </div>
      )}
    </div>
  );
}
