import { useState, type FormEvent } from 'react';
import { LogIn, RefreshCw, AlertCircle } from 'lucide-react';
import { useDatos } from '../estado/DatosContexto';

/**
 * Acceso a la API de Emisiones: correo, contraseña y la casilla de recordar.
 *
 * Vive en su propio archivo porque es un paso del asistente de datos y no una
 * pantalla: solo aparece cuando no hay token vivo, y en cuanto lo hay el
 * asistente sigue con las fechas sin volver a pasar por aquí.
 *
 * La contraseña se usa para pedir el token y se borra del estado en cuanto deja
 * de hacer falta. No se guarda nunca, ni aquí ni en el backend.
 */

export default function AccesoEmisiones({ onEntrado }: { onEntrado: () => void }) {
  const { entrarEmisiones } = useDatos();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Marcada por defecto: el token dura una semana, así que guardarlo convierte
  // «entrar cada vez» en «entrar una vez a la semana». Sigue siendo una casilla
  // porque deja una credencial en disco y en un equipo compartido hay que poder
  // decir que no.
  const [recordar, setRecordar] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setFallo(null);
    try {
      await entrarEmisiones(email.trim(), password, recordar);
      setPassword('');
      onEntrado();
    } catch (err) {
      const detalle = (err as { response?: { data?: { error?: string } } })
        .response?.data?.error;
      setFallo(detalle ?? 'No se pudo iniciar sesión.');
    } finally {
      setEnviando(false);
    }
  };

  const campo = 'w-full border border-slate-300 rounded-md px-3 py-2 text-sm ' +
    'bg-white disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-primary-400';

  return (
    <form id="acceso-emisiones" onSubmit={enviar} className="space-y-3">
      <p className="text-sm text-slate-500 leading-snug">
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

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={recordar}
          disabled={enviando}
          onChange={(e) => setRecordar(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-primary-600 cursor-pointer"
        />
        <span className="text-xs text-slate-600 leading-snug">
          Recordar la sesión en este equipo
          <span className="block text-slate-400">
            El token dura una semana: guardándolo no hay que volver a entrar en
            todo ese tiempo. Guarda el token, nunca la contraseña.
          </span>
        </span>
      </label>

      {fallo && (
        <p className="flex items-start gap-1.5 text-xs text-red-700 leading-snug">
          <AlertCircle size={14} className="shrink-0 mt-px" />
          {fallo}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando || !email || !password}
        className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
      >
        {enviando ? <RefreshCw size={15} className="animate-spin" /> : <LogIn size={15} />}
        {enviando ? 'Entrando…' : 'Iniciar sesión'}
      </button>
    </form>
  );
}
