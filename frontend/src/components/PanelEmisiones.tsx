import { useState, type FormEvent } from 'react';
import { LogIn, LogOut, RefreshCw, Search, AlertCircle, ShieldCheck } from 'lucide-react';
import { useDatos } from '../estado/DatosContexto';
import { DIAS_AVISO, DIAS_MAXIMOS } from '../services/emisiones';

/**
 * Acceso y consulta de la API de Emisiones de Jalisco.
 *
 * Son dos pantallas en el mismo hueco: mientras no hay token se pide correo y
 * contraseña, y en cuanto lo hay aparece el botón de consultar. No son dos
 * paneles separados porque el usuario no elige entre ellos — el token es un
 * requisito del camino, no una opción.
 *
 * El token vive en el backend. Por eso aquí no se guarda nada: al recargar la
 * página el contexto vuelve a preguntar si la sesión sigue viva, y si caduca a
 * mitad de una consulta el estado se limpia solo y este componente vuelve a
 * mostrar el acceso.
 *
 * «Recordar la sesión» hace que el backend la guarde en el perfil del usuario y
 * sobreviva al reinicio. Va desmarcada a propósito: deja una credencial en
 * disco, y esa es una decisión del usuario, no un valor por defecto.
 *
 * El periodo NO se elige aquí: es común a todos los orígenes y vive arriba, en
 * SelectorPeriodo. Lo único propio que queda es el tope de 31 días por
 * consulta, que sí es de esta API.
 */

function Acceso() {
  const { entrarEmisiones } = useDatos();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recordar, setRecordar] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setFallo(null);
    try {
      await entrarEmisiones(email.trim(), password, recordar);
      // La contraseña se borra del estado en cuanto deja de hacer falta: el
      // backend ya tiene el token y no hay razón para seguir teniéndola aquí.
      setPassword('');
    } catch (err) {
      const detalle = (err as { response?: { data?: { error?: string } } })
        .response?.data?.error;
      setFallo(detalle ?? 'No se pudo iniciar sesión.');
    } finally {
      setEnviando(false);
    }
  };

  const campo = 'w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm ' +
    'bg-white disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-primary-400';

  return (
    <form onSubmit={enviar} className="space-y-2">
      <p className="text-[11px] text-slate-500 leading-snug">
        Credenciales de emisiones.jalisco.gob.mx. Solo se usan para pedir el
        token de acceso; no se guardan.
      </p>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Correo"
        autoComplete="username"
        required
        disabled={enviando}
        className={campo}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Contraseña"
        autoComplete="current-password"
        required
        disabled={enviando}
        className={campo}
      />
      {/* Marcada por defecto: el token dura una semana, asi que guardarlo
          convierte "entrar cada vez" en "entrar una vez al mes largo". Sigue
          siendo una casilla y no una imposicion, porque deja una credencial en
          disco y quien use un equipo compartido tiene que poder decir que no. */}
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={recordar}
          disabled={enviando}
          onChange={(e) => setRecordar(e.target.checked)}
          className="mt-0.5 w-3.5 h-3.5 accent-primary-600 cursor-pointer"
        />
        <span className="text-[11px] text-slate-600 leading-snug">
          Recordar la sesión en este equipo
          <span className="block text-slate-400">
            El token dura una semana: guardándolo no hay que volver a entrar en
            todo ese tiempo, ni siquiera al reiniciar. Guarda el token —nunca la
            contraseña— en tu perfil de usuario.
          </span>
        </span>
      </label>

      {fallo && (
        <p className="flex items-start gap-1.5 text-[11px] text-red-700 leading-snug">
          <AlertCircle size={13} className="shrink-0 mt-px" />
          {fallo}
        </p>
      )}
      <button
        type="submit"
        disabled={enviando || !email || !password}
        className="w-full inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
      >
        {enviando ? <RefreshCw size={14} className="animate-spin" /> : <LogIn size={14} />}
        {enviando ? 'Entrando…' : 'Iniciar sesión'}
      </button>
    </form>
  );
}

function Consulta() {
  const { sesionEmisiones, cargarEmisiones, salirEmisiones, cargando, periodo } = useDatos();

  // El periodo se elige arriba, en el selector común. Aquí solo se comprueba
  // que sea legal PARA ESTA API, y se avisa —sin bloquear— de que un periodo
  // largo tarda. Un aviso que impide seguir obliga a adivinar el limite; uno
  // que informa deja decidir con el dato delante.
  const dias = Math.round(
    (new Date(periodo.hasta).getTime() - new Date(periodo.desde).getTime()) / 86_400_000,
  );
  const rangoValido = Number.isFinite(dias) && dias > 0 && dias <= DIAS_MAXIMOS;
  const rangoLargo = rangoValido && dias > DIAS_AVISO;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-500 truncate" title={sesionEmisiones.email ?? ''}>
          {sesionEmisiones.email}
        </span>
        <button
          type="button"
          onClick={salirEmisiones}
          title="Cerrar sesión y borrar el token guardado"
          className="text-slate-400 hover:text-slate-700 shrink-0"
        >
          <LogOut size={13} />
        </button>
      </div>

      {sesionEmisiones.recordada && (
        <p
          className="flex items-start gap-1.5 text-[11px] text-slate-400 leading-snug"
          title="El token está guardado en tu perfil de usuario. Cierra la sesión para borrarlo."
        >
          <ShieldCheck size={12} className="shrink-0 mt-px" />
          Sesión recordada en este equipo
          {sesionEmisiones.caduca
            ? `, hasta el ${new Date(sesionEmisiones.caduca).toLocaleDateString()}`
            : ''}
        </p>
      )}

      {!rangoValido && (
        <p className="text-[11px] text-amber-700 leading-snug">
          {dias <= 0
            ? 'Ajusta el periodo: la fecha final debe ser posterior a la inicial.'
            : `El máximo por consulta es de ${DIAS_MAXIMOS} días. Acorta el periodo de arriba.`}
        </p>
      )}

      {rangoLargo && (
        <p className="text-[11px] text-slate-500 leading-snug">
          {dias} días es un periodo largo: la primera consulta puede tardar
          un par de minutos. Las siguientes van rápidas — los días ya
          descargados quedan guardados.
        </p>
      )}

      <button
        type="button"
        disabled={cargando || !rangoValido}
        onClick={() => cargarEmisiones()}
        className="w-full inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
      >
        {cargando ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
        {cargando ? 'Consultando…' : 'Consultar'}
      </button>
    </div>
  );
}


export default function PanelEmisiones() {
  const { sesionEmisiones } = useDatos();
  return (
    <div className="mt-2 px-2.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200">
      {sesionEmisiones.activa ? <Consulta /> : <Acceso />}
    </div>
  );
}
