'use client';

interface WeatherCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

export default function WeatherCard({ title, children, className = '' }: WeatherCardProps) {
  return (
    <div className={`bg-white/95 backdrop-blur-sm rounded-2xl shadow-lg p-6 hover:shadow-xl transition-all duration-300 ${className}`}>
      <h2 className="text-xl font-bold text-gray-800 mb-4">{title}</h2>
      {children}
    </div>
  );
}
