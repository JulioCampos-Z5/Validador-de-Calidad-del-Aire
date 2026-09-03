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
"""

from __future__ import annotations

import pandas as pd

# Los seis contaminantes criterio de la NOM-172. El indicador es solo para
# estos: temperatura, viento y demás meteorología no se promedian aquí.
CONTAMINANTES_CRITERIO = ['O3', 'NO2', 'SO2', 'CO', 'PM10', 'PM2.5']

# Umbral de suficiencia. Por debajo de esto la serie no se considera
# representativa del periodo y no debería usarse para promedios oficiales.
UMBRAL_CUMPLE = 75.0


def _horas_esperadas(df_estacion: pd.DataFrame) -> int:
    """
    Horas que debería haber en el periodo, no las que hay en el archivo.

    Es la diferencia que hace que el indicador sirva. Si se cuenta sobre las
    filas presentes, una estación que dejó de publicar una semana entera sale
    con 100% de cobertura: no hay filas malas porque no hay filas. Contra el
    calendario, esa semana aparece como lo que es, un hueco.
    """
    fechas = pd.to_datetime(df_estacion['DATE'], errors='coerce')
    fechas = fechas.dropna()
    if fechas.empty:
        return 0
    dias = (fechas.max() - fechas.min()).days + 1
    return dias * 24


def calcular_mir(
    df: pd.DataFrame,
    contaminantes: list[str] | None = None,
    umbral: float = UMBRAL_CUMPLE,
) -> dict:
    """
    Calcula el MIR por estación y el resumen del periodo.

    `contaminantes` permite elegir cuáles entran en el promedio; por omisión los
    seis criterio. Devuelve un diccionario listo para serializar a JSON.
    """
    elegidos = [c for c in (contaminantes or CONTAMINANTES_CRITERIO) if c in df.columns]
    if not elegidos or df.empty:
        return {
            'contaminantes': elegidos,
            'umbral': umbral,
            'estaciones': [],
            'promedio_periodo': None,
            'estaciones_que_cumplen': 0,
            'total_estaciones': 0,
        }

    filas = []
    for estacion in sorted(df['STATION'].dropna().unique()):
        df_est = df[df['STATION'] == estacion]
        esperadas = _horas_esperadas(df_est)

        coberturas: dict[str, float | None] = {}
        for c in elegidos:
            validos = pd.to_numeric(df_est[c], errors='coerce').notna().sum()
            if esperadas == 0:
                coberturas[c] = None
            elif validos == 0:
                # Cero lecturas en todo el periodo se lee como "sin equipo" y
                # se deja fuera del promedio: es lo que hace la hoja del área
                # técnica al dejar la celda vacía.
                coberturas[c] = None
            else:
                coberturas[c] = round(min(100.0, 100.0 * validos / esperadas), 1)

        medidos = [v for v in coberturas.values() if v is not None]
        total = round(sum(medidos) / len(medidos)) if medidos else None

        filas.append({
            'estacion': estacion,
            'coberturas': coberturas,
            'sin_equipo': [c for c, v in coberturas.items() if v is None],
            'horas_esperadas': esperadas,
            'total': total,
            'cumple': (total is not None and total >= umbral),
        })

    totales = [f['total'] for f in filas if f['total'] is not None]
    return {
        'contaminantes': elegidos,
        'umbral': umbral,
        'estaciones': filas,
        'promedio_periodo': round(sum(totales) / len(totales)) if totales else None,
        'estaciones_que_cumplen': sum(1 for f in filas if f['cumple']),
        'total_estaciones': len(filas),
    }


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
            if cobertura is None:
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
