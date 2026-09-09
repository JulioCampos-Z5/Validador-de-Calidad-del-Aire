/**
 * Icono del botón de datos: un informe con su gráfica y una lupa encima.
 *
 * Está dibujado a mano porque en lucide no existe: la librería separa el
 * documento con barras (`FileBarChart`) del documento con lupa (`FileSearch2`),
 * y aquí hacen falta las dos mitades — lo que hay dentro son datos, y lo que se
 * hace con ellos es mirarlos.
 *
 * Sigue la retícula y el trazo de lucide para que no desentone al lado de los
 * demás: lienzo de 24×24, sin relleno, trazo de 2 con extremos y uniones
 * redondeados, y el color heredado del texto. Así responde igual a `size` y a
 * las clases de color que el resto de iconos del menú.
 */

interface Props {
  size?: number;
  className?: string;
}

export default function IconoDatos({ size = 24, className = '' }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* La hoja, alta y estrecha como en la referencia */}
      <rect x="3" y="2" width="11" height="18" rx="2" />

      {/* Las barras, sobre una misma base y de alturas distintas */}
      <path d="M6 11V8" />
      <path d="M9 11V5.5" />
      <path d="M12 11V7" />

      {/* Las dos líneas de texto, a la izquierda para que la lupa no las tape */}
      <path d="M6 14.5h4" />
      <path d="M6 17.5h2.5" />

      {/* La lupa, montada sobre la esquina inferior derecha */}
      <circle cx="16.5" cy="16.5" r="4" />
      <path d="m19.4 19.4 2 2" />
    </svg>
  );
}
