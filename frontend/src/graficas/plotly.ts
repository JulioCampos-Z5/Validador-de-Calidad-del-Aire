/**
 * Plotly, ya configurado para toda la app. Las gráficas lo importan de aquí y
 * no de 'plotly.js' directamente, para que la configuración no dependa de que
 * cada componente se acuerde de ponerla.
 */

// @ts-ignore — el bundle dist es browser-ready pero no tiene declaraciones de tipo propias
import Plotly from 'plotly.js/dist/plotly.js';

// Plotly 4 muestra por defecto un botón que manda la gráfica —con sus datos— a
// cloud.plotly.com. Son datos de la red de monitoreo: no salen de aquí.
Plotly.setPlotConfig({ showSendToCloud: false });

export default Plotly;
