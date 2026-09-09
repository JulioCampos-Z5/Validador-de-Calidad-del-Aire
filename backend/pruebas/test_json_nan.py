"""
Las respuestas tienen que ser JSON que un navegador sepa leer.

El fallo que fija esta prueba era invisible desde Python: pandas mete NaN en
cuanto una estación no tiene datos de un parámetro —el promedio y la desviación
de una columna vacía son NaN—, el módulo `json` los escribe como `NaN`, y
`json.loads` los vuelve a leer tan contento. Todo parecía correcto desde el
servidor y desde curl.

El navegador no: `JSON.parse` rechaza `NaN`, y rechaza la respuesta entera. Una
sola estación sin PM2.5 hacía que una consulta de siete días —1.950 registros
perfectamente descargados— llegara a la interfaz como «No se pudo consultar la
API de Emisiones», sin un solo error en el servidor que explicara nada.

Por eso las comprobaciones usan un lector estricto, como el del navegador, en
vez del `json.loads` por defecto.
"""

import json
import math
import unittest

import numpy as np

import app


def _estricto(texto: str):
    """Lee JSON rechazando NaN e Infinity, igual que `JSON.parse`."""
    def rechazar(constante):
        raise ValueError(f'JSON no válido: {constante}')

    return json.loads(texto, parse_constant=rechazar)


class SaneadoDeNoFinitos(unittest.TestCase):
    def test_nan_pasa_a_null(self):
        self.assertIsNone(app._sanear_json(float('nan')))

    def test_infinitos_pasan_a_null(self):
        self.assertIsNone(app._sanear_json(float('inf')))
        self.assertIsNone(app._sanear_json(float('-inf')))

    def test_los_flotantes_normales_no_se_tocan(self):
        self.assertEqual(app._sanear_json(0.0), 0.0)
        self.assertEqual(app._sanear_json(-12.5), -12.5)

    def test_los_de_numpy_tambien(self):
        """pandas devuelve np.float64, no float, y también trae NaN."""
        self.assertIsNone(app._sanear_json(np.float64('nan')))
        self.assertEqual(app._sanear_json(np.float64(3.5)), 3.5)

    def test_entra_en_diccionarios_y_listas_anidados(self):
        sucio = {
            'estadisticas': [
                {'Estación': 'AGU', 'Promedio': float('nan'), 'Válidos': 0},
                {'Estación': 'CEN', 'Promedio': 0.031, 'Válidos': 24},
            ],
            'resumen': {'desviacion': np.float64('nan')},
        }
        limpio = app._sanear_json(sucio)
        self.assertIsNone(limpio['estadisticas'][0]['Promedio'])
        self.assertEqual(limpio['estadisticas'][1]['Promedio'], 0.031)
        self.assertIsNone(limpio['resumen']['desviacion'])
        # Lo que no es flotante se queda como estaba.
        self.assertEqual(limpio['estadisticas'][0]['Estación'], 'AGU')
        self.assertEqual(limpio['estadisticas'][0]['Válidos'], 0)


class RespuestaLegibleEnElNavegador(unittest.TestCase):
    """La prueba de verdad: lo que sale por el socket, leído como lo lee Chrome."""

    def setUp(self):
        self.cliente = app.app.test_client()

    def test_el_proveedor_serializa_sin_nan(self):
        with app.app.app_context():
            texto = app.app.json.dumps({'promedio': float('nan'), 'maximo': 1.0})
        self.assertNotIn('NaN', texto)
        self.assertEqual(_estricto(texto), {'promedio': None, 'maximo': 1.0})

    def test_una_respuesta_real_se_puede_parsear(self):
        respuesta = self.cliente.get('/api/health')
        self.assertEqual(respuesta.status_code, 200)
        _estricto(respuesta.get_data(as_text=True))

    def test_sin_el_saneado_el_navegador_habria_fallado(self):
        """
        Que la prueba anterior pase no vale de nada si el lector estricto no
        distingue: esto confirma que sí rechaza lo que rechazaría el navegador.
        """
        crudo = json.dumps({'promedio': float('nan')})
        self.assertIn('NaN', crudo)
        with self.assertRaises(ValueError):
            _estricto(crudo)
        # Y que math.isfinite es el criterio, no una comparación con NaN.
        self.assertFalse(math.isfinite(float('nan')))


if __name__ == '__main__':
    unittest.main()
