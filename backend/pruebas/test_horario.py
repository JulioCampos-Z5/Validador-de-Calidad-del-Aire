"""
La hora del programa es la de Guadalajara, corra donde corra.

Esta prueba existe porque el fallo que evita no se ve donde se programa. En un
equipo de Jalisco `datetime.now()` ya da la hora buena y todo cuadra; el
contenedor arranca en UTC y ahí son seis horas de más, sin un solo aviso. Los
síntomas aparecen lejos de la causa: errores del registro fechados en el
futuro, tokens que se dan por caducados antes de tiempo, y consultas «hasta
ahora» que piden horas que la red todavía no ha publicado.

Por eso no se compara contra el reloj de la máquina —que en esta máquina daría
por buena cualquier cosa—, sino contra UTC, que es igual en todas partes.
"""

import unittest
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import horario


class HoraDeGuadalajara(unittest.TestCase):
    def test_ahora_es_la_hora_de_jalisco_no_la_de_la_maquina(self):
        """
        Se calcula el desplazamiento contra UTC: da igual en qué huso corra la
        prueba, la diferencia tiene que ser la de Guadalajara.
        """
        utc = datetime.now(timezone.utc)
        esperado = utc.astimezone(ZoneInfo('America/Mexico_City')).replace(tzinfo=None)

        diferencia = abs((horario.ahora() - esperado).total_seconds())
        self.assertLess(diferencia, 2, 'la hora no es la de Guadalajara')

    def test_la_hora_viene_sin_zona_pegada(self):
        """
        Todo el backend maneja fechas ingenuas —las de la API, las del SIMAJ,
        las guardadas en disco—. Una con zona reventaría la primera comparación
        con un TypeError.
        """
        self.assertIsNone(horario.ahora().tzinfo)
        # Y se puede comparar con una ingenua sin que salte nada.
        self.assertTrue(horario.ahora() > datetime(2020, 1, 1))

    def test_hoy_es_el_dia_de_aqui(self):
        """
        A partir de las 18:00 locales, UTC ya va por el día siguiente. Un
        `hoy()` equivocado hace que la caché guarde como cerrado un día que
        todavía está publicándose.
        """
        self.assertEqual(horario.hoy(), horario.ahora().date())

        utc = datetime.now(timezone.utc)
        esperado = utc.astimezone(ZoneInfo('America/Mexico_City')).date()
        self.assertEqual(horario.hoy(), esperado)

    def test_una_marca_de_unix_se_traduce_a_hora_local(self):
        """Es lo que hace falta para fechar las trazas de `logging`."""
        instante = datetime(2026, 9, 10, 18, 30, tzinfo=timezone.utc)
        traducida = horario.de_marca(instante.timestamp())

        esperada = instante.astimezone(ZoneInfo('America/Mexico_City'))
        self.assertEqual(traducida, esperada.replace(tzinfo=None))
        # En septiembre, Jalisco va seis horas por detrás de UTC.
        self.assertEqual(traducida, datetime(2026, 9, 10, 12, 30))

    def test_no_se_usa_un_menos_seis_a_mano(self):
        """
        Jalisco dejó el horario de verano en 2022, pero la conversión se hace
        con la base de datos de zonas y no con un número escrito a mano: si
        algún día vuelve a cambiar, esto sigue funcionando sin tocar nada.
        """
        self.assertEqual(horario.NOMBRE, 'America/Mexico_City')
        self.assertIsInstance(horario.ZONA, ZoneInfo)


class NadieLlamaAlRelojDeLaMaquina(unittest.TestCase):
    """
    Que los módulos usen `horario` y no `datetime.now()`.

    Sin esto, la corrección dura hasta la siguiente línea que alguien escriba
    por costumbre, y el error vuelve por donde vino.
    """

    MODULOS = [
        'app.py', 'registros.py',
        'emisiones/rutas.py', 'emisiones/cliente.py', 'emisiones/almacen.py',
        'minutales/rutas.py', 'minutales/cliente.py',
    ]

    def test_ningun_modulo_llama_a_datetime_now(self):
        import os

        raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        culpables = []
        for modulo in self.MODULOS:
            with open(os.path.join(raiz, modulo), encoding='utf-8') as f:
                for numero, linea in enumerate(f, 1):
                    if 'datetime.now()' in linea and not linea.lstrip().startswith('#'):
                        culpables.append(f'{modulo}:{numero}')

        self.assertEqual(
            culpables, [],
            'usa horario.ahora() en vez de datetime.now(): ' + ', '.join(culpables),
        )


if __name__ == '__main__':
    unittest.main()
