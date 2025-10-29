'use client';

import { WeatherResponse } from '@/types';
import StatCard from './StatCard';

interface CurrentWeatherDisplayProps {
  weather: WeatherResponse;
}

export default function CurrentWeatherDisplay({ weather }: CurrentWeatherDisplayProps) {
  const current = weather.currentConditions || weather.days[0];
  const today = weather.days[0];

  const formatTime = (timeStr: string) => {
    if (!timeStr) return '--:--';
    const date = new Date(`2000-01-01T${timeStr}`);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const getWindDirection = (degrees: number) => {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                       'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(((degrees % 360) / 22.5)) % 16;
    return directions[index];
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      <StatCard
        label="Temperature"
        value={Math.round(current.temp)}
        unit="°F"
        icon={
          <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        }
      />

      <div className="bg-gray-50 rounded-lg p-4">
        <p className="text-sm text-gray-600 uppercase tracking-wide mb-2">Temperature Range</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">High</p>
            <p className="text-2xl font-bold text-red-600">{Math.round(today.tempmax)}°F</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Low</p>
            <p className="text-2xl font-bold text-blue-600">{Math.round(today.tempmin)}°F</p>
          </div>
        </div>
      </div>

      <StatCard
        label="Feels Like"
        value={Math.round(current.feelslike)}
        unit="°F"
      />

      <StatCard
        label="Humidity"
        value={Math.round(current.humidity)}
        unit="%"
      />

      <div className="bg-gray-50 rounded-lg p-4">
        <p className="text-sm text-gray-600 uppercase tracking-wide mb-2">Precipitation</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">Chance</p>
            <p className="text-2xl font-bold text-primary">{Math.round(today.precipprob || 0)}%</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Amount</p>
            <p className="text-2xl font-bold text-primary">{today.precip || 0} in</p>
          </div>
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-4">
        <p className="text-sm text-gray-600 uppercase tracking-wide mb-2">Wind</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">Speed</p>
            <p className="text-2xl font-bold text-primary">{Math.round(current.windspeed)} mph</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Direction</p>
            <p className="text-2xl font-bold text-primary">{getWindDirection(current.winddir)}</p>
          </div>
        </div>
      </div>

      <StatCard
        label="UV Index"
        value={current.uvindex}
        unit=""
      />

      <div className="bg-gray-50 rounded-lg p-4">
        <p className="text-sm text-gray-600 uppercase tracking-wide mb-2">Sun</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">Sunrise</p>
            <p className="text-lg font-bold text-primary">{formatTime(current.sunrise)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Sunset</p>
            <p className="text-lg font-bold text-primary">{formatTime(current.sunset)}</p>
          </div>
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-4">
        <p className="text-sm text-gray-600 uppercase tracking-wide mb-2">Conditions</p>
        <p className="text-lg font-semibold text-gray-800 mt-2">{today.conditions}</p>
        {today.description && (
          <p className="text-sm text-gray-600 mt-1">{today.description}</p>
        )}
      </div>

      <StatCard
        label="Pressure"
        value={Math.round(current.pressure)}
        unit="mb"
      />

      <StatCard
        label="Cloud Cover"
        value={Math.round(current.cloudcover)}
        unit="%"
      />

      <StatCard
        label="Visibility"
        value={Math.round(current.visibility)}
        unit="mi"
      />
    </div>
  );
}
