'use client';

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
}

export default function StatCard({ label, value, unit, icon, trend, trendValue }: StatCardProps) {
  const getTrendColor = () => {
    if (!trend) return '';
    switch (trend) {
      case 'up':
        return 'text-green-600';
      case 'down':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
      <div className="flex-1">
        <p className="text-sm text-gray-600 uppercase tracking-wide">{label}</p>
        <div className="flex items-baseline gap-1 mt-1">
          <p className="text-3xl font-bold text-primary">
            {value}
          </p>
          {unit && <span className="text-lg text-gray-600">{unit}</span>}
        </div>
        {trend && trendValue && (
          <p className={`text-sm mt-1 ${getTrendColor()}`}>
            {trend === 'up' && '↑'}
            {trend === 'down' && '↓'}
            {trend === 'neutral' && '→'}
            {' '}{trendValue}
          </p>
        )}
      </div>
      {icon && (
        <div className="text-gray-400 opacity-50">
          {icon}
        </div>
      )}
    </div>
  );
}
