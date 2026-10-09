"""
Indicador MIR: representatividad de los datos por estación.

Qué mide
--------
NO mide contaminación, mide **cuánto dato hay**. Para cada estación se calcula
el porcentaje de horas con dato válido de cada contaminante criterio, se
promedian esos porcentajes y se compara el promedio contra el 75%.

La regla se dedujo de la hoja de cálculo del área técnica y se comprobó
reproduciendo sus 13 filas. Dos detalles que no son obvios y que cambian el
resultado:

1. **El promedio es simple, no ponderado.** Se promedian los porcentajes, no se
   suman horas válidas sobre horas totales. Una estación con muchísimas horas
   de O3 y poquísimas de CO pesa igual en ambos.

2. **Los contaminantes sin equipo se excluyen del promedio, no cuentan como 0.**
   En la hoja aparecen como celda vacía. Es la diferencia entre "aquí no hay
   instrumento" y "el instrumento no reportó", y confundirlas hunde el
   indicador de estaciones que están bien. Ejemplo comprobado: Santa Anita con
   100, 100, (sin equipo), 33, 99, 100 da 86 excluyendo el hueco; contándolo
   como cero daría 72 y la estación pasaría de cumplir a no cumplir.

Solo aplica a los seis contaminantes criterio. La meteorología no entra.

Los datos solos no distinguen «no hay equipo» de «hay equipo pero no dio ni
un dato»: los dos llegan como cero lecturas. Esa diferencia la sabe el usuario,
y la marca con `como_cero`: las celdas donde el equipo SÍ está instalado pero
no reportó o no funciona. Esas entran al promedio con 0, dejan de contarse como
sin equipo, pasan al diagnóstico como equipo caído y quedan listadas en
`como_cero` de su estación, para que la pantalla y el reporte lo digan.
"""

from __future__ import annotations

import pandas as pd

# Los seis contaminantes criterio de la NOM-172. El indicador es solo para
# estos: temperatura, viento y demás meteorología no se promedian aquí.
CONTAMINANTES_CRITERIO = ['O3', 'NO2', 'SO2', 'CO', 'PM10', 'PM2.5']

# Umbral de suficiencia. Por debajo de esto la serie no se considera
# representativa del periodo y no debería usarse para promedios oficiales.
UMBRAL_CUMPLE = 75.0

# Banderas que solo se ponen sobre una lectura que existió. Un archivo ya
# validado (o la base local) no trae el crudo: la validación cambió el número
# por su bandera. Para que el MIR mida lo mismo que con el SIMAJ —cuánto
# publicó la red, no cuánto pasó las reglas— esas celdas cuentan como lectura.
# No cuentan ND/SE/NE (no hubo dato, equipo ni estación), ni IF/IC: con el
# equipo en falla o calibrando no se estaba midiendo el aire.
BANDERAS_CON_LECTURA = {'IR', 'IO', 'DS', 'VE', 'VZ'}


def _lecturas(serie: pd.Series, validado: bool) -> int:
    """Cuántas horas de la serie traen una lectura del equipo."""
    numericas = pd.to_numeric(serie, errors='coerce').notna()
    if validado:
        numericas |= serie.astype(str).str.strip().isin(BANDERAS_CON_LECTURA)
    return int(numericas.sum())


def _tramo(df: pd.DataFrame) -> tuple[str | None, str | None]:
    """Primer y último día (AAAA-MM-DD) con filas, o (None, None)."""
    fechas = pd.to_datetime(df['DATE'], errors='coerce').dropna()
    if fechas.empty:
        return None, None
    return fechas.min().strftime('%Y-%m-%d'), fechas.max().strftime('%Y-%m-%d')


def _horas_esperadas(desde: str | None, hasta: str | None) -> int:
    """
    Horas que debería haber en el periodo, no las que hay en el archivo.

    Es la diferencia que hace que el indicador sirva. Si se cuenta sobre las
    filas presentes, una estación que dejó de publicar una semana entera sale
    con 100% de cobertura: no hay filas malas porque no hay filas. Contra el
    calendario, esa semana aparece como lo que es, un hueco.
    """
    if desde is None or hasta is None:
        return 0
    dias = (pd.Timestamp(hasta) - pd.Timestamp(desde)).days + 1
    return dias * 24


def calcular_mir(
    df: pd.DataFrame,
    contaminantes: list[str] | None = None,
    umbral: float = UMBRAL_CUMPLE,
    como_cero: set[tuple[str, str]] | None = None,
    validado: bool = False,
) -> dict:
    """
    Calcula el MIR por estación y el resumen del periodo.

    `contaminantes` permite elegir cuáles entran en el promedio; por omisión los
    seis criterio. `como_cero` son pares (estación, contaminante) sin lecturas
    donde sí hay equipo: se cuentan como 0 en vez de excluirse. `validado` es
    para filas que ya pasaron por la validación (archivo BD o base local): ver
    BANDERAS_CON_LECTURA. Devuelve un diccionario listo para serializar a JSON.
    """
    como_cero = como_cero or set()
    elegidos = [c for c in (contaminantes or CONTAMINANTES_CRITERIO) if c in df.columns]
    # El tramo que se compara, para decirlo en pantalla y en el reporte: sin
    # fechas, un 76% no se sabe de qué periodo es.
    desde, hasta = _tramo(df) if not df.empty else (None, None)
    if not elegidos or df.empty:
        return {
            'contaminantes': elegidos,
            'umbral': umbral,
            'desde': desde,
            'hasta': hasta,
            'estaciones': [],
            'promedio_periodo': None,
            'estaciones_que_cumplen': 0,
            'total_estaciones': 0,
        }

    filas = []
    for estacion in sorted(df['STATION'].dropna().unique()):
        df_est = df[df['STATION'] == estacion]
        # Cada estación se mide contra su propio primer y último día: es la
        # regla de siempre, y por eso su tramo va en la fila.
        est_desde, est_hasta = _tramo(df_est)
        esperadas = _horas_esperadas(est_desde, est_hasta)

        coberturas: dict[str, float | None] = {}
        for c in elegidos:
            validos = _lecturas(df_est[c], validado)
            if esperadas == 0:
                coberturas[c] = None
            elif validos == 0:
                # Cero lecturas en todo el periodo se lee como "sin equipo" y
                # se deja fuera del promedio: es lo que hace la hoja del área
                # técnica al dejar la celda vacía.
                coberturas[c] = None
            else:
                coberturas[c] = round(min(100.0, 100.0 * validos / esperadas), 1)

        sin_lecturas = [c for c, v in coberturas.items() if v is None]
        # Solo se puede marcar lo que de verdad no tiene lecturas: un canal con
        # datos se queda con su cobertura aunque llegue en la lista.
        forzados = [c for c in sin_lecturas if (estacion, c) in como_cero and esperadas > 0]
        for c in forzados:
            coberturas[c] = 0.0
        # Lo marcado tiene equipo: ya no es «sin equipo».
        sin_equipo = [c for c in sin_lecturas if c not in forzados]

        medidos = [v for v in coberturas.values() if v is not None]
        total = round(sum(medidos) / len(medidos)) if medidos else None

        filas.append({
            'estacion': estacion,
            'coberturas': coberturas,
            'sin_equipo': sin_equipo,
            'como_cero': forzados,
            'desde': est_desde,
            'hasta': est_hasta,
            'horas_esperadas': esperadas,
            'total': total,
            'cumple': (total is not None and total >= umbral),
        })

    totales = [f['total'] for f in filas if f['total'] is not None]
    return {
        'contaminantes': elegidos,
        'umbral': umbral,
        'desde': desde,
        'hasta': hasta,
        'estaciones': filas,
        'promedio_periodo': round(sum(totales) / len(totales)) if totales else None,
        'estaciones_que_cumplen': sum(1 for f in filas if f['cumple']),
        'total_estaciones': len(filas),
    }


def leer_como_cero(valor) -> set[tuple[str, str]]:
    """
    Las celdas a contar como 0, tal como llegan de la petición.

    Acepta una lista `["ATM:PM10", ...]` (cuerpo JSON) o un texto separado por
    comas (parámetro de la URL). Lo que no tenga la forma estación:contaminante
    se ignora en silencio: viene del cliente y no debe tumbar el cálculo.
    """
    if isinstance(valor, str):
        valor = valor.split(',')
    if not isinstance(valor, list):
        return set()
    pares = set()
    for item in valor:
        if not isinstance(item, str) or item.count(':') != 1:
            continue
        estacion, contaminante = (x.strip() for x in item.split(':'))
        if estacion and contaminante in CONTAMINANTES_CRITERIO:
            pares.add((estacion, contaminante))
    return pares


def diagnostico_fallas(mir: dict) -> list[dict]:
    """
    Dice DÓNDE está fallando cada estación, no solo que falla.

    El indicador por sí solo dice "Vallarta 60, no cumple", que no le sirve a
    quien tiene que ir a arreglarlo. Esto señala el canal concreto y distingue
    tres situaciones que se atienden distinto:

      · sin_equipo  → no hay instrumento; es una decisión, no una avería.
      · caido       → hay instrumento pero no reporta casi nada (<25%).
      · intermitente→ reporta a ratos (25-75%); suele ser el caso más caro de
                      diagnosticar y el que más conviene sacar a la luz.
    """
    hallazgos = []
    for fila in mir['estaciones']:
        for contaminante, cobertura in fila['coberturas'].items():
            if contaminante in fila.get('como_cero', []):
                # El usuario sabe que ahí hay equipo: sin una sola lectura, es
                # un equipo caído, no una estación que no lo tiene.
                tipo, detalle = 'caido', 'Hay equipo, pero no dio datos en el periodo'
            elif cobertura is None:
                tipo, detalle = 'sin_equipo', 'Sin lecturas en todo el periodo'
            elif cobertura < 25:
                tipo, detalle = 'caido', f'Solo {cobertura}% de las horas'
            elif cobertura < mir['umbral']:
                tipo, detalle = 'intermitente', f'{cobertura}%, por debajo del {mir["umbral"]:.0f}%'
            else:
                continue

            hallazgos.append({
                'estacion': fila['estacion'],
                'contaminante': contaminante,
                'tipo': tipo,
                'cobertura': cobertura,
                'detalle': detalle,
                'hunde_a_la_estacion': not fila['cumple'],
            })

    # Primero lo que tumba a una estación entera, y dentro de eso lo más caído.
    orden = {'caido': 0, 'intermitente': 1, 'sin_equipo': 2}
    hallazgos.sort(key=lambda h: (
        not h['hunde_a_la_estacion'],
        orden[h['tipo']],
        h['cobertura'] if h['cobertura'] is not None else 999,
    ))
    return hallazgos
