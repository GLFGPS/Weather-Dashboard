'use client';

import { CorrelationMatrix } from '@/types';

interface CorrelationHeatmapProps {
  matrix: CorrelationMatrix;
}

export default function CorrelationHeatmap({ matrix }: CorrelationHeatmapProps) {
  const getColor = (correlation: number) => {
    const abs = Math.abs(correlation);
    if (correlation > 0) {
      // Positive correlation - green scale
      return `rgba(0, 138, 78, ${abs})`;
    } else {
      // Negative correlation - red scale
      return `rgba(239, 68, 68, ${abs})`;
    }
  };

  const formatMetricName = (metric: string) => {
    const names: { [key: string]: string } = {
      tempHigh: 'High Temp',
      tempLow: 'Low Temp',
      tempAvg: 'Avg Temp',
      humidity: 'Humidity',
      precipitation: 'Precip',
      precipProb: 'Precip Prob',
      uvIndex: 'UV Index',
      windSpeed: 'Wind Speed',
      pressure: 'Pressure',
      cloudCover: 'Cloud Cover',
      leads: 'Leads',
    };
    return names[metric] || metric;
  };

  return (
    <div className="w-full overflow-x-auto">
      <div className="min-w-max">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="p-2 text-xs font-semibold text-gray-700 border border-gray-200 bg-gray-50"></th>
              {matrix.metrics.map((metric) => (
                <th
                  key={metric}
                  className="p-2 text-xs font-semibold text-gray-700 border border-gray-200 bg-gray-50 min-w-[80px]"
                >
                  <div className="transform -rotate-45 origin-left whitespace-nowrap">
                    {formatMetricName(metric)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.metrics.map((rowMetric, i) => (
              <tr key={rowMetric}>
                <th className="p-2 text-xs font-semibold text-gray-700 border border-gray-200 bg-gray-50 text-right whitespace-nowrap">
                  {formatMetricName(rowMetric)}
                </th>
                {matrix.metrics.map((colMetric, j) => {
                  const correlation = matrix.correlations[i][j];
                  return (
                    <td
                      key={colMetric}
                      className="p-2 text-center border border-gray-200 text-xs font-medium"
                      style={{ backgroundColor: getColor(correlation) }}
                      title={`${formatMetricName(rowMetric)} vs ${formatMetricName(colMetric)}: ${correlation.toFixed(3)}`}
                    >
                      <span className={correlation > 0.5 || correlation < -0.5 ? 'text-white' : 'text-gray-800'}>
                        {correlation.toFixed(2)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-center gap-4 text-xs text-gray-600">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: 'rgba(0, 138, 78, 0.8)' }}></div>
          <span>Positive Correlation</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: 'rgba(239, 68, 68, 0.8)' }}></div>
          <span>Negative Correlation</span>
        </div>
      </div>
    </div>
  );
}
