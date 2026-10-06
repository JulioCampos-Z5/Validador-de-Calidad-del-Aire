import { useEffect, useMemo, useState } from 'react';
import type { Registro } from './series';
import { derivarDia, type Dia } from './nom172';
import { iasApi, type ResumenIas } from '../services/ias';

function mensaje(e: unknown): string {
  const r = (e as { response?: { data?: { error?: string } } }).response;
  return r?.data?.error ?? 'No se pudo calcular el índice en el servidor.';
}

/**
 * Estación y mes elegidos para las vistas de categorías, y sus días según el
 * backend. Arranca en la primera estación y el último mes con datos.
 *
 * `data` solo sirve de señal: cuando cambia el conjunto cargado, el backend ya
 * tiene el nuevo y hay que volver a pedir el resumen.
 */
export function useCategoriasMes(data: Registro[]) {
  const [resumen, setResumen] = useState<ResumenIas | null>(null);
  const [estacion, setEstacion] = useState('');
  const [mes, setMes] = useState('');
  const [dias, setDias] = useState<Dia[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError(null);
    iasApi.resumen()
      .then(r => {
        if (!vigente) return;
        setResumen(r);
        if (r.estaciones.length === 0) { setDias([]); setCargando(false); }
      })
      .catch(e => { if (vigente) { setError(mensaje(e)); setCargando(false); } });
    return () => { vigente = false; };
  }, [data]);

  const estaciones = useMemo(() => resumen?.estaciones ?? [], [resumen]);
  useEffect(() => {
    if (estaciones.length && !estaciones.includes(estacion)) setEstacion(estaciones[0]);
  }, [estaciones, estacion]);

  const meses = useMemo(() => resumen?.meses[estacion] ?? [], [resumen, estacion]);
  useEffect(() => {
    if (meses.length && !meses.includes(mes)) setMes(meses[meses.length - 1]);
  }, [meses, mes]);

  useEffect(() => {
    if (!resumen || !estacion || !meses.includes(mes)) return;
    let vigente = true;
    setCargando(true);
    iasApi.categorias(estacion, mes)
      .then(d => { if (vigente) { setDias(d.map(derivarDia)); setError(null); } })
      .catch(e => { if (vigente) setError(mensaje(e)); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [resumen, estacion, mes, meses]);

  return { estaciones, estacion, setEstacion, meses, mes, setMes, dias, cargando, error };
}
