"""
Archivos guardados (/api/archivos) y precarga de lo que va del año
(/api/historico/precarga), ambos solo de la app de escritorio.

- Lo que se sube se copia una vez; el mismo contenido no se duplica y otro
  contenido con el mismo nombre queda como «nombre (2)».
- El visor solo atiende nombres que existen en la carpeta.
- La precarga sale de la base local al instante y, con sesión de Emisiones,
  arranca en segundo plano la descarga de lo que falta desde el último día.
"""

import io
import os
import shutil
import tempfile
import unittest
from unittest import mock

import pandas as pd

import app as aplicacion
import horario
import ultimo
from historico import rutas as rutas_historico


def excel_validado(o3=0.03) -> bytes:
    buf = io.BytesIO()
    pd.DataFrame({
        'STATION': ['CEN', 'CEN'], 'DATE': pd.to_datetime(['2026-01-01 01:00', '2026-01-01 02:00']),
        'HOUR': [1, 2], 'O3': [o3, 0.02],
    }).to_excel(buf, sheet_name='Data', index=False)
    return buf.getvalue()


class ConCarpetas(unittest.TestCase):
    def setUp(self):
        self.raiz = tempfile.mkdtemp(prefix='prueba_archivos_')
        self.entorno = {k: os.environ.get(k) for k in ('VALIDADOR_ARCHIVOS', 'VALIDADOR_HISTORICO')}
        os.environ['VALIDADOR_ARCHIVOS'] = os.path.join(self.raiz, 'archivos')
        os.environ['VALIDADOR_HISTORICO'] = os.path.join(self.raiz, 'historico.sqlite')
        self.cliente = aplicacion.app.test_client()
        ultimo.olvidar()

    def tearDown(self):
        ultimo.olvidar()
        for k, v in self.entorno.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.raiz, ignore_errors=True)

    def subir(self, contenido: bytes, nombre: str):
        return self.cliente.post('/api/upload', data={'file': (io.BytesIO(contenido), nombre)},
                                 content_type='multipart/form-data').get_json()


class Archivos(ConCarpetas):
    def test_lo_subido_se_guarda_sin_duplicar(self):
        self.assertEqual(self.subir(excel_validado(), 'BD_2026.xlsx')['guardado'], 'BD_2026.xlsx')
        self.assertEqual(self.subir(excel_validado(), 'BD_2026.xlsx')['guardado'], 'BD_2026.xlsx')
        self.assertEqual(self.subir(excel_validado(0.09), 'BD_2026.xlsx')['guardado'], 'BD_2026 (2).xlsx')
        self.subir(b'STATION,DATE,HOUR,O3\nCEN,2026-01-01,1,0.03\n', 'datos.csv')

        lista = self.cliente.get('/api/archivos').get_json()
        self.assertTrue(lista['disponible'])
        self.assertEqual(sorted(a['nombre'] for a in lista['archivos']),
                         ['BD_2026 (2).xlsx', 'BD_2026.xlsx', 'datos.csv'])
        tipos = {a['nombre']: a['tipo'] for a in lista['archivos']}
        self.assertEqual(tipos['BD_2026.xlsx'], 'validado')
        self.assertEqual(tipos['datos.csv'], 'validado')  # CSV con STATION y DATE

    def test_vista_previa_de_excel_y_csv(self):
        self.subir(excel_validado(), 'BD_2026.xlsx')
        v = self.cliente.get('/api/archivos/BD_2026.xlsx/vista').get_json()
        self.assertEqual(v['hoja'], 'Data')
        self.assertEqual(v['columnas'], ['STATION', 'DATE', 'HOUR', 'O3'])
        self.assertEqual(v['total'], 2)
        self.assertEqual(v['filas'][0][:3], ['CEN', '2026-01-01 01:00:00', 1])

        self.subir(b'a,b\n1,2\n3,4\n5,6\n', 'otro.csv')
        v = self.cliente.get('/api/archivos/otro.csv/vista?filas=2').get_json()
        self.assertEqual((v['columnas'], v['total'], len(v['filas'])), (['a', 'b'], 3, 2))

    def test_abrir_lo_deja_listo_para_el_validador(self):
        self.subir(excel_validado(), 'BD_2026.xlsx')
        r = self.cliente.post('/api/archivos/BD_2026.xlsx/abrir').get_json()
        self.assertEqual(r['tipo'], 'validado')
        datos = self.cliente.post('/api/preview-validated', json={'filename': r['filename']}).get_json()
        self.assertEqual(datos['summary']['total_registros'], 2)
        os.remove(os.path.join(aplicacion.app.config['UPLOAD_FOLDER'], r['filename']))

    def test_solo_nombres_guardados(self):
        secreto = os.path.join(self.raiz, 'secreto.csv')
        with open(secreto, 'w') as f:
            f.write('x')
        for ruta in ('/api/archivos/..%2Fsecreto.csv/vista', '/api/archivos/noexiste.xlsx/vista',
                     '/api/archivos/app.py/vista'):
            self.assertEqual(self.cliente.get(ruta).status_code, 404, ruta)
        self.assertEqual(self.cliente.delete('/api/archivos/..%2Fsecreto.csv').status_code, 404)
        self.assertTrue(os.path.exists(secreto))

    def test_borrar(self):
        self.subir(excel_validado(), 'BD_2026.xlsx')
        self.assertEqual(self.cliente.delete('/api/archivos/BD_2026.xlsx').get_json(), {'ok': True})
        self.assertEqual(self.cliente.get('/api/archivos').get_json()['archivos'], [])

    def test_archivo_ilegible(self):
        self.subir(b'esto no es excel', 'roto.xlsx')
        self.assertEqual(self.cliente.get('/api/archivos/roto.xlsx/vista').status_code, 422)

    def test_sin_escritorio_no_hay_archivos(self):
        os.environ.pop('VALIDADOR_ARCHIVOS')
        self.assertIsNone(self.subir(excel_validado(), 'BD_2026.xlsx')['guardado'])
        self.assertEqual(self.cliente.get('/api/archivos').get_json(), {'disponible': False, 'archivos': []})


class Precarga(ConCarpetas):
    def guardar_en_base(self, fechas):
        anio = horario.ahora().year
        df = pd.DataFrame([{'STATION': 'CEN', 'DATE': f'{anio}-{f}', 'HOUR': 0, 'O3': 0.03} for f in fechas])
        ultimo.guardar_validado(df, 'simaj', 'SIMAJ')
        a = self.cliente.post('/api/historico/analizar').get_json()
        self.cliente.post('/api/historico/aplicar', json={'id': a['id']})
        ultimo.olvidar()

    def test_base_vacia_sin_sesion(self):
        with mock.patch('emisiones.rutas._asegurar_sesion', return_value=False):
            r = self.cliente.post('/api/historico/precarga', json={}).get_json()
        self.assertTrue(r['vacio'])
        self.assertEqual(r['precarga']['motivo'], 'sin_sesion')
        self.assertFalse(r['precarga']['completando'])

    def test_lo_que_va_del_anio_de_la_base_local(self):
        self.guardar_en_base(['01-15', '02-01'])
        with mock.patch('emisiones.rutas._asegurar_sesion', return_value=False):
            r = self.cliente.post('/api/historico/precarga', json={'contaminantes': ['O3']}).get_json()
        anio = horario.ahora().year
        self.assertEqual(r['summary']['total_registros'], 2)
        self.assertEqual(r['precarga']['desde'], f'{anio}-01-01')
        self.assertEqual(r['mir']['contaminantes'], ['O3'])

    def test_con_sesion_completa_desde_el_ultimo_dia_guardado(self):
        self.guardar_en_base(['01-15', '02-01'])
        anio = horario.ahora().year
        with mock.patch('emisiones.rutas._asegurar_sesion', return_value=True), \
             mock.patch.dict('emisiones.rutas._sesion', {'token': 'tok'}), \
             mock.patch.object(rutas_historico, '_iniciar_descarga') as iniciar:
            r = self.cliente.post('/api/historico/precarga', json={}).get_json()
        self.assertTrue(r['precarga']['completando'])
        _ruta, token, desde, _hasta, _config = iniciar.call_args.args
        self.assertEqual((token, desde), ('tok', f'{anio}-02-01'))

    def test_no_completa_si_ya_hay_una_descarga_o_no_se_pide(self):
        with mock.patch.dict(rutas_historico._descarga, {'activo': True}), \
             mock.patch.object(rutas_historico, '_iniciar_descarga') as iniciar:
            r = self.cliente.post('/api/historico/precarga', json={}).get_json()
        self.assertTrue(r['precarga']['completando'])
        iniciar.assert_not_called()
        with mock.patch.object(rutas_historico, '_iniciar_descarga') as iniciar:
            self.cliente.post('/api/historico/precarga', json={'completar': False})
        iniciar.assert_not_called()

    def test_fuera_del_escritorio(self):
        os.environ.pop('VALIDADOR_HISTORICO')
        self.assertEqual(self.cliente.post('/api/historico/precarga', json={}).status_code, 404)


if __name__ == '__main__':
    unittest.main()
