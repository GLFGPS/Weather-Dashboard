'use client';

import { CorrelationResult } from '@/types';

interface TopCorrelationsProps {
  correlations: CorrelationResult[];
  title?: string;
}

export default function TopCorrelations({ correlations, title = 'Top Weather-Lead Correlations' }: TopCorrelationsProps) {
  const formatMetricName = (metric: string) => {
    const names: { [key: string]: string } = {
      tempHigh: 'High Temperature',
      tempLow: 'Low Temperature',
      tempAvg: 'Average Temperature',
      humidity: 'Humidity',
      precipitation: 'Precipitation',
      precipProb: 'Precipitation Probability',
      uvIndex: 'UV Index',
      windSpeed: 'Wind Speed',
      pressure: 'Barometric Pressure',
      cloudCover: 'Cloud Cover',
      leads: 'Leads',
    };
    return names[metric] || metric;
  };

  const getStrengthColor = (strength: string) => {
    switch (strength) {
      case 'very strong':
        return 'text-green-700 bg-green-100';
      case 'strong':
        return 'text-green-600 bg-green-50';
      case 'moderate':
        return 'text-yellow-700 bg-yellow-100';
      case 'weak':
        return 'text-orange-600 bg-orange-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">{title}</h3>
      
      {correlations.map((result, index) => {
        const metric1 = result.metric1 === 'leads' ? result.metric2 : result.metric1;
        const isPositive = result.correlation > 0;
        
        return (
          <div
            key={index}
            className="p-4 bg-white rounded-lg border border-gray-200 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex-1">
                <p className="font-semibold text-gray-800">
                  {formatMetricName(metric1)}
                </p>
                <p className="text-sm text-gray-600">
                  {isPositive ? 'Positive' : 'Negative'} relationship with leads
                </p>
              </div>
              
              <div className="text-right">
                <p className={`text-2xl font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                  {result.correlation > 0 ? '+' : ''}{result.correlation.toFixed(3)}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className={`px-2 py-1 rounded-full font-medium ${getStrengthColor(result.strength)}`}>
                {result.strength.toUpperCase()}
              </span>
              
              <span className={`${result.significant ? 'text-green-600 font-semibold' : 'text-gray-500'}`}>
                {result.significant ? '✓ Statistically Significant' : 'Not Significant'}
              </span>
              
              <span className="text-gray-500">
                p = {result.pValue.toFixed(4)}
              </span>
            </div>
          </div>
        );
      })}

      {correlations.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <p>No correlation data available</p>
          <p className="text-sm mt-2">Upload lead data to see correlations</p>
        </div>
      )}
    </div>
  );
}
