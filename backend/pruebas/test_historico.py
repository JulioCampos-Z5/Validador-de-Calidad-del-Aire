"""
Histórico en SQLite.

Lo importante no es que SQLite guarde filas, sino que **un dato cambiado se
detecte y no se pise sin permiso**: al volver a cargar un periodo, lo nuevo
entra, lo cambiado se enseña con su antes y su después, y solo se escribe si
se pide; y cada cambio aplicado queda anotado.
"""

import os
import tempfile
import unittest
from contextlib import closing

import pandas as pd

from historico import almacen


def conjunto(o3_cen=0.030, filas_extra=()):
    filas = [
        {'STATION': 'CEN', 'DATE': '2025-01-01 00:00:00', 'HOUR': 0, 'O3': o3_cen, 'PM10': 'ND', 'SO2': 'SE'},
        {'STATION': 'CEN', 'DATE': '2025-01-01 00:00:00', 'HOUR': 1, 'O3': 0.020, 'PM10': 40.0, 'SO2': 'SE'},
        {'STATION': 'ATM', 'DATE': '2025-01-01 00:00:00', 'HOUR': 0, 'O3': 0.050, 'PM10': 60.0, 'SO2': ''},
        *filas_extra,
    ]
    return pd.DataFrame(filas)


class Historico(unittest.TestCase):
    def setUp(self):
        self.carpeta = tempfile.mkdtemp(prefix='prueba_historico_')
        self.ruta = os.path.join(self.carpeta, 'h.sqlite')

    def tearDown(self):
        for f in os.listdir(self.carpeta):
            os.remove(os.path.join(self.carpeta, f))
        os.rmdir(self.carpeta)

    def test_a_largo_descarta_sin_equipo_y_vacios(self):
        largo = almacen.a_largo(conjunto())
        self.assertNotIn('SE', set(largo['bandera'].dropna()))
        # 3 O3 + 3 PM10 (una con bandera ND); SO2 no aporta nada.
        self.assertEqual(len(largo), 6)
        nd = largo[(largo.parametro == 'PM10') & (largo.estacion == 'CEN') & (largo.hora == 0)]
        self.assertEqual(nd.iloc[0]['bandera'], 'ND')
        self.assertTrue(pd.isna(nd.iloc[0]['valor']))

    def test_primera_carga_todo_nuevo(self):
        with closing(almacen.conectar(self.ruta)) as con:
            r = almacen.analizar(con, conjunto(), 'archivo', 'a.xlsx')
            self.assertEqual((r['nuevos'], r['cambiados'], r['iguales']), (6, 0, 0))
            almacen.aplicar(con, r['id'])
            self.assertEqual(con.execute('SELECT COUNT(*) FROM mediciones').fetchone()[0], 6)

    def test_detecta_cambio_y_solo_lo_escribe_si_se_pide(self):
        with closing(almacen.conectar(self.ruta)) as con:
            almacen.aplicar(con, almacen.analizar(con, conjunto(), 'archivo', None)['id'])

            extra = [{'STATION': 'CEN', 'DATE': '2025-01-01', 'HOUR': 2, 'O3': 0.01, 'PM10': 30.0}]
            r = almacen.analizar(con, conjunto(o3_cen=0.045, filas_extra=extra), 'simaj', None)
            self.assertEqual((r['nuevos'], r['cambiados'], r['iguales']), (2, 1, 5))
            cambio = r['muestra'][0]
            self.assertEqual((cambio['antes'], cambio['ahora']), (0.030, 0.045))

            # Sin actualizar cambios: entra lo nuevo, el valor viejo se queda.
            almacen.aplicar(con, r['id'], actualizar_cambios=False)
            valor = con.execute("SELECT valor FROM mediciones WHERE estacion='CEN' "
                                "AND parametro='O3' AND hora=0").fetchone()[0]
            self.assertEqual(valor, 0.030)
            self.assertEqual(con.execute('SELECT COUNT(*) FROM mediciones').fetchone()[0], 8)

            # Actualizando: el valor cambia y el cambio queda anotado.
            r = almacen.analizar(con, conjunto(o3_cen=0.045), 'simaj', None)
            self.assertEqual(r['cambiados'], 1)
            hecho = almacen.aplicar(con, r['id'])
            valor = con.execute("SELECT valor FROM mediciones WHERE estacion='CEN' "
                                "AND parametro='O3' AND hora=0").fetchone()[0]
            self.assertEqual(valor, 0.045)
            anotados = almacen.cambios_de_carga(con, hecho['carga_id'])
            self.assertEqual(len(anotados), 1)
            self.assertEqual((anotados[0]['antes'], anotados[0]['ahora']), (0.030, 0.045))

    def test_bandera_nueva_cuenta_como_cambio(self):
        with closing(almacen.conectar(self.ruta)) as con:
            almacen.aplicar(con, almacen.analizar(con, conjunto(), 'archivo', None)['id'])
            df = conjunto()
            df['O3'] = df['O3'].astype(object)
            df.loc[1, 'O3'] = 'IR'
            r = almacen.analizar(con, df, 'archivo', None)
            self.assertEqual(r['cambiados'], 1)
            self.assertEqual(r['muestra'][0]['bandera_ahora'], 'IR')

    def test_analisis_se_aplica_una_sola_vez(self):
        with closing(almacen.conectar(self.ruta)) as con:
            r = almacen.analizar(con, conjunto(), 'archivo', None)
            almacen.aplicar(con, r['id'])
            with self.assertRaises(KeyError):
                almacen.aplicar(con, r['id'])

    def test_cargar_periodo_devuelve_lo_guardado(self):
        with closing(almacen.conectar(self.ruta)) as con:
            almacen.aplicar(con, almacen.analizar(con, conjunto(), 'archivo', None)['id'])
            df = almacen.cargar_periodo(con, '2025-01-01', '2025-01-02')
            self.assertEqual(list(df.columns), ['STATION', 'DATE', 'HOUR', 'O3', 'PM10'])
            self.assertEqual(len(df), 3)
            cen0 = df[(df.STATION == 'CEN') & (df.HOUR == 0)].iloc[0]
            self.assertEqual(cen0['O3'], 0.030)
            self.assertEqual(cen0['PM10'], 'ND')
            # `hasta` excluye: el día siguiente no tiene nada.
            self.assertTrue(almacen.cargar_periodo(con, '2025-01-02', '2025-01-03').empty)


if __name__ == '__main__':
    unittest.main()
