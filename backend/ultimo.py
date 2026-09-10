"""
El último periodo consultado, para lo que se calcula sobre él después.

El MIR y su reporte no se recalculan en el navegador: se le piden al servidor,
que necesita las filas otra vez. Guardarlas evita volver a descargar un mes
entero solo porque se marcó o se desmarcó un contaminante.

Vive aquí y no dentro de `minutales/` porque los datos pueden venir de dos
sitios —del SIMAJ o de la API de Emisiones— y el indicador es el mismo para los
dos. Mientras el almacén fue de uno de los módulos, el otro origen se quedaba
sin MIR: no porque no se pudiera calcular, sino porque no había dónde dejar las
filas.

Es estado global del proceso, igual que el resto del backend: sirve para un
usuario a la vez. Antes de ponerlo a servir a varias personas hay que aislarlo
por sesión, y esto entra en la misma lista que la sesión de Emisiones.
"""

from __future__ import annotations

import threading

import pandas as pd

_estado: dict = {'df': None, 'origen': None}
_candado = threading.Lock()


def guardar(df: pd.DataFrame, origen: str) -> None:
    """Registra el conjunto recién consultado. `origen` es 'simaj' o 'emisiones'."""
    with _candado:
        _estado['df'] = df
        _estado['origen'] = origen


def datos() -> pd.DataFrame | None:
    """Las filas del último periodo, o None si no se ha consultado ninguno."""
    return _estado['df']


def origen() -> str | None:
    """De dónde salieron esas filas, para poder decirlo en un reporte."""
    return _estado['origen']


def olvidar() -> None:
    """Descarta lo guardado. Existe sobre todo para que las pruebas no se contaminen."""
    with _candado:
        _estado.update({'df': None, 'origen': None})
