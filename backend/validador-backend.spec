# -*- mode: python ; coding: utf-8 -*-
"""
Empaquetado del backend con PyInstaller.

Por qué existe
--------------
La app de escritorio arrancaba el backend con `python app.py`, así que exigía
tener Python 3.10+ instalado en la máquina. Para quien recibe un .exe eso no es
un requisito razonable: instalar un intérprete, acertar con la versión y con el
PATH es más trabajo que la propia herramienta.

Con esto el intérprete y las librerías viajan dentro de la app. No hace falta
Python, ni internet, ni permisos de administrador, y vale igual para el
instalador y para el portable.

Por qué en carpeta y no en un solo archivo
------------------------------------------
`--onefile` produce un .exe único y bonito que, en cada arranque, descomprime
100 MB de pandas y numpy en una carpeta temporal. Son varios segundos añadidos a
cada apertura de la ventana, todas las veces. En carpeta, el arranque es directo:
el usuario no ve la diferencia porque electron-builder envuelve todo en un
instalador de todos modos.

Se construye con:

    cd backend && python -m PyInstaller validador-backend.spec --noconfirm
"""

# Módulos que PyInstaller no ve porque nadie los importa por su nombre: los
# carga openpyxl por su cuenta al escribir el Excel. Sin esto el empaquetado
# funciona hasta que alguien pulsa "Exportar validación".
ocultos = [
    'openpyxl.cell._writer',
]

# Nada de esto lo usa el backend, y son decenas de MB. `tkinter` entra sola por
# ser parte de la biblioteca estándar; matplotlib y compañía entran arrastradas
# por pandas aunque no se usen.
sobra = [
    'tkinter',
    'matplotlib',
    'PyQt5',
    'PySide2',
    'IPython',
    'jupyter',
    'notebook',
    'sqlalchemy',
    'pytest',
    'PIL',
]

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=ocultos,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=sobra,
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='validador-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # Consola sí, ventana no: el backend escribe sus trazas por stdout y Electron
    # las recoge. Se lanza con `windowsHide`, así que la consola nunca se ve.
    # Compilarlo como aplicación de ventana dejaría `sys.stdout` en None y
    # cualquier `print` del backend reventaría.
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='validador-backend',
)
