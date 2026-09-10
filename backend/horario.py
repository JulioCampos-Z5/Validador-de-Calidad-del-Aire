"""
La hora del programa es la de Guadalajara, corra donde corra.

Por qué no vale `datetime.now()` a secas
----------------------------------------
`now()` da la hora del reloj de la máquina. En el equipo de quien desarrolla
eso ya es Guadalajara y todo cuadra; en un contenedor —que arranca en UTC— son
seis horas de más, y nada avisa. Los síntomas son de los que se achacan a otra
cosa:

  · un error del registro con hora futura, que no casa con lo que la persona
    estaba haciendo cuando ocurrió;
  · un token que la interfaz da por caducado seis horas antes de tiempo;
  · consultas «hasta ahora» que piden horas que la red todavía no ha publicado
    y vuelven vacías.

Y encima solo pasa en el servidor, que es donde peor se depura.

Por qué la hora va sin zona pegada
----------------------------------
Todo el backend maneja fechas ingenuas: las que vienen de la API de Emisiones,
las del SIMAJ y las que se guardan en disco. Devolver aquí una fecha con zona
haría que la primera comparación con cualquiera de ellas reventara con un
TypeError. Así que se convierte a Guadalajara y se le quita la zona: el valor
es correcto y sigue siendo comparable con el resto.

La red de monitoreo publica en hora local sin desplazamiento, de modo que esta
es además la hora en la que están fechados los datos.

Jalisco no aplica horario de verano desde 2022, así que la conversión no tiene
saltos; se usa `zoneinfo` de todos modos y no un `-6` a mano, porque quien
escribe el `-6` es quien luego no se acuerda de revisarlo.
"""

from __future__ import annotations

from datetime import datetime, date
from zoneinfo import ZoneInfo

# Guadalajara comparte zona con la Ciudad de México; es el identificador que
# existe en la base de datos de zonas horarias.
ZONA = ZoneInfo('America/Mexico_City')

NOMBRE = 'America/Mexico_City'


def ahora() -> datetime:
    """La hora de Guadalajara, ingenua, para usar en lugar de `datetime.now()`."""
    return datetime.now(ZONA).replace(tzinfo=None)


def hoy() -> date:
    """El día de hoy en Guadalajara, que a partir de las 18:00 no es el de UTC."""
    return ahora().date()


def de_marca(segundos: float) -> datetime:
    """
    Convierte una marca de tiempo de Unix a hora de Guadalajara.

    Hace falta para las trazas del registro: `logging` guarda el instante como
    segundos desde 1970, y `fromtimestamp` sin zona lo traduce con el reloj de
    la máquina, que es justo lo que este módulo existe para evitar.
    """
    return datetime.fromtimestamp(segundos, ZONA).replace(tzinfo=None)
