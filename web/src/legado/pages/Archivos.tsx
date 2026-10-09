import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Check, Eye, FileSpreadsheet, FolderOpen, LayoutGrid, List, RefreshCw, Search, Trash2, X,
} from 'lucide-react';
import { archivosApi, type ArchivoGuardado, type VistaArchivo } from '../services/archivos';
import { useDatos } from '../estado/DatosContexto';
import { ariaOrden, TituloOrden, useOrden } from '../components/orden';

/**
 * Visor de los Excel y CSV importados en la app de escritorio.
 *
 * Cada archivo que se importa queda guardado en la carpeta de datos del
 * usuario (`datos/archivos`). Desde aquí se miran sin cargarlos —las primeras
 * filas de su tabla— y se vuelven a abrir en el validador con un clic, sin
 * buscarlos otra vez en el disco.
 */

const TIPO: Record<ArchivoGuardado['tipo'], { texto: string; clase: string }> = {
  validado: { texto: 'Ya validado', clase: 'bg-green-50 text-green-700 border-green-200' },
  envista: { texto: 'ENVISTA', clase: 'bg-slate-50 text-slate-600 border-slate-200' },
};

function tamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const fecha = (iso: string) => new Date(iso).toLocaleString('es-MX', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

const mensaje = (e: unknown, generico: string) =>
  (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? generico;

export default function Archivos({ ir }: { ir: (modulo: string) => void }) {
  const { cargarGuardado, cargando, error: errorCarga, exito } = useDatos();
  const [lista, setLista] = useState<ArchivoGuardado[] | null>(null);
  const [disponible, setDisponible] = useState(true);
  const [carpeta, setCarpeta] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [buscar, setBuscar] = useState('');
  // Cards por defecto; la tabla queda como otra vista. Se recuerda la elegida.
  const [modo, setModo] = useState<'cards' | 'tabla'>(() => {
    try { return localStorage.getItem('archivos-vista') === 'tabla' ? 'tabla' : 'cards'; } catch { return 'cards'; }
  });
  const cambiarModo = (m: 'cards' | 'tabla') => {
    setModo(m);
    try { localStorage.setItem('archivos-vista', m); } catch { /* sin almacenamiento */ }
  };
  const [vista, setVista] = useState<VistaArchivo | null>(null);
  const [cargandoVista, setCargandoVista] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);

  const refrescar = useCallback(async () => {
    try {
      const r = await archivosApi.listar();
      setDisponible(r.disponible);
      setCarpeta(r.carpeta ?? '');
      setLista(r.archivos);
      setError(null);
    } catch (e) {
      setError(mensaje(e, 'No se pudo leer la lista de archivos. ¿Está el servidor en marcha?'));
      setLista([]);
    }
  }, []);

  useEffect(() => { refrescar(); }, [refrescar]);

  const filtrados = useMemo(() => {
    const t = buscar.trim().toLowerCase();
    return (lista ?? []).filter((a) => !t || a.nombre.toLowerCase().includes(t));
  }, [lista, buscar]);
  const { ordenadas: visibles, orden, alternar } = useOrden(filtrados);
  const titulo = (clave: string, texto: string, derecha?: boolean) => (
    <th aria-sort={ariaOrden(orden, clave)} className={`px-4 py-2 font-medium${derecha ? ' text-right' : ''}`}>
      <TituloOrden clave={clave} orden={orden} alternar={alternar} derecha={derecha}>{texto}</TituloOrden>
    </th>
  );

  const ver = async (nombre: string, hoja?: string) => {
    setCargandoVista(true);
    try {
      setVista(await archivosApi.vista(nombre, hoja));
      setError(null);
    } catch (e) {
      setError(mensaje(e, 'No se pudo leer el archivo.'));
    } finally {
      setCargandoVista(false);
    }
  };

  const abrir = async (nombre: string) => {
    setAbierto(null);
    if (await cargarGuardado(nombre)) setAbierto(nombre);
  };

  const borrar = async (nombre: string) => {
    if (!window.confirm(`¿Borrar «${nombre}» de los archivos guardados? No se puede deshacer.`)) return;
    try {
      await archivosApi.borrar(nombre);
      if (vista?.nombre === nombre) setVista(null);
      await refrescar();
    } catch (e) {
      setError(mensaje(e, 'No se pudo borrar el archivo.'));
    }
  };

  const acciones = (nombre: string) => (
    <>
      <button type="button" onClick={() => ver(nombre)} aria-label={`Ver ${nombre}`}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50">
        <Eye size={14} /> Ver
      </button>
      <button type="button" onClick={() => abrir(nombre)} disabled={cargando}
        aria-label={`Abrir ${nombre} en el validador`}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-800 text-slate-900 hover:bg-slate-50 disabled:opacity-50">
        <FolderOpen size={14} /> {cargando ? 'Abriendo…' : 'Abrir'}
      </button>
      <button type="button" onClick={() => borrar(nombre)} aria-label={`Borrar ${nombre}`}
        className="inline-flex items-center px-2 py-1 rounded-md border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-700 hover:border-red-200">
        <Trash2 size={14} />
      </button>
    </>
  );

  if (!disponible) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
        <FolderOpen className="w-10 h-10 mx-auto text-slate-300 mb-3" />
        <p className="text-slate-700 font-medium">Los archivos guardados están en la app de escritorio.</p>
        <p className="text-sm text-slate-500 mt-1">Ahí se guarda una copia de cada Excel o CSV que importas.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Archivos</h1>
          <p className="text-slate-600">Los Excel y CSV que has importado, para volver a consultarlos</p>
        </div>
        <button
          type="button"
          onClick={refrescar}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw size={14} /> Actualizar
        </button>
      </div>

      {(error || errorCarga) && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3" role="alert">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error ?? errorCarga}</p>
        </div>
      )}

      {abierto && exito && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex flex-wrap items-center gap-3" role="status">
          <Check className="w-5 h-5 text-green-600 shrink-0" />
          <p className="text-green-800 flex-1">{exito}</p>
          <button type="button" onClick={() => ir('validacion')}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-green-300 text-green-800 hover:bg-green-100">
            Ver en Validación
          </button>
          <button type="button" onClick={() => ir('graficas')}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-green-300 text-green-800 hover:bg-green-100">
            Ver gráficas
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center gap-3">
          <label className="relative flex-1 min-w-[220px]">
            <span className="sr-only">Buscar archivo</span>
            <Search size={15} className="absolute left-3 top-2.5 text-slate-400" aria-hidden="true" />
            <input
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder="Buscar por nombre…"
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            />
          </label>
          <div role="tablist" aria-label="Vista" className="flex rounded-lg border border-slate-200 p-0.5">
            {([['cards', 'Cards', LayoutGrid], ['tabla', 'Tabla', List]] as const).map(([id, texto, Icono]) => (
              <button key={id} type="button" role="tab" aria-selected={modo === id} onClick={() => cambiarModo(id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm ${modo === id ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                <Icono size={14} /> {texto}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-500">
            {(lista ?? []).length} guardados{carpeta && <> · <span className="font-mono">{carpeta}</span></>}
          </span>
        </div>

        {lista === null ? (
          <p className="p-6 text-sm text-slate-500">Cargando…</p>
        ) : lista.length === 0 ? (
          <div className="p-10 text-center">
            <FileSpreadsheet className="w-10 h-10 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-700 font-medium">Todavía no hay archivos guardados.</p>
            <p className="text-sm text-slate-500 mt-1">
              Importa un Excel o CSV desde el Tablero → Carga de datos → Consultar datos y aparecerá aquí.
            </p>
          </div>
        ) : visibles.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Ningún archivo coincide con «{buscar}».</p>
        ) : modo === 'cards' ? (
          <ul className="p-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Archivos guardados">
            {visibles.map((a) => (
              <li key={a.nombre}
                className={`rounded-xl border p-4 flex flex-col gap-3 ${vista?.nombre === a.nombre ? 'border-slate-800 bg-slate-50' : 'border-slate-200'}`}>
                <div className="flex items-start gap-3 min-w-0">
                  <FileSpreadsheet className="w-8 h-8 text-green-600 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 break-all leading-snug">{a.nombre}</p>
                    <span className={`inline-block mt-1 px-2 py-0.5 rounded border text-xs ${TIPO[a.tipo].clase}`}>
                      {TIPO[a.tipo].texto}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-slate-500">{tamano(a.tamano)} · {fecha(a.modificado)}</p>
                <div className="flex gap-1.5 mt-auto">{acciones(a.nombre)}</div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  {titulo('nombre', 'Archivo')}
                  {titulo('tipo', 'Tipo')}
                  {titulo('tamano', 'Tamaño', true)}
                  {titulo('modificado', 'Guardado')}
                  <th className="px-4 py-2 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibles.map((a) => (
                  <tr key={a.nombre} className={vista?.nombre === a.nombre ? 'bg-slate-50' : ''}>
                    <td className="px-4 py-2 font-medium text-slate-800 break-all">{a.nombre}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded border text-xs ${TIPO[a.tipo].clase}`}>
                        {TIPO[a.tipo].texto}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">{tamano(a.tamano)}</td>
                    <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{fecha(a.modificado)}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1.5">{acciones(a.nombre)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(vista || cargandoVista) && (
        <section className="bg-white rounded-xl border border-slate-200" aria-label="Vista previa">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-slate-800 break-all">{vista?.nombre ?? 'Cargando…'}</h2>
              {vista && (
                <p className="text-sm text-slate-500">
                  Primeras {vista.filas.length.toLocaleString()} de {vista.total.toLocaleString()} filas
                  · {vista.columnas.length} columnas
                </p>
              )}
            </div>
            {vista && vista.hojas.length > 1 && (
              <label className="text-sm text-slate-600 flex items-center gap-2">
                Hoja
                <select value={vista.hoja ?? ''} onChange={(e) => ver(vista.nombre, e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white">
                  {vista.hojas.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            )}
            {vista && (
              <button type="button" onClick={() => abrir(vista.nombre)} disabled={cargando}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-800 text-slate-900 hover:bg-slate-50 disabled:opacity-50">
                <FolderOpen size={14} /> Abrir en el validador
              </button>
            )}
            <button type="button" onClick={() => setVista(null)} aria-label="Cerrar vista previa"
              className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100">
              <X size={16} />
            </button>
          </div>
          {vista && (
            <div className="overflow-auto max-h-[60vh]">
              <table className="text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    {vista.columnas.map((c, i) => (
                      <th key={i} className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap border-b border-slate-200">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {vista.filas.map((fila, i) => (
                    <tr key={i}>
                      {fila.map((v, j) => (
                        <td key={j} className="px-3 py-1.5 whitespace-nowrap tabular-nums text-slate-700">{v ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
