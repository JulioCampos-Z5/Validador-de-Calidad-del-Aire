/**
 * Plotly, ya configurado para toda la app. Las gráficas lo importan de aquí y
 * no de 'plotly.js' directamente, para que la configuración no dependa de que
 * cada componente se acuerde de ponerla.
 *
 * En v2 además pone el tema: fondo transparente, letras y rejilla con los
 * colores del modo claro u oscuro, y Manrope. Al cambiar el tema se vuelven a
 * pintar las gráficas abiertas. Así ninguna gráfica tiene que saber del tema.
 */

// Solo el núcleo y las trazas que usan las gráficas (scatter ya viene en el
// núcleo). El bundle completo trae 3D, mapas y WebGL: unos 4.5 MB que nadie
// usa. Una gráfica con un tipo nuevo de traza tiene que registrarlo aquí; si
// no, Plotly la dibuja vacía y avisa en consola.
// @ts-ignore — los módulos de lib/ no traen declaraciones de tipo
import PlotlyCore from 'plotly.js/lib/core';
// @ts-ignore
import bar from 'plotly.js/lib/bar';
// @ts-ignore
import heatmap from 'plotly.js/lib/heatmap';
// @ts-ignore
import violin from 'plotly.js/lib/violin';

// Sin tipos, como el bundle dist que se usaba antes: las gráficas pasan
// objetos sueltos y los tipos de Plotly no los aceptarían.
const PlotlyBase: any = PlotlyCore;
PlotlyBase.register([bar, heatmap, violin]);

// Plotly 4 muestra por defecto un botón que manda la gráfica —con sus datos— a
// cloud.plotly.com. Son datos de la red de monitoreo: no salen de aquí.
PlotlyBase.setPlotConfig({ showSendToCloud: false, displaylogo: false, locale: 'es' });

// Fechas de los ejes en español (Plotly solo trae inglés).
PlotlyBase.register({
  moduleType: 'locale',
  name: 'es',
  dictionary: { 'Download plot as a png': 'Descargar como PNG', 'Autoscale': 'Escala automática', 'Reset axes': 'Restablecer ejes', 'Zoom in': 'Acercar', 'Zoom out': 'Alejar', 'Pan': 'Mover', 'Zoom': 'Zoom' },
  format: {
    days: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
    shortDays: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
    months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
    shortMonths: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
    date: '%d/%m/%Y',
    decimal: '.',
    thousands: ',',
  },
});

type Obj = Record<string, any>;

function colores() {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  return { tx: v('--tx'), tx2: v('--tx2'), tx3: v('--tx3'), linea: v('--linea'), panel: v('--panel') };
}

// Mezcla el tema en el layout sin tocar lo que no es color de fondo, texto o
// rejilla (las franjas del índice, los colores de las series, etc. se quedan).
function conTema(layout: Obj = {}): Obj {
  const c = colores();
  const eje = (e: Obj = {}) => ({
    ...e,
    gridcolor: c.linea,
    linecolor: c.linea,
    zerolinecolor: c.linea,
    tickfont: { ...(e.tickfont ?? {}), color: c.tx3 },
    title: typeof e.title === 'string'
      ? { text: e.title, font: { color: c.tx2 } }
      : e.title ? { ...e.title, font: { ...(e.title.font ?? {}), color: c.tx2 } } : e.title,
  });
  const res: Obj = {
    ...layout,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { ...(layout.font ?? {}), family: 'Manrope, system-ui, sans-serif', color: c.tx },
    legend: layout.legend ? { ...layout.legend, bgcolor: 'rgba(0,0,0,0)', font: { ...(layout.legend.font ?? {}), color: c.tx2 } } : layout.legend,
    hoverlabel: { ...(layout.hoverlabel ?? {}), bgcolor: c.panel, bordercolor: c.linea, font: { color: c.tx } },
  };
  if (layout.title) {
    res.title = typeof layout.title === 'string'
      ? { text: layout.title, font: { color: c.tx } }
      : { ...layout.title, font: { ...(layout.title.font ?? {}), color: c.tx } };
  }
  for (const k of Object.keys(layout)) {
    if (/^[xy]axis\d*$/.test(k)) res[k] = eje(layout[k]);
  }
  if (!layout.xaxis) res.xaxis = eje();
  if (!layout.yaxis) res.yaxis = eje();
  return res;
}

// Ultimo layout original de cada grafica abierta, para repintarla con el tema.
const originales = new Map<HTMLElement, Obj>();

const Plotly = Object.create(PlotlyBase);
for (const metodo of ['newPlot', 'react'] as const) {
  Plotly[metodo] = (div: HTMLElement, data: unknown, layout?: Obj, config?: Obj) => {
    originales.set(div, layout ?? {});
    return PlotlyBase[metodo](div, data, conTema(layout), config);
  };
}
Plotly.purge = (div: HTMLElement) => {
  originales.delete(div);
  return PlotlyBase.purge(div);
};

new MutationObserver(() => {
  for (const [div, layout] of originales) {
    if (!div.isConnected) {
      originales.delete(div);
      continue;
    }
    PlotlyBase.relayout(div, conTema(layout));
  }
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });

export default Plotly;
