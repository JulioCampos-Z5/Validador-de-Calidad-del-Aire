"""
El último periodo consultado, para lo que se calcula sobre él después.

El MIR y su reporte no se recalculan en el navegador: se le piden al servidor,
que necesita las filas otra vez. Guardarlas evita volver a descargar un mes
entero solo porque se marcó o se desmarcó un contaminante.

Vive aquí y no dentro de `minutales/` porque los datos pueden venir de varios
sitios —SIMAJ, API de Emisiones, un archivo o la base local— y el indicador es
el mismo para todos. Mientras el almacén fue de uno de los módulos, el otro origen se quedaba
sin MIR: no porque no se pudiera calcular, sino porque no había dónde dejar las
filas.

Es estado global del proceso, igual que el resto del backend: sirve para un
usuario a la vez. Antes de ponerlo a servir a varias personas hay que aislarlo
por sesión, y esto entra en la misma lista que la sesión de Emisiones.
"""

from __future__ import annotations

import threading

import pandas as pd

_estado: dict = {'df': None, 'origen': None, 'validado': False}
_candado = threading.Lock()


def guardar(df: pd.DataFrame, origen: str, validado: bool = False) -> None:
    """
    Registra las filas sobre las que se calcula el MIR.

    `origen` es 'simaj', 'emisiones', 'archivo' o 'historico'. `validado` dice
    si ya pasaron por la validación (un BD importado o la base local), que
    cambia cómo se cuentan las lecturas: ver minutales/mir.py.
    """
    with _candado:
        _estado.update({'df': df, 'origen': origen, 'validado': validado})


def datos() -> pd.DataFrame | None:
    """Las filas del último periodo, o None si no se ha consultado ninguno."""
    return _estado['df']


def origen() -> str | None:
    """De dónde salieron esas filas, para poder decirlo en un reporte."""
    return _estado['origen']


def es_validado() -> bool:
    """Si esas filas ya venían validadas (banderas en lugar del valor)."""
    return _estado['validado']


def olvidar_mir() -> None:
    """Descarta las filas del MIR: lo cargado no da para calcularlo, y el
    reporte no debe salir con las del origen anterior."""
    with _candado:
        _estado.update({'df': None, 'origen': None, 'validado': False})


def olvidar() -> None:
    """Descarta lo guardado. Existe sobre todo para que las pruebas no se contaminen."""
    with _candado:
        _estado.update({'df': None, 'origen': None, 'validado': False})
        _validado.update({'df': None, 'origen': None, 'descripcion': None})


# El conjunto YA VALIDADO que se está mirando, venga de donde venga (archivo,
# SIMAJ o Emisiones). Es lo que se guarda en el histórico de la app de
# escritorio: se compara lo mismo que se ve en pantalla, con sus banderas.
_validado: dict = {'df': None, 'origen': None, 'descripcion': None}


def guardar_validado(df: pd.DataFrame, origen: str, descripcion: str | None = None) -> None:
    with _candado:
        _validado.update({'df': df, 'origen': origen, 'descripcion': descripcion})


def validado() -> tuple[pd.DataFrame | None, str | None, str | None]:
    """(filas validadas, origen, descripción) del último conjunto cargado."""
    return _validado['df'], _validado['origen'], _validado['descripcion']
