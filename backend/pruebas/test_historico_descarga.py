"""
Descarga de la API de Emisiones a la base local, y cambios pendientes.

Lo que se protege: la descarga va mes a mes y **nunca pisa un dato guardado**
(lo que cambió queda en `pendientes` hasta que alguien lo revise), y cada mes
se guarda antes de pedir el siguiente.
"""

import os
import tempfile
import time
import unittest
from contextlib import closing
from unittest import mock

import pandas as pd

from historico import almacen


def mes(anio, m, o3=0.03, estaciones=('CEN', 'ATM')):
    horas = pd.date_range(f'{anio}-{m:02d}-01', periods=48, freq='h')
    return pd.DataFrame([
        {'STATION': e, 'DATE': h.strftime('%Y-%m-%d'), 'HOUR': h.hour, 'O3': o3, 'PM10': 40.0}
        for e in estaciones for h in horas
    ])


class Carpeta(unittest.TestCase):
    def setUp(self):
        self.carpeta = tempfile.mkdtemp(prefix='prueba_descarga_')
        self.ruta = os.path.join(self.carpeta, 'h.sqlite')

    def tearDown(self):
        for f in os.listdir(self.carpeta):
            os.remove(os.path.join(self.carpeta, f))
        os.rmdir(self.carpeta)


class Almacen(Carpeta):
    def test_meses(self):
        self.assertEqual(almacen.meses('2024-01-15', '2024-03-10'),
                         [('2024-01-15', '2024-02-01'), ('2024-02-01', '2024-03-01'),
                          ('2024-03-01', '2024-03-10')])

    def test_acotar_no_baja_de_2024(self):
        self.assertEqual(almacen.acotar('2020-05-01', '2024-02-01')[0], '2024-01-01')

    def test_no_guarda_antes_de_2024(self):
        with closing(almacen.conectar(self.ruta)) as con:
            r = almacen.guardar_sin_revisar(con, mes(2023, 12), 'x', 'x')
            self.assertEqual(r['nuevos'], 0)

    def test_sin_revisar_manda_cambios_a_pendientes(self):
        with closing(almacen.conectar(self.ruta)) as con:
            r = almacen.guardar_sin_revisar(con, mes(2024, 1), 'emisiones', 'ene')
            self.assertEqual((r['nuevos'], r['pendientes']), (192, 0))

            r = almacen.guardar_sin_revisar(con, mes(2024, 1, o3=0.05), 'emisiones', 'ene')
            self.assertEqual((r['nuevos'], r['pendientes']), (0, 96))
            # Lo guardado no se tocó.
            self.assertEqual(con.execute("SELECT MAX(valor) FROM mediciones WHERE parametro='O3'")
                             .fetchone()[0], 0.03)

            p = almacen.pendientes(con)
            self.assertEqual(p['total'], 96)
            self.assertEqual((p['muestra'][0]['antes'], p['muestra'][0]['ahora']), (0.03, 0.05))

            self.assertEqual(almacen.aplicar_pendientes(con)['actualizados'], 96)
            self.assertEqual(con.execute("SELECT MIN(valor) FROM mediciones WHERE parametro='O3'")
                             .fetchone()[0], 0.05)
            self.assertEqual(almacen.pendientes(con)['total'], 0)
            self.assertEqual(con.execute('SELECT COUNT(*) FROM cambios').fetchone()[0], 96)

    def test_descartar_pendientes(self):
        with closing(almacen.conectar(self.ruta)) as con:
            almacen.guardar_sin_revisar(con, mes(2024, 1), 'e', 'e')
            almacen.guardar_sin_revisar(con, mes(2024, 1, o3=0.05), 'e', 'e')
            self.assertEqual(almacen.descartar_pendientes(con), 96)
            self.assertEqual(con.execute("SELECT MAX(valor) FROM mediciones WHERE parametro='O3'")
                             .fetchone()[0], 0.03)


class Migracion(Carpeta):
    def test_base_vieja_se_reordena_sin_perder_datos(self):
        import sqlite3
        con = sqlite3.connect(self.ruta)
        con.executescript("""
            CREATE TABLE mediciones (estacion TEXT NOT NULL, parametro TEXT NOT NULL,
              fecha TEXT NOT NULL, hora INTEGER NOT NULL, valor REAL, bandera TEXT,
              origen TEXT, actualizado TEXT NOT NULL,
              PRIMARY KEY (estacion, parametro, fecha, hora)) WITHOUT ROWID;
            INSERT INTO mediciones VALUES ('CEN','O3','2024-02-01',3,0.02,NULL,'x','t'),
                                          ('ATM','O3','2024-01-01',1,NULL,'IR','x','t');
        """)
        con.commit()
        con.close()
        with closing(almacen.conectar(self.ruta)) as con:
            clave = [c[1] for c in sorted(con.execute('PRAGMA table_info(mediciones)'),
                                          key=lambda c: c[5]) if c[5]]
            self.assertEqual(clave, ['fecha', 'hora', 'estacion', 'parametro'])
            self.assertEqual(con.execute('SELECT COUNT(*) FROM mediciones').fetchone()[0], 2)
            df = almacen.cargar_periodo(con, '2024-01-01', '2024-03-01')
            self.assertEqual(df.iloc[0]['O3'], 'IR')


class RutaDescarga(Carpeta):
    def setUp(self):
        super().setUp()
        os.environ['VALIDADOR_HISTORICO'] = self.ruta
        import app as modulo
        from emisiones import rutas as rutas_emisiones
        self.cliente_http = modulo.app.test_client()
        self.sesion = mock.patch.dict(rutas_emisiones._sesion, {'token': 't', 'caduca': None})
        self.sesion.start()

    def tearDown(self):
        self.sesion.stop()
        del os.environ['VALIDADOR_HISTORICO']
        super().tearDown()

    def esperar(self):
        for _ in range(200):
            estado = self.cliente_http.get('/api/historico/descargar').get_json()
            if not estado['activo']:
                return estado
            time.sleep(0.05)
        self.fail('La descarga no terminó')

    def test_descarga_mes_a_mes_y_sigue_si_un_mes_falla(self):
        pedidos = []

        def falsa(token, desde, hasta, carpeta_cache=None):
            pedidos.append(desde.strftime('%Y-%m'))
            if desde.month == 2:
                raise RuntimeError('corte de red')
            return mes(desde.year, desde.month)

        with mock.patch('emisiones.cliente.descargar', side_effect=falsa):
            r = self.cliente_http.post('/api/historico/descargar',
                                       json={'desde': '2024-01-01', 'hasta': '2024-04-01'})
            self.assertEqual(r.status_code, 200)
            estado = self.esperar()

        self.assertEqual(pedidos, ['2024-01', '2024-02', '2024-03'])
        self.assertEqual([f['mes'] for f in estado['fallidos']], ['2024-02'])
        self.assertGreater(estado['nuevos'], 0)
        with closing(almacen.conectar(self.ruta)) as con:
            meses_guardados = [r[0] for r in con.execute(
                "SELECT DISTINCT substr(fecha,1,7) FROM mediciones ORDER BY 1")]
        self.assertEqual(meses_guardados, ['2024-01', '2024-03'])



class ImportarArchivo(Carpeta):
    """Importar un CSV o Excel en la app de escritorio lo deja en la base local."""

    def setUp(self):
        super().setUp()
        import app as modulo
        self.app = modulo
        self.cliente_http = modulo.app.test_client()
        self.subidas = tempfile.mkdtemp(prefix='prueba_subidas_')
        anterior = modulo.app.config['UPLOAD_FOLDER']
        modulo.app.config['UPLOAD_FOLDER'] = self.subidas
        self.addCleanup(modulo.app.config.__setitem__, 'UPLOAD_FOLDER', anterior)

    def tearDown(self):
        os.environ.pop('VALIDADOR_HISTORICO', None)
        for f in os.listdir(self.subidas):
            os.remove(os.path.join(self.subidas, f))
        os.rmdir(self.subidas)
        super().tearDown()

    def importar(self, df, nombre='datos.csv'):
        df.to_csv(os.path.join(self.subidas, nombre), index=False)
        return self.cliente_http.post('/api/validate/full', json={'filename': nombre}).get_json()

    def test_csv_importado_se_guarda_y_un_cambio_queda_pendiente(self):
        # Valores que varían: uno constante lo marca la validación y se
        # guardaría como bandera en los dos archivos.
        def variado(escala):
            df = mes(2024, 5)
            df['O3'] = [round(escala * (0.01 + 0.001 * (i % 24)), 4) for i in range(len(df))]
            df['PM10'] = [20.0 + (i % 24) for i in range(len(df))]
            return df

        os.environ['VALIDADOR_HISTORICO'] = self.ruta
        r = self.importar(variado(1))
        self.assertGreater(r['historico']['nuevos'], 0)
        self.assertEqual(r['historico']['pendientes'], 0)

        r = self.importar(variado(2), 'corregido.csv')
        self.assertEqual(r['historico']['nuevos'], 0)
        self.assertEqual(r['historico']['pendientes'], 96)
        with closing(almacen.conectar(self.ruta)) as con:
            self.assertEqual(almacen.pendientes(con)['total'], 96)

    def test_fuera_del_escritorio_no_se_guarda(self):
        r = self.importar(mes(2024, 5))
        self.assertIsNone(r['historico'])
        self.assertFalse(os.path.exists(self.ruta))


if __name__ == '__main__':
    unittest.main()
