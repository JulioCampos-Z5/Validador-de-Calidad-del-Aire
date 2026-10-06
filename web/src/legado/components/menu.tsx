import { createContext, useContext } from 'react';

/**
 * Estado del menú lateral, compartido con lo que vive dentro de él.
 *
 * Va por contexto y no por props porque los bloques del menú están anidados
 * —`OrigenDatos` contiene a `SelectorPeriodo`— y todos necesitan lo mismo:
 * saber si están plegados y poder pedir que se despliegue.
 *
 * Hay una sola barra, no dos. Plegada muestra los iconos; desplegada, los
 * iconos con sus etiquetas y sus paneles. Tener un carril aparte significaba
 * mantener dos navegaciones en paralelo y que las dos existieran a la vez.
 */

export interface EstadoMenu {
  plegado: boolean;
  /** Despliega la barra. Lo usan los iconos cuyo panel necesita anchura. */
  desplegar: () => void;
}

export const MenuContexto = createContext<EstadoMenu>({
  plegado: false,
  desplegar: () => {},
});

export function useMenu(): EstadoMenu {
  return useContext(MenuContexto);
}

/** Clases del botón de un icono en la barra plegada, para que todos coincidan. */
export function clasesIcono(activo = false): string {
  return `p-3 rounded-lg transition-colors ${
    activo
      ? 'bg-primary-50 text-primary-700'
      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
  }`;
}
