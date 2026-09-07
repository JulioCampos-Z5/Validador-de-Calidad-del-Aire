# Validaciones: qué se aplica y por qué

Referencia de lo que hace el validador, contrastado con el documento **«Script
validación para datos de calidad del aire»**, que es la especificación
funcional, y con la **NOM-156-SEMARNAT-2012**, que es el marco legal.

---

## Alineado con el script

Los 17 parámetros con sus abreviaturas BASE↔ENVISTA y sus decimales; las 13
estaciones; las 10 banderas; el mapeo de banderas de ENVISTA; los rangos; la
verificación por temperatura de cabina; y las relaciones NOx y PM.

---

## Cambios hechos para cumplir la especificación

| Qué | Antes | Ahora | Por qué |
|---|---|---|---|
| Rango de PM10 y PM2.5 | 0–900 µg/m³ | **0–1000** | El script dice 1000. Con 900, un episodio de quema agrícola se marcaba `IR` siendo válido. |
| Tolerancia de NOx | ±0.10 | **±0.15** | El script pide (NO+NO₂)/NOx dentro de **0.85–1.15**. Con 0.10 se invalidaban horas que la especificación acepta. |
| Banderas de ENVISTA | `InvId`, `Below R` | + `Invld`, `InvLd`, `Invalid`, `AboveR`, `BelowR` | La clave `InvId` lleva **i mayúscula** y no casaría nunca con `InvLd`; el script escribe `BelowR` sin espacio. Se añaden variantes en vez de sustituir: sin un `Trs.xlsx` delante no se puede saber cuál manda ENVISTA, y sobrar no cuesta nada. **Conviene confirmarlo con un archivo real.** |

---

## Verificaciones por serie de tiempo añadidas

Faltaba media tabla del script — toda la parte meteorológica. Las cinco reglas
marcan `IO` y comparten una idea: **un sensor averiado no deja de dar números,
da números plausibles**. Un anemómetro trabado reporta 1.3 m/s hora tras hora y
pasa cualquier validación por rango; lo que lo delata es que no varía.

| Regla | Criterio | Por defecto |
|---|---|---|
| **Radiación nocturna** | RS y UVI distintos de cero entre las 22:00 y las 05:00 | Activa |
| **Viento sin variación** | WS: ≤0.1 m/s en 3 h o ≤0.5 m/s en 12 h. WD: ≤1° en 3 h o ≤10° en 18 h | Activa |
| **Temperatura externa** | salto >5 °C contra la hora previa, o ≤0.5 °C en 12 h | Activa |
| **Presión barométrica** | cambio >0.75 mmHg en 3 h | **Desactivada** — ver abajo |

Tres detalles de implementación que cambian el resultado:

**La ventana se mide en horas de calendario, no en filas.** Si una estación deja
de publicar seis horas, las filas de antes y después son contiguas en el
DataFrame pero no en el tiempo. Compararlas inventaría una serie plana que nunca
existió. Una ventana con huecos no se evalúa: no se puede afirmar que una serie
es plana sobre datos que no están.

**La dirección del viento se compara en círculo.** Restar el mínimo del máximo
daría 358° para 359° y 1°, y una veleta trabada apuntando al norte parecería
estar girando media rosa de los vientos. La amplitud real es 360 menos el hueco
mayor entre ángulos consecutivos.

**Se marca la ventana entera, no solo su última hora.** Si un sensor lleva doce
horas clavado, las doce son sospechosas.

### El umbral de radiación no es cero

El script dice «diferente a cero». A cero estricto la regla marcaría casi todas
las noches: el sensor real reporta 2–4 W/m² de ruido a las 00:00. El umbral
—5 W/m² para RS, 0.1 para UVI— es por dónde empieza a ser una lectura y no
ruido, y es configurable (`radiacion_umbrales`). En la práctica da igual el
valor exacto: la distribución es bimodal, y mover el umbral de 1 a 20 W/m²
cambia el resultado del 51.1% al 51.0% de horas nocturnas.

### Por qué la presión viene desactivada

Medido contra un mes completo de la red (27,994 filas, 13 estaciones), el umbral
de **0.75 mmHg del script marca el 54.6% de las ventanas**. La amplitud mediana
real en 3 horas ya es 0.84 mmHg. Con ese número la regla no detecta nada, solo
tiñe la columna entera.

| Umbral | Ventanas marcadas |
|---|---|
| 0.75 mmHg (script) | 54.6% |
| 1.5 mmHg | 27.3% |
| 3.0 mmHg | 13.8% |
| 4.0 mmHg | 10.3% |

El percentil 90 está en 4.14 mmHg. La regla está implementada y se activa con
una casilla; el umbral se cambia con `presion_umbral`. **Fijar ese número es
decisión del área técnica**, no del código, y por eso no se impone un valor
inventado ni se deja correr el del script.

---

## Qué encontró en datos reales

Sobre ese mismo mes, porcentaje de horas marcadas `IO` por las reglas nuevas:

| Estación | WS | WD | ET | RS |
|---|---|---|---|---|
| **VAL** | 22.5% | **73.7%** | 1.3% | – |
| **OBL** | **54.0%** | 0.7% | 0.6% | **33.5%** |
| **PIN** | 15.3% | 0.3% | 0.4% | **33.7%** |
| **TLA** | 0.0% | **12.9%** | **13.3%** | – |
| COU / SFE | 4.5% / 18.9% | 0.2% / 0.0% | 0.5% / 1.0% | 0.0% / 0.0% |

El fondo en las estaciones sanas es bajo (WD ~0–0.6%, ET ~0.5–2.6%), así que lo
que sobresale son hallazgos, no ruido del método:

- **La veleta de Vallarta** está prácticamente clavada: 73.7% de sus horas.
- **El anemómetro de Oblatos** reporta sin variar el 54% del tiempo.
- **Los piranómetros de Oblatos y Las Pintas** dan radiación de día pleno por la
  noche: mediana de 30 W/m² y percentil 90 de 283 W/m² entre las 22:00 y las
  05:00, mientras Country y Santa Fe dan 0.0%. No es ruido de sensor, es un
  problema de esos dos equipos.

---

## Lo que sigue pendiente contra la NOM-156

- **`VZ` está definida y nunca se asigna.** Cuando un valor cae entre el mínimo y
  el límite de detección, se sustituye en silencio. El 10.2.1 pide identificar
  con bandera **todos** los datos tocados.
- **La bandera sustituye al valor en la misma columna**, así que el dato crudo
  desaparece del archivo validado. El 10.2.2 dice que no se borrará ningún dato.
- **El MIR solo mide contaminantes.** El 10.4.2 exige el 75% de compleción
  también en meteorología.
- **Precisión y sesgo** (10.4.1) no los cubre nada: salen de las calibraciones,
  no de los datos.
