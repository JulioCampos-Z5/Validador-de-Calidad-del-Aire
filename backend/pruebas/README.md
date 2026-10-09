# Pruebas

```bash
cd backend
python -m unittest discover -s pruebas -t .
```

Sin dependencias: `unittest` viene con Python. No hace falta instalar nada, que
es lo que corresponde a un proyecto que se ejecuta en equipos donde lo único
seguro es que hay Python y `requirements.txt`.

Para ver los nombres una a una, `-v`. Para un solo módulo:

```bash
python -m unittest pruebas.test_validaciones
```

---

## Qué cubre cada archivo

| Archivo | Qué fija |
|---|---|
| `test_validaciones.py` | Los umbrales del script del área técnica: rangos, temperatura de cabina, series constantes, relaciones NOx y PM, y las cinco reglas meteorológicas |
| `test_emisiones_cliente.py` | El parseo de la API de Emisiones y sus rarezas, el troceado del periodo y la caché por día |
| `test_rutas_emisiones.py` | Los endpoints: quién guarda la sesión, quién la borra y qué se le cuenta al frontend |
| `test_almacen.py` | La sesión guardada en disco: se descarta cuando está caducada, ilegible o a medias |
| `test_minutales.py` | El parseo de los `.lsi` del SIMAJ y el indicador MIR |
| `test_carga_envista.py` | La entrada de datos: los dos layouts de ENVISTA, la fecha día-mes-año, el decimal con coma, las banderas, la conversión al formato BD y la exportación a Excel |
| `test_endpoints_validacion.py` | El contrato de la API: subida, validación completa de punta a punta, descarga, vista previa de un archivo ya validado y la entrega de la app de escritorio |
| `test_rutas_historico.py` | La base local de escritorio por HTTP: guardar lo cargado, traer un periodo, la serie de un parámetro, cambios pendientes al importar, el historial de cargas y que fuera del escritorio todo diga «no disponible» |
| `test_rutas_minutales.py` | Las rutas del SIMAJ con la red simulada: periodo inválido, sin red, periodo vacío, nada por fallas de red, descarga incompleta y la respuesta completa; y los avisos de `red.py` |
| `test_ias.py` | Índice Aire y Salud y cumplimiento NOM: redondeo half-up, NowCast, bandas por año, suficiencia 18/24, responsable y desempate, AMG, municipios, endpoints y Excel. Incluye una prueba por cada error corregido del script `validador_ENVISTA_IAS_NOM_num.py` |

---

## Cómo están escritas

**Ninguna prueba toca la red.** El transporte de la API se sustituye por una
función que anota qué se pidió y devuelve datos construidos. Así se puede
comprobar algo que de otro modo no se ve: que la segunda consulta del mismo
periodo **no hace ninguna petición** porque está en caché.

**Ninguna prueba escribe en el perfil del usuario.** La sesión guardada se
desvía a una carpeta temporal apuntando `almacen.CARPETA_POR_DEFECTO` a otro
sitio. Una prueba que deja un archivo en el disco de quien la ejecuta es una
prueba que hay que limpiar a mano.

**Cada número tiene una razón escrita.** Los umbrales no son preferencias del
código: son acuerdos con el área técnica. Si alguien cambia el máximo de PM10 de
1000 a 900 o la tolerancia de NOx de 0.15 a 0.10, las pruebas lo dicen y el
mensaje explica de dónde salía el número.

**Los casos límite son los que importan.** Tres horas iguales no bastan cuando
el criterio es «más de 3». Una amplitud de 1.1° en la dirección del viento no se
marca cuando el umbral es 1°. 359° y 1° distan 2°, no 358°. Un hueco de
publicación no es una serie plana. Esas son las que se rompen al refactorizar.

---

## Lo que no cubren

- **El front.** Tiene sus propias pruebas en `web/` (`pnpm --dir web test`).
- **La API real.** Las pruebas fijan cómo se interpreta la respuesta, no que el
  servidor siga respondiendo así. Si la API cambia de formato, el parseo falla
  con un mensaje que lista los campos recibidos, y `GET /api/emisiones/muestra`
  enseña la respuesta cruda.
- **El formato de la hoja de Excel.** Se comprueba que estén las seis hojas y
  que los decimales sean los del script, no cómo se ve el archivo abierto.
