"""
Los endpoints del validador: lo que el frontend pide y lo que recibe.

Las piezas sueltas ya tienen pruebas (rangos, series, carga de ENVISTA). Esto
fija el contrato de la API, que es lo que se rompe al refactorizar sin darse
cuenta: un campo renombrado en la respuesta no falla en Python, falla en la
pantalla del area tecnica una semana despues.

Cada prueba desvia `UPLOAD_FOLDER` a una carpeta temporal. Sin eso, subir un
archivo en una prueba deja basura en el temporal del equipo y las validaciones
de una prueba pueden leer el archivo de otra.
"""

import io
import json
import os
import shutil
import tempfile
import unittest

import pandas as pd

import app


ENVISTA_CSV = [
    'Multiestacion Periodica:01-11-24 1:00 AM-30-11-24 12:00 AM Tipo:AVG 1 Hr.,,,',
    ',,,',
    ',Vallarta,Vallarta,Miravalle',
    'Fecha,O3,TempInt,PM10',
    ',ppm,C,ug/m3',
    '01-11-24 1:00 AM,0.009,25.5,45',
    '01-11-24 2:00 AM,0.010,26.0,48',
    '01-11-24 3:00 AM,0.011,26.5,52',
    '01-11-24 4:00 AM,0.012,27.0,49',
]


class ConCliente(unittest.TestCase):
    def setUp(self):
        self.carpeta = tempfile.mkdtemp(prefix='pruebas_api_')
        self.addCleanup(shutil.rmtree, self.carpeta, True)

        anterior = app.app.config['UPLOAD_FOLDER']
        app.app.config['UPLOAD_FOLDER'] = self.carpeta
        self.addCleanup(app.app.config.__setitem__, 'UPLOAD_FOLDER', anterior)

        app.app.config['TESTING'] = True
        self.cliente = app.app.test_client()

    def subir(self, nombre, lineas):
        """Dejar un archivo en la carpeta de subidas, como haria /api/upload."""
        ruta = os.path.join(self.carpeta, nombre)
        with open(ruta, 'w', encoding='utf-8', newline='') as f:
            f.write('\n'.join(lineas) + '\n')
        return nombre

    def validar(self, nombre, **cuerpo):
        cuerpo['filename'] = nombre
        return self.cliente.post('/api/validate/full', json=cuerpo)


class Salud(ConCliente):
    def test_responde_ok(self):
        """
        Lo que consulta la app de escritorio en bucle mientras arranca para
        saber cuando puede abrir la ventana.
        """
        r = self.cliente.get('/api/health')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()['status'], 'ok')

    def test_la_marca_de_tiempo_es_la_de_guadalajara(self):
        from datetime import datetime

        import horario

        marca = datetime.fromisoformat(self.cliente.get('/api/health').get_json()['timestamp'])
        self.assertLess(abs((marca - horario.ahora()).total_seconds()), 5)


class Configuracion(ConCliente):
    """
    El frontend dibuja los controles de validacion con lo que llega de aqui.
    Si falta una clave, la pantalla se queda sin esa opcion sin ningun error.
    """

    def test_lleva_todo_lo_que_dibuja_el_frontend(self):
        datos = self.cliente.get('/api/config').get_json()

        for clave in ('estaciones', 'parametros', 'rangos', 'banderas',
                      'decimales', 'series_temporales'):
            self.assertIn(clave, datos)

    def test_los_rangos_son_los_del_modulo_y_no_una_copia(self):
        """Dos listas de umbrales que se pueden separar es un error esperando."""
        datos = self.cliente.get('/api/config').get_json()

        self.assertEqual(datos['rangos']['PM10']['max'], app.RANGOS['PM10']['max'])
        self.assertEqual(set(datos['banderas']), set(app.BANDERAS))

    def test_las_tolerancias_por_defecto_estan_publicadas(self):
        series = self.cliente.get('/api/config').get_json()['series_temporales']

        self.assertEqual(series['nox']['tolerancia_default'], 0.15)
        self.assertEqual(series['pm']['tolerancia_default'], 0.15)
        self.assertIn('SO2', series['constantes']['excluye'])


class Subida(ConCliente):
    def test_sin_archivo_en_la_peticion(self):
        r = self.cliente.post('/api/upload', data={})
        self.assertEqual(r.status_code, 400)
        self.assertIn('error', r.get_json())

    def test_con_el_campo_vacio(self):
        r = self.cliente.post('/api/upload', data={'file': (io.BytesIO(b''), '')})
        self.assertEqual(r.status_code, 400)

    def test_una_extension_que_no_es(self):
        """
        El archivo se guarda en el disco del servidor: aceptar cualquier
        extension es aceptar cualquier cosa.
        """
        r = self.cliente.post('/api/upload',
                              data={'file': (io.BytesIO(b'x'), 'script.py')})
        self.assertEqual(r.status_code, 400)
        self.assertFalse(os.listdir(self.carpeta))

    def test_un_csv_se_guarda_con_marca_de_tiempo_delante(self):
        """
        Dos personas subiendo su Trs.csv el mismo dia se pisarian el archivo.
        La marca de tiempo delante del nombre es lo que lo evita.
        """
        r = self.cliente.post('/api/upload',
                              data={'file': (io.BytesIO(b'a,b\n1,2\n'), 'Trs.csv')})
        self.assertEqual(r.status_code, 200)

        nombre = r.get_json()['filename']
        self.assertTrue(nombre.endswith('_Trs.csv'), nombre)
        self.assertTrue(os.path.exists(os.path.join(self.carpeta, nombre)))

    def test_un_nombre_con_ruta_no_escapa_de_la_carpeta(self):
        """
        `secure_filename` aplana el nombre. Sin el, '../..' escribiria fuera
        de la carpeta de subidas.
        """
        r = self.cliente.post(
            '/api/upload',
            data={'file': (io.BytesIO(b'a,b\n1,2\n'), '../../../evil.csv')})
        self.assertEqual(r.status_code, 200)

        nombre = r.get_json()['filename']
        self.assertNotIn('..', nombre)
        self.assertNotIn('/', nombre)
        self.assertEqual(os.listdir(self.carpeta), [nombre])


class ValidacionCompleta(ConCliente):
    def test_sin_nombre_de_archivo(self):
        r = self.cliente.post('/api/validate/full', json={})
        self.assertEqual(r.status_code, 400)

    def test_un_archivo_que_no_esta(self):
        r = self.validar('no_existe.csv')
        self.assertEqual(r.status_code, 404)

    def test_un_csv_de_envista_de_punta_a_punta(self):
        nombre = self.subir('trs.csv', ENVISTA_CSV)
        r = self.validar(nombre)
        self.assertEqual(r.status_code, 200)
        datos = r.get_json()

        self.assertTrue(datos['success'])
        self.assertEqual(datos['file_format'], 'envista_raw')
        self.assertEqual(datos['summary']['estaciones'], 2)
        self.assertEqual(datos['summary']['total_registros'], 8)
        self.assertEqual(datos['summary']['fecha_inicio'], '2024-11-01')

    def test_el_excel_de_salida_queda_escrito_y_se_puede_descargar(self):
        nombre = self.subir('trs.csv', ENVISTA_CSV)
        salida = self.validar(nombre).get_json()['output_filename']

        self.assertTrue(salida.startswith('BD_2024_'), salida)
        self.assertTrue(os.path.exists(os.path.join(self.carpeta, salida)))

        descarga = self.cliente.get(f'/api/download/{salida}')
        self.assertEqual(descarga.status_code, 200)
        self.assertIn('attachment', descarga.headers['Content-Disposition'])

    def test_el_ano_del_nombre_sale_de_los_datos_y_no_del_reloj(self):
        """
        Un archivo de 2024 validado en 2026 tiene que llamarse BD_2024: el
        nombre es como se archiva despues.
        """
        nombre = self.subir('trs.csv', ENVISTA_CSV)
        salida = self.validar(nombre).get_json()['output_filename']
        self.assertIn('2024', salida)

    def test_la_vista_previa_trae_las_filas_sin_nulos_de_json(self):
        """
        `NaN` no existe en JSON. Si se cuela, el frontend recibe un cuerpo que
        `JSON.parse` rechaza y la pantalla se queda en blanco.
        """
        nombre = self.subir('trs.csv', ENVISTA_CSV)
        datos = self.validar(nombre).get_json()

        self.assertEqual(len(datos['data_preview']), 8)
        crudo = json.dumps(datos)
        self.assertNotIn('NaN', crudo)
        self.assertNotIn('Infinity', crudo)

    def test_la_configuracion_recibida_manda(self):
        """
        Apagar los rangos desde el frontend tiene que apagarlos de verdad: un
        valor fuera de rango sobrevive sin bandera.
        """
        nombre = self.subir('bd.csv', [
            'STATION,DATE,HOUR,PM10',
            'VAL,2024-11-01,1,5000',
        ])
        con_rangos = self.validar(nombre, config={'rangos': True}).get_json()
        self.assertEqual(con_rangos['data_preview'][0]['PM10'], 'IR')

        sin_rangos = self.validar(nombre, config={'rangos': False,
                                                  'marcar_huecos': False}).get_json()
        self.assertEqual(sin_rangos['data_preview'][0]['PM10'], 5000)

    def test_un_archivo_ya_validado_se_reconoce_como_tal(self):
        nombre = self.subir('bd.csv', [
            'STATION,DATE,HOUR,PM10',
            'VAL,2024-11-01,1,45',
        ])
        datos = self.validar(nombre).get_json()

        self.assertEqual(datos['file_format'], 'bd_procesado')
        self.assertTrue(datos['revalidated'])

    def test_se_puede_pedir_que_no_se_revalide(self):
        """
        Para abrir un archivo ya trabajado a mano sin que el validador le pase
        otra vez por encima y le borre las correcciones.
        """
        nombre = self.subir('bd.csv', [
            'STATION,DATE,HOUR,PM10',
            'VAL,2024-11-01,1,5000',
        ])
        datos = self.validar(nombre, revalidate=False).get_json()

        self.assertFalse(datos['revalidated'])
        self.assertEqual(datos['data_preview'][0]['PM10'], 5000)

    def test_un_archivo_procesado_sin_una_sola_fila(self):
        nombre = self.subir('vacio.csv', ['STATION,DATE,HOUR,PM10'])
        r = self.validar(nombre)

        self.assertEqual(r.status_code, 400)
        self.assertIn('error', r.get_json())

    def test_un_archivo_que_no_se_puede_leer_como_envista(self):
        nombre = self.subir('basura.csv', ['no,soy,un,archivo', 'de,envista,ni,nada'])
        r = self.validar(nombre)

        self.assertEqual(r.status_code, 400)
        self.assertIn('error', r.get_json())


class Descarga(ConCliente):
    def test_un_archivo_que_no_esta(self):
        r = self.cliente.get('/api/download/no_existe.xlsx')
        self.assertEqual(r.status_code, 404)


class VistaPreviaDeValidado(ConCliente):
    def test_sin_nombre_de_archivo(self):
        r = self.cliente.post('/api/preview-validated', json={})
        self.assertEqual(r.status_code, 400)

    def test_un_archivo_que_no_esta(self):
        r = self.cliente.post('/api/preview-validated', json={'filename': 'x.xlsx'})
        self.assertEqual(r.status_code, 404)

    def test_un_excel_sin_la_hoja_de_datos(self):
        ruta = os.path.join(self.carpeta, 'otro.xlsx')
        pd.DataFrame({'a': [1]}).to_excel(ruta, sheet_name='Hoja1', index=False)

        r = self.cliente.post('/api/preview-validated', json={'filename': 'otro.xlsx'})
        self.assertEqual(r.status_code, 400)

    def test_un_excel_validado_se_abre_sin_volver_a_validarlo(self):
        """
        La diferencia con /api/validate/full: aqui las banderas que ya trae el
        archivo se cuentan y se muestran, pero no se aplica ninguna regla
        nueva. Un valor fuera de rango sigue siendo el numero que era.
        """
        ruta = os.path.join(self.carpeta, 'BD_2024.xlsx')
        pd.DataFrame({
            'STATION': ['VAL', 'VAL'],
            'DATE': ['2024-11-01'] * 2,
            'HOUR': [1, 2],
            'PM10': [5000, 'IR'],
        }).to_excel(ruta, sheet_name='Data', index=False)

        r = self.cliente.post('/api/preview-validated', json={'filename': 'BD_2024.xlsx'})
        self.assertEqual(r.status_code, 200)
        datos = r.get_json()

        self.assertEqual(datos['summary']['total_registros'], 2)
        self.assertEqual(datos['summary']['estaciones'], 1)
        self.assertEqual(datos['data_preview'][0]['PM10'], 5000)
        self.assertEqual(datos['summary']['banderas']['Cantidad']['IR'], 1)


class AppDeEscritorio(ConCliente):
    """
    Quien entra por el navegador se lleva el ejecutable desde aqui. Se sirven
    solo dos nombres conocidos: aceptar el nombre que pida el cliente seria
    servir cualquier archivo del disco del servidor.
    """

    def setUp(self):
        super().setUp()
        anterior = app.CARPETA_SALIDA
        app.CARPETA_SALIDA = self.carpeta
        self.addCleanup(setattr, app, 'CARPETA_SALIDA', anterior)

    def test_sin_nada_compilado_se_dice_claramente(self):
        datos = self.cliente.get('/api/app-escritorio').get_json()

        self.assertFalse(datos['disponible'])
        self.assertEqual(datos['archivos'], [])

    def test_se_listan_solo_los_que_existen(self):
        with open(os.path.join(self.carpeta, 'Validador-portable.exe'), 'wb') as f:
            f.write(b'x' * 2048)

        datos = self.cliente.get('/api/app-escritorio').get_json()

        self.assertTrue(datos['disponible'])
        self.assertEqual([a['nombre'] for a in datos['archivos']],
                         ['Validador-portable.exe'])
        self.assertEqual(datos['archivos'][0]['url'],
                         '/api/app-escritorio/Validador-portable.exe')

    def test_un_nombre_de_fuera_no_se_sirve(self):
        """
        El archivo existe en la carpeta y aun asi no se entrega: la lista de
        nombres permitidos manda sobre lo que haya en el disco.
        """
        with open(os.path.join(self.carpeta, 'secretos.txt'), 'w') as f:
            f.write('nada')

        r = self.cliente.get('/api/app-escritorio/secretos.txt')
        self.assertEqual(r.status_code, 404)

    def test_un_nombre_permitido_pero_sin_compilar(self):
        r = self.cliente.get('/api/app-escritorio/Validador-portable.exe')
        self.assertEqual(r.status_code, 404)
        self.assertIn('compilada', r.get_json()['error'])

    def test_el_ejecutable_compilado_se_descarga(self):
        with open(os.path.join(self.carpeta, 'Validador-instalador.exe'), 'wb') as f:
            f.write(b'x' * 16)

        r = self.cliente.get('/api/app-escritorio/Validador-instalador.exe')
        self.assertEqual(r.status_code, 200)
        self.assertIn('attachment', r.headers['Content-Disposition'])


if __name__ == '__main__':
    unittest.main()
