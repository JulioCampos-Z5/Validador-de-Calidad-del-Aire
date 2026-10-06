import { ReactNode } from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  description?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  color?: 'blue' | 'green' | 'orange' | 'red' | 'purple';
}

// En v2 la tarjeta es neutra (como .numero): el color queda solo para el
// nivel de un dato. `color` se acepta para no cambiar a quien la llama.
export default function StatCard({
  title,
  value,
  icon,
  description,
}: StatCardProps) {

  return (
    <div className="bg-slate-50 rounded-xl p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500">{title}</p>
          <p className="text-2xl font-semibold text-slate-800 mt-1">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {description && (
            <p className="text-sm text-slate-500 mt-1">{description}</p>
          )}
        </div>
        <div className="p-1 text-slate-400">
          {icon}
        </div>
      </div>
    </div>
  );
}
