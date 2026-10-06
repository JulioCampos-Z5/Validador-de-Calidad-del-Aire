import { useState, type FormEvent } from 'react'
import { login, ErrorApi } from '../compartido/api'
import type { Sesion } from '../compartido/tipos'

export function Login({ alEntrar }: { alEntrar: (s: Sesion) => void }) {
  const [correo, setCorreo] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!correo.trim() || !contrasena) {
      setError('Escribe tu correo y tu contraseña')
      return
    }
    setEnviando(true)
    setError('')
    try {
      alEntrar(await login(correo.trim(), contrasena))
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo iniciar sesión')
      setEnviando(false)
    }
  }

  return (
    <main className="login">
      <form className="login-caja" onSubmit={enviar} noValidate>
        <div className="marca">VA</div>
        <h1 className="titulo">Validador de Calidad del Aire</h1>
        <p className="cap" style={{ margin: '4px 0 22px' }}>Entra con tu cuenta</p>

        <label className="campo">
          <span>Correo</span>
          <input type="email" autoComplete="username" value={correo} placeholder="nombre@jalisco.gob.mx"
            onChange={(e) => { setCorreo(e.target.value); setError('') }} />
        </label>
        <label className="campo">
          <span>Contraseña</span>
          <input type="password" autoComplete="current-password" value={contrasena}
            onChange={(e) => { setContrasena(e.target.value); setError('') }} />
        </label>

        {error && <p className="login-error" role="alert">{error}</p>}

        <button className="boton elegido login-entrar" type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
