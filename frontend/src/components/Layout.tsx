import { ReactNode, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Settings,
  Wind,
  Menu,
  BarChart3,
  ScrollText,
} from 'lucide-react';
import OrigenDatos from './OrigenDatos';
import { MenuContexto, clasesIcono, type EstadoMenu } from './menu';
import DescargarApp from './DescargarApp';

interface LayoutProps {
  children: ReactNode;
}

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/charts', label: 'Gráficas', icon: BarChart3 },
  { path: '/registros', label: 'Registros', icon: ScrollText },
  { path: '/config', label: 'Parámetros', icon: Settings },
];

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  // Plegada de entrada en todas las páginas. El contenido es lo que se viene a
  // ver; el menú se despliega cuando hace falta y se vuelve a plegar.
  const [plegado, setPlegado] = useState(true);

  const menu = useMemo<EstadoMenu>(
    () => ({ plegado, desplegar: () => setPlegado(false) }),
    [plegado],
  );

  return (
    <MenuContexto.Provider value={menu}>
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200 fixed top-0 left-0 right-0 z-30">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPlegado((v) => !v)}
              title={plegado ? 'Desplegar el menú' : 'Plegar el menú'}
              aria-label={plegado ? 'Desplegar el menú' : 'Plegar el menú'}
              aria-expanded={!plegado}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"
            >
              {/* La misma hamburguesa en los dos estados: es el gesto que
                  todo el mundo reconoce para «el menú», y un icono que cambia
                  de dibujo al pulsarlo hace dudar de si es el mismo botón.
                  Que esté plegado o no ya se ve en la barra, y lo dice el
                  title y aria-expanded. */}
              <Menu size={24} />
            </button>
            <div className="flex items-center gap-2">
              <Wind className="h-8 w-8 text-primary-600" />
              <div>
                <h1 className="text-lg font-bold text-slate-800">
                  Validador de Calidad del Aire
                </h1>
                <p className="text-xs text-slate-500">Sistema de Validación ENVISTA</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-green-100 text-green-700 text-sm rounded-full">
              v1.0.0
            </span>
          </div>
        </div>
      </header>

      {/* UNA sola barra. Plegada deja los iconos; desplegada, los iconos con
          etiqueta y sus paneles. No desaparece nunca, ni en el tablero: si se
          va del todo hay que recordar dónde estaba el botón para traerla. */}
      <aside
        className={`fixed top-0 left-0 z-20 h-full bg-white shadow-lg pt-16 transition-[width] duration-200 ease-in-out ${
          plegado ? 'w-16' : 'w-64'
        }`}
      >
        <div className="h-full overflow-y-auto pb-4">
        <nav className={plegado ? 'p-2 space-y-1 flex flex-col items-center' : 'p-4 space-y-2'}>
          {navItems.map(({ path, label, icon: Icono }) => {
            const activo = location.pathname === path;

            // Plegada, el título del enlace es lo único que dice a dónde lleva.
            return (
              <Link
                key={path}
                to={path}
                title={label}
                aria-label={label}
                className={plegado
                  ? clasesIcono(activo)
                  : `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                      activo
                        ? 'bg-primary-50 text-primary-700 font-medium'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
              >
                <Icono size={20} />
                {!plegado && <span>{label}</span>}
              </Link>
            );
          })}
        </nav>

        <OrigenDatos />
        <DescargarApp />
        </div>

        {/* Info Box */}
        <div className="hidden absolute bottom-4 left-4 right-4">
          <div className="bg-slate-50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-slate-700 mb-2">
              ¿Necesitas ayuda?
            </h4>
            <p className="text-xs text-slate-500 mb-3">
              Consulta la documentación para aprender a usar el sistema.
            </p>
            <a
              href="#"
              className="text-xs text-primary-600 hover:text-primary-700 font-medium"
            >
              Ver documentación →
            </a>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`${plegado ? 'ml-16' : 'ml-64'} pt-16 min-h-screen transition-[margin] duration-200`}>
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
    </MenuContexto.Provider>
  );
}
