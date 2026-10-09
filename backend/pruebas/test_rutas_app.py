"""
Rutas de recursos del backend.

Empaquetado con PyInstaller, `__file__` apunta dentro del ejecutable, a una
ruta que no existe en el disco. Esta prueba fija la diferencia: con la raíz
equivocada la descarga de la app de escritorio no encuentra su instalador.
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
        self.assertTrue(os.path.isdir(os.path.join(raiz, 'web')))

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
