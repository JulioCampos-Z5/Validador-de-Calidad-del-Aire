"""
Seguridad de las rutas que tocan archivos, y de CORS.

Cada prueba es un ataque concreto contra el backend, hecho con el cliente de
pruebas de Flask: no abre puertos ni toca la red.

Por qué importa aunque la app corra en 127.0.0.1
------------------------------------------------
Escuchar solo en local no protege del navegador: cualquier página que el
usuario tenga abierta puede mandar peticiones a http://127.0.0.1:8000. Con CORS
abierto a todos los orígenes, además puede *leer* las respuestas. Y en Docker el
backend sí está expuesto a la red.

Los ataques
-----------
- Salirse de la carpeta de subidas con `..` o con una ruta absoluta en el
  nombre de archivo, para leer o descargar cualquier archivo del disco. En
  Windows `\\` también separa carpetas, y el conversor `<filename>` de Flask
  solo filtra `/`.
- Lo mismo contra la ruta que sirve el frontend compilado.
- Leer las respuestas de la API desde otro sitio web (CORS).
"""

import io
import os
import shutil
import tempfile
import unittest

import app as modulo_app


class BaseSeguridad(unittest.TestCase):
    def setUp(self):
        self.cliente = modulo_app.app.test_client()
        self.subidas = modulo_app.app.config['UPLOAD_FOLDER']

        # Un «secreto» fuera de la carpeta de subidas: lo que un atacante
        # querría leer.
        self.fuera = tempfile.mkdtemp(prefix='pruebas_seguridad_')
        self.secreto = os.path.join(self.fuera, 'secreto.xlsx')
        with open(self.secreto, 'wb') as f:
            f.write(b'CONTENIDO-SECRETO')

        # El mismo secreto alcanzado desde la carpeta de subidas con `..`.
        self.relativa = os.path.relpath(self.secreto, self.subidas)

    def tearDown(self):
        shutil.rmtree(self.fuera, ignore_errors=True)

    def assertNoFiltra(self, respuesta):
        self.assertNotIn(b'CONTENIDO-SECRETO', respuesta.data)
        self.assertIn(respuesta.status_code, (400, 404),
                      f'Respondió {respuesta.status_code}: {respuesta.data[:200]!r}')


class NombresDeArchivoEnElCuerpo(BaseSeguridad):
    """`/api/validate/full` y `/api/preview-validated` reciben el nombre en JSON."""

    RUTAS = ('/api/validate/full', '/api/preview-validated')

    def test_ruta_absoluta(self):
        # os.path.join descarta la carpeta base si el segundo argumento es
        # absoluto: sin validar, esto abre el archivo que diga el cliente.
        for ruta in self.RUTAS:
            with self.subTest(ruta=ruta):
                r = self.cliente.post(ruta, json={'filename': self.secreto})
                self.assertNoFiltra(r)

    def test_subir_carpetas_con_puntos(self):
        for ruta in self.RUTAS:
            for nombre in (self.relativa, self.relativa.replace(os.sep, '/')):
                with self.subTest(ruta=ruta, nombre=nombre):
                    r = self.cliente.post(ruta, json={'filename': nombre})
                    self.assertNoFiltra(r)

    def test_nombre_que_no_es_texto(self):
        for ruta in self.RUTAS:
            with self.subTest(ruta=ruta):
                r = self.cliente.post(ruta, json={'filename': ['a', 'b']})
                self.assertEqual(r.status_code, 400)


class DescargaDeResultados(BaseSeguridad):
    def test_ruta_absoluta_en_la_url(self):
        r = self.cliente.get('/api/download/' + self.secreto)
        self.assertNoFiltra(r)

    def test_barra_invertida_de_windows(self):
        # `<filename>` rechaza «/», pero no «\\»: en Windows es un separador.
        nombre = self.relativa.replace('/', '\\')
        r = self.cliente.get('/api/download/' + nombre.replace('\\', '%5C'))
        self.assertNoFiltra(r)

    def test_un_resultado_legitimo_se_descarga(self):
        nombre = 'BD_2026_prueba_seguridad.xlsx'
        ruta = os.path.join(self.subidas, nombre)
        with open(ruta, 'wb') as f:
            f.write(b'resultado')
        try:
            r = self.cliente.get('/api/download/' + nombre)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.data, b'resultado')
            r.close()
        finally:
            os.remove(ruta)


class FrontendCompilado(BaseSeguridad):
    def setUp(self):
        super().setUp()
        self.dist_original = modulo_app.FRONTEND_DIST
        self.dist = tempfile.mkdtemp(prefix='pruebas_dist_')
        with open(os.path.join(self.dist, 'index.html'), 'w', encoding='utf-8') as f:
            f.write('<html>indice</html>')
        modulo_app.FRONTEND_DIST = self.dist

    def tearDown(self):
        modulo_app.FRONTEND_DIST = self.dist_original
        shutil.rmtree(self.dist, ignore_errors=True)
        super().tearDown()

    def test_no_sale_de_la_carpeta_del_frontend(self):
        relativa = os.path.relpath(self.secreto, self.dist).replace(os.sep, '/')
        for url in ('/' + relativa,
                    '/' + relativa.replace('../', '..%2F'),
                    '/' + relativa.replace('/', '%5C')):
            with self.subTest(url=url):
                r = self.cliente.get(url)
                self.assertNotIn(b'CONTENIDO-SECRETO', r.data)
                r.close()

    def test_una_ruta_del_cliente_devuelve_el_indice(self):
        r = self.cliente.get('/minutales')
        self.assertEqual(r.status_code, 200)
        self.assertIn(b'indice', r.data)
        r.close()


class Subidas(BaseSeguridad):
    def test_el_nombre_no_puede_salir_de_la_carpeta(self):
        r = self.cliente.post('/api/upload', data={
            'file': (io.BytesIO(b'a,b\n1,2\n'), '../../../fuera.csv'),
        }, content_type='multipart/form-data')
        self.assertEqual(r.status_code, 200)
        guardado = r.get_json()['filepath']
        try:
            self.assertEqual(os.path.dirname(os.path.abspath(guardado)),
                             os.path.abspath(self.subidas))
        finally:
            os.remove(guardado)

    def test_extension_no_permitida(self):
        r = self.cliente.post('/api/upload', data={
            'file': (io.BytesIO(b'MZ'), 'programa.exe'),
        }, content_type='multipart/form-data')
        self.assertEqual(r.status_code, 400)


class Cors(unittest.TestCase):
    """Otro sitio web no debe poder leer las respuestas de la API."""

    def setUp(self):
        self.cliente = modulo_app.app.test_client()

    def test_un_sitio_ajeno_no_recibe_permiso(self):
        for ruta in ('/api/health', '/api/emisiones/sesion', '/api/registros'):
            with self.subTest(ruta=ruta):
                r = self.cliente.get(ruta, headers={'Origin': 'https://sitio-malicioso.example'})
                permitido = r.headers.get('Access-Control-Allow-Origin')
                self.assertNotIn(permitido, ('*', 'https://sitio-malicioso.example'))

    def test_el_servidor_de_desarrollo_si_puede(self):
        # Vite en el puerto 3000 va por proxy y no necesita CORS, pero abrirlo
        # directo contra el 8000 debe seguir funcionando.
        r = self.cliente.get('/api/health', headers={'Origin': 'http://localhost:3000'})
        self.assertEqual(r.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000')


if __name__ == '__main__':
    unittest.main()
