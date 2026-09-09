"""
Registro de errores del servidor.

La razón de que esto exista es que en un servidor nadie ve la salida estándar.
Lo que se prueba, entonces, es que un fallo real acabe siendo visible desde la
API — no que el `deque` funcione.
"""

import logging
import unittest

import app as aplicacion
import registros


class Anillo(unittest.TestCase):
    def setUp(self):
        registros.limpiar()
        self.cliente = aplicacion.app.test_client()

    def tearDown(self):
        registros.limpiar()

    def test_un_error_queda_registrado_con_su_traza(self):
        try:
            raise ValueError('algo se rompió')
        except ValueError as e:
            registros.anotar_error('Prueba: falló a propósito', e)

        entradas = registros.ultimos()
        self.assertEqual(len(entradas), 1)
        self.assertEqual(entradas[0]['nivel'], 'ERROR')
        self.assertIn('falló a propósito', entradas[0]['mensaje'])
        self.assertIn('ValueError', entradas[0]['traza'])
        self.assertIn('algo se rompió', entradas[0]['traza'])

    def test_los_mas_recientes_van_primero(self):
        """Se leen de arriba abajo buscando lo último que pasó."""
        for i in range(3):
            registros.anotar_error(f'error {i}')
        entradas = registros.ultimos()
        self.assertEqual([e['mensaje'] for e in entradas],
                         ['error 2', 'error 1', 'error 0'])

    def test_no_guarda_el_ruido_de_cada_peticion(self):
        """
        Werkzeug emite una línea por petición en INFO. Guardarlas ahogaría los
        errores, que es justo lo que se viene a buscar.
        """
        logging.getLogger('werkzeug').info('GET /api/health 200')
        self.assertEqual(registros.ultimos(), [])

    def test_descarta_los_viejos_sin_crecer_sin_limite(self):
        for i in range(registros.CAPACIDAD + 20):
            registros.anotar_error(f'error {i}')
        entradas = registros.ultimos(limite=registros.CAPACIDAD)
        self.assertEqual(len(entradas), registros.CAPACIDAD)
        self.assertEqual(entradas[0]['mensaje'],
                         f'error {registros.CAPACIDAD + 19}')

    def test_se_puede_filtrar_por_nivel(self):
        registros.anotar_error('esto es un error')
        logging.getLogger('validador').warning('esto es un aviso')

        self.assertEqual(len(registros.ultimos(nivel='ERROR')), 1)
        self.assertEqual(len(registros.ultimos(nivel='WARNING')), 1)
        self.assertEqual(len(registros.ultimos()), 2)

    def test_un_fallo_dentro_del_propio_registro_no_tumba_nada(self):
        """Convertir un aviso en una caída sería el peor resultado posible."""
        class Rompe:
            def __str__(self):
                raise RuntimeError('no se puede convertir')

        logging.getLogger('validador').error('%s', Rompe())
        self.assertEqual(registros.ultimos(), [])


class Endpoint(unittest.TestCase):
    def setUp(self):
        registros.limpiar()
        self.cliente = aplicacion.app.test_client()

    def tearDown(self):
        registros.limpiar()

    def test_devuelve_lo_registrado(self):
        registros.anotar_error('Prueba: algo falló')
        cuerpo = self.cliente.get('/api/registros').get_json()
        self.assertEqual(cuerpo['total'], 1)
        self.assertEqual(cuerpo['registros'][0]['mensaje'], 'Prueba: algo falló')
        self.assertEqual(cuerpo['capacidad'], registros.CAPACIDAD)

    def test_respeta_el_limite(self):
        for i in range(10):
            registros.anotar_error(f'error {i}')
        cuerpo = self.cliente.get('/api/registros?limite=3').get_json()
        self.assertEqual(cuerpo['total'], 3)

    def test_filtra_por_nivel(self):
        registros.anotar_error('un error')
        logging.getLogger('validador').warning('un aviso')
        cuerpo = self.cliente.get('/api/registros?nivel=ERROR').get_json()
        self.assertEqual(cuerpo['total'], 1)

    def test_se_pueden_vaciar(self):
        registros.anotar_error('un error')
        self.cliente.delete('/api/registros')
        self.assertEqual(self.cliente.get('/api/registros').get_json()['total'], 0)


if __name__ == '__main__':
    unittest.main()
