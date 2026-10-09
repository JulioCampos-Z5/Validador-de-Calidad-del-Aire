# App de escritorio v2

El validador v2 sin servidor: todo corre en la computadora de quien lo usa.
Convive con la app de escritorio v1 (`escritorio/`), que sigue con su propio
instalador.

| Pieza | Qué es | Puerto |
|---|---|---|
| `validador-api.exe` | API de Go (`api/`). Usuarios y Ambient Weather en **SQLite**; sirve también el front v2 (`web/dist`) | 127.0.0.1:18081 |
| `validador-backend.exe` | Motor de análisis en Python (`backend/`), empaquetado con PyInstaller | 127.0.0.1:18010 |
| Electron | Abre la ventana sobre la API y arranca/detiene los dos procesos | — |

Módulos: Tablero, Validación, Gráficas, Registros, Parámetros, Ambient Weather
y Admin. Estaciones e Inventario salen «en proceso» (necesitan el servidor).

## Generar el instalador

Requiere Go, Python con `pip install -r backend/requirements.txt pyinstaller`
y pnpm.

```bash
pnpm --dir escritorio-v2 exe
```

Deja `salida-v2/Validador-v2-instalador.exe`. Para probar sin instalar:

```bash
pnpm --dir escritorio-v2 dev
```

(En desarrollo el motor corre con el Python del sistema.)

Si `proxy.golang.org` no responde desde la red, las dependencias de Go se bajan
directo de su repositorio con `GOPROXY=direct`.

## Datos

En `%APPDATA%\validador-escritorio-v2\datos` (menú **Datos → Abrir la
carpeta de datos**). La comparten la app instalada y `pnpm dev`:

- `usuarios.sqlite`, `ambient_weather.sqlite`, `historico.sqlite`
- `config.env`: llave de sesión (se genera sola) y las llaves de Ambient
  Weather. Menú **Datos → Configuración**; después de editarlo, cierra y
  vuelve a abrir la app.

### Llaves de Ambient Weather

El instalador ya las trae: al compilar, `preparar-llaves.mjs` las toma de
`api/.env` y las empaca (`build/llaves.env`). Al abrir, llenan las de
`config.env` que estén vacías; una llave escrita a mano no se pisa. Ni
`api/.env` ni `build/` se suben a git, pero quien tenga el instalador puede
extraerlas: si se comparte fuera del laboratorio, regenéralas.

### API de Emisiones

Para que la app entre sola a la API de Emisiones, llena en `config.env`:

```
EMISIONES_CORREO=tu.correo@jalisco.gob.mx
EMISIONES_CONTRASENA=tu-contraseña
```

y cierra y vuelve a abrir la app. El motor pide el token cuando no hay sesión
(al abrir y cuando caduca). La contraseña queda en texto plano en ese archivo,
en tu perfil; **no** viaja en el instalador ni se toma de `api/.env`. Con una
contraseña equivocada espera 10 minutos antes de reintentar, para no bloquear
la cuenta. **Salir** apaga el acceso automático hasta volver a abrir la app o
entrar a mano.

### Sesión

En el login, **Mantener la sesión iniciada** guarda la sesión hasta 30 días
(`API_DURACION_RECORDAR`), también al cerrar y abrir la app. **Salir** la
cierra en el momento.
- `registro.log`: bitácora de la app, la API y el motor.

## Usuario principal

La primera vez que se abre, con la base de usuarios vacía, se crea un usuario
**root** (`config.mjs`, `USUARIO_INICIAL`). En el código va solo el hash bcrypt
de la contraseña, nunca la contraseña. Después se administra desde **Admin**;
cambiar la contraseña ahí la cambia en la base, y el usuario inicial ya no
vuelve a crearse.

Para cambiar la contraseña con que se crea en instalaciones nuevas:

```bash
go -C api run ./cmd/admin hash-contrasena
```

y pega el hash en `USUARIO_INICIAL.hash`.
