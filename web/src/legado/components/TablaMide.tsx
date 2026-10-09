import { useEffect, useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { iasApi, type FilaMide, type Mide } from '../services/ias';
import { useDatos } from '../estado/DatosContexto';
import { ariaOrden, TituloOrden, useOrden } from './orden';

/**
 * Las dos hojas MIDE del Excel diario (backend/ias/calculo.py): cuántos días
 * de cada mes quedaron en Buena o Aceptable, en el AMG y por municipio. Salen
 * del mismo cálculo que el Excel, así que dicen lo mismo.
 */

const COLUMNAS: { clave: keyof FilaMide; etiqueta: string }[] = [
  { clave: 'IAS_GLOBAL_CAT_DIA_BUENA_ACEPTABLE', etiqueta: 'Global' },
  { clave: 'IAS_O3_CAT_DIA_BUENA_ACEPTABLE', etiqueta: 'O3' },
  { clave: 'IAS_PM10_CAT_DIA_BUENA_ACEPTABLE', etiqueta: 'PM10' },
  { clave: 'IAS_PM2.5_CAT_DIA_BUENA_ACEPTABLE', etiqueta: 'PM2.5' },
];

// El cálculo vive en el backend y se pide una vez por conjunto cargado: las
// dos pestañas comparten la misma respuesta.
let enCurso: { clave: unknown; promesa: Promise<Mide> } | null = null;
function pedir(clave: unknown) {
  if (!enCurso || enCurso.clave !== clave) enCurso = { clave, promesa: iasApi.mide() };
  return enCurso.promesa;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
// El mes se ordena por calendario, no por orden alfabético.
const valorMide = (f: FilaMide, clave: string) => {
  if (clave !== 'MES') return f[clave as keyof FilaMide];
  const i = MESES.indexOf(String(f.MES).toLowerCase());
  return i < 0 ? f.MES : i;
};

function Tabla({ filas, conMunicipio }: { filas: FilaMide[]; conMunicipio?: boolean }) {
  // Las filas TOTAL se quedan al final, ordene como se ordene.
  const totales = useMemo(() => filas.filter(f => f.MES === 'TOTAL'), [filas]);
  const meses = useMemo(() => filas.filter(f => f.MES !== 'TOTAL'), [filas]);
  const { ordenadas, orden, alternar } = useOrden(meses, valorMide);
  const vistas = orden ? [...ordenadas, ...totales] : filas;
  const titulo = (clave: string, texto: string, derecha?: boolean) => (
    <th key={clave} aria-sort={ariaOrden(orden, clave)} className={`px-4 py-2 font-medium${derecha ? ' text-right' : ''}`}>
      <TituloOrden clave={clave} orden={orden} alternar={alternar} derecha={derecha}>{texto}</TituloOrden>
    </th>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
            {conMunicipio && titulo('MUNICIPIO', 'Municipio')}
            {titulo('MES', 'Mes')}
            {COLUMNAS.map(c => titulo(c.clave, c.etiqueta, true))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {vistas.map((f, i) => {
            const total = f.MES === 'TOTAL';
            return (
              <tr key={i} className={total ? 'bg-slate-50 font-semibold text-slate-800' : 'text-slate-700'}>
                {conMunicipio && <td className="px-4 py-1.5">{f.MUNICIPIO}</td>}
                <td className="px-4 py-1.5">{f.MES}</td>
                {COLUMNAS.map(c => (
                  <td key={c.clave} className="px-4 py-1.5 text-right tabular-nums">{f[c.clave]}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function TablaMide({ hoja }: { hoja: 'amg' | 'municipios' }) {
  const { resultado } = useDatos();
  const [mide, setMide] = useState<Mide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [municipio, setMunicipio] = useState<string>('todos');

  useEffect(() => {
    if (!resultado) return;
    let vivo = true;
    setError(null);
    pedir(resultado)
      .then(m => vivo && setMide(m))
      .catch((e: { response?: { data?: { error?: string } } }) => {
        enCurso = null;
        if (vivo) setError(e.response?.data?.error ?? 'No se pudo calcular el MIDE.');
      });
    return () => { vivo = false; };
  }, [resultado]);

  // Agrupado por municipio (el Excel los intercala mes a mes, que se lee mal).
  const municipios = useMemo(
    () => [...new Set((mide?.municipios ?? []).map(f => f.MUNICIPIO ?? ''))],
    [mide],
  );
  const filasMunicipio = useMemo(() => {
    const filas = mide?.municipios ?? [];
    const elegidos = municipio === 'todos' ? municipios : [municipio];
    return elegidos.flatMap(m => filas.filter(f => f.MUNICIPIO === m));
  }, [mide, municipios, municipio]);

  if (!resultado) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-slate-300 p-8 text-center">
        <p className="text-slate-600">No hay datos cargados.</p>
        <p className="text-sm text-slate-500 mt-1">Carga un periodo o un archivo en Validación para calcular el MIDE.</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
        <p className="text-red-700">{error}</p>
      </div>
    );
  }
  if (!mide) return <p className="text-sm text-slate-500 py-8 text-center">Calculando el MIDE…</p>;

  const amg = hoja === 'amg';
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm">
      <div className="p-5 border-b border-slate-200">
        <h2 className="text-lg font-semibold text-slate-800">
          {amg ? 'MIDE · Área Metropolitana de Guadalajara' : 'MIDE por municipio'}
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Días con índice Aire y Salud en Buena o Aceptable, por mes.
        </p>
        {!amg && municipios.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {['todos', ...municipios].map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMunicipio(m)}
                className={`px-3 py-1 rounded-[10px] text-[13px] font-medium border bg-white transition-colors ${
                  municipio === m ? 'border-slate-800 text-slate-900' : 'border-slate-300 text-slate-600 hover:border-slate-500'
                }`}
              >
                {m === 'todos' ? 'Todos' : m}
              </button>
            ))}
          </div>
        )}
      </div>
      {amg
        ? <Tabla filas={mide.amg} />
        : filasMunicipio.length
          ? <Tabla filas={filasMunicipio} conMunicipio={municipio === 'todos'} />
          : <p className="p-5 text-sm text-slate-500">Ninguna estación cargada pertenece a un municipio del catálogo.</p>}
    </div>
  );
}
