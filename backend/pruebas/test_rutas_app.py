"""
Rutas de recursos del backend.

Empaquetado con PyInstaller, `__file__` apunta dentro del ejecutable, a una
ruta que no existe en el disco. Esta prueba fija la diferencia porque el fallo
que provoca es de los que no se ven venir: la API responde perfectamente y solo
`/` devuelve 404, así que la app de escritorio abre una ventana en blanco sin
un solo error en ningún log.
"""

import os
import sys
import unittest

import app


class RaizDeRecursos(unittest.TestCase):
    def tearDown(self):
        if hasattr(sys, 'frozen'):
            del sys.frozen

    def test_en_desarrollo_sube_desde_el_codigo(self):
        raiz = app.raiz_recursos()
        self.assertTrue(os.path.isdir(os.path.join(raiz, 'backend')))
        self.assertTrue(os.path.isdir(os.path.join(raiz, 'frontend')))

    def test_empaquetado_sube_desde_el_ejecutable(self):
        """
        `sys.executable` está en `resources/backend-exe/`; los recursos de la
        app cuelgan de `resources/`.
        """
        sys.frozen = True
        original = sys.executable
        try:
            sys.executable = os.path.join('C:', os.sep, 'app', 'resources',
                                          'backend-exe', 'validador-backend.exe')
            self.assertEqual(app.raiz_recursos(),
                             os.path.join('C:', os.sep, 'app', 'resources'))
        finally:
            sys.executable = original


if __name__ == '__main__':
    unittest.main()
