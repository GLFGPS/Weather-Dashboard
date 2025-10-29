'use client';

import { useState, useEffect } from 'react';
import WeatherCard from '@/components/WeatherCard';
import FileUpload from '@/components/FileUpload';
import CurrentWeatherDisplay from '@/components/CurrentWeatherDisplay';
import TopCorrelations from '@/components/TopCorrelations';
import CorrelationHeatmap from '@/components/CorrelationHeatmap';
import TimeSeriesChart from '@/components/TimeSeriesChart';
import GoogleTrends from '@/components/GoogleTrends';
import { WeatherService } from '@/lib/weatherService';
import { DataProcessingService } from '@/lib/dataProcessing';
import { CorrelationService } from '@/lib/correlationService';
import { WeatherResponse, LeadDataset, WeatherLeadData, CorrelationMatrix, CorrelationResult } from '@/types';

export default function Home() {
  const [currentWeather, setCurrentWeather] = useState<WeatherResponse | null>(null);
  const [leadData, setLeadData] = useState<LeadDataset | null>(null);
  const [combinedData, setCombinedData] = useState<WeatherLeadData[]>([]);
  const [correlations, setCorrelations] = useState<CorrelationMatrix | null>(null);
  const [topCorrelations, setTopCorrelations] = useState<CorrelationResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const location = process.env.NEXT_PUBLIC_LOCATION || 'West Chester,PA';

  // Fetch current weather on mount
  useEffect(() => {
    fetchCurrentWeather();
  }, []);

  const fetchCurrentWeather = async () => {
    try {
      setLoading(true);
      setError(null);
      const weather = await WeatherService.getCurrentWeather(location);
      setCurrentWeather(weather);
    } catch (err) {
      setError(`Failed to fetch weather: ${err instanceof Error ? err.message : 'Unknown error'}`);
      console.error('Error fetching weather:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLeadDataUpload = async (rawData: any[]) => {
    try {
      setHistoricalLoading(true);
      setError(null);

      // Parse lead data
      const parsedLeads = DataProcessingService.parseLeadData(rawData);
      const aggregatedLeads = DataProcessingService.aggregateLeadsByDate(parsedLeads.data);
      
      const leadDataset: LeadDataset = {
        ...parsedLeads,
        data: aggregatedLeads,
      };

      setLeadData(leadDataset);

      // Fetch historical weather for the date range
      console.log('Fetching weather data from', leadDataset.startDate, 'to', leadDataset.endDate);
      const weatherData = await WeatherService.getHistoricalWeatherRange(
        location,
        leadDataset.startDate,
        leadDataset.endDate
      );

      // Combine weather and lead data
      const combined = DataProcessingService.combineWeatherAndLeads(weatherData, aggregatedLeads);
      setCombinedData(combined);

      // Calculate correlations
      if (combined.length > 0) {
        const correlationMatrix = CorrelationService.calculateCorrelationMatrix(combined);
        setCorrelations(correlationMatrix);

        const topLeadCorrelations = CorrelationService.findTopLeadCorrelations(correlationMatrix, 5);
        setTopCorrelations(topLeadCorrelations);
      }

      setHistoricalLoading(false);
    } catch (err) {
      setError(`Failed to process data: ${err instanceof Error ? err.message : 'Unknown error'}`);
      console.error('Error processing data:', err);
      setHistoricalLoading(false);
    }
  };

  const stats = combinedData.length > 0 ? DataProcessingService.calculateDailyStats(combinedData) : null;
  const monthlyData = combinedData.length > 0 ? DataProcessingService.groupByMonth(combinedData) : [];
  const seasonalData = combinedData.length > 0 ? DataProcessingService.groupBySeason(combinedData) : [];
  const tempRanges = combinedData.length > 0 ? DataProcessingService.findOptimalTempRanges(combinedData) : [];

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-[1600px] mx-auto">
        {/* Header */}
        <header className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-2 drop-shadow-lg">
            Pest Control Weather Dashboard
          </h1>
          <p className="text-white/90 text-lg">
            {location} • Weather Analytics & Lead Correlation
          </p>
          {currentWeather && (
            <p className="text-white/70 text-sm mt-2">
              Last updated: {new Date().toLocaleString()}
            </p>
          )}
        </header>

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-100 border border-red-300 rounded-lg text-red-800">
            <p className="font-semibold">Error:</p>
            <p>{error}</p>
          </div>
        )}

        {/* Current Weather */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
            <p className="text-white mt-4">Loading weather data...</p>
          </div>
        ) : currentWeather ? (
          <WeatherCard title="Current Weather & Forecast">
            <CurrentWeatherDisplay weather={currentWeather} />
          </WeatherCard>
        ) : null}

        {/* Lead Data Upload */}
        <div className="mt-8">
          <WeatherCard title="Upload Lead Data">
            <p className="text-gray-600 mb-4">
              Upload a CSV or Excel file with columns: <strong>date, leads</strong> (optional: source, cost, conversions)
            </p>
            <FileUpload onDataParsed={handleLeadDataUpload} />
            
            {historicalLoading && (
              <div className="mt-4 text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <p className="text-gray-600 mt-4">Fetching historical weather data and calculating correlations...</p>
                <p className="text-sm text-gray-500 mt-2">This may take a moment for large datasets</p>
              </div>
            )}
          </WeatherCard>
        </div>

        {/* Statistics Overview */}
        {stats && leadData && (
          <div className="mt-8">
            <WeatherCard title="Data Overview">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <div className="text-center">
                  <p className="text-sm text-gray-600">Total Leads</p>
                  <p className="text-3xl font-bold text-primary">{stats.totalLeads.toLocaleString()}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-600">Avg Leads/Day</p>
                  <p className="text-3xl font-bold text-primary">{stats.avgLeads}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-600">Days Analyzed</p>
                  <p className="text-3xl font-bold text-primary">{stats.daysAnalyzed}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-600">Avg Temp</p>
                  <p className="text-3xl font-bold text-primary">{stats.avgTemp}°F</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-600">Avg Humidity</p>
                  <p className="text-3xl font-bold text-primary">{stats.avgHumidity}%</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-600">Date Range</p>
                  <p className="text-sm font-semibold text-gray-700 mt-2">
                    {new Date(leadData.startDate).toLocaleDateString()}
                    <br />to<br />
                    {new Date(leadData.endDate).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </WeatherCard>
          </div>
        )}

        {/* Top Correlations */}
        {topCorrelations.length > 0 && (
          <div className="mt-8">
            <WeatherCard title="Key Insights: Weather Impact on Leads">
              <TopCorrelations correlations={topCorrelations} />
            </WeatherCard>
          </div>
        )}

        {/* Time Series Charts */}
        {combinedData.length > 0 && (
          <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
            <WeatherCard title="Leads & Temperature Over Time">
              <TimeSeriesChart
                data={combinedData.map(d => ({
                  date: d.date,
                  leads: d.leads,
                  temperature: d.tempAvg,
                }))}
                title=""
                lines={[
                  { dataKey: 'leads', name: 'Leads', color: '#008a4e', yAxisId: 'left' },
                  { dataKey: 'temperature', name: 'Avg Temp (°F)', color: '#ef4444', yAxisId: 'right' },
                ]}
                showDualAxis={true}
              />
            </WeatherCard>

            <WeatherCard title="Leads & Humidity Over Time">
              <TimeSeriesChart
                data={combinedData.map(d => ({
                  date: d.date,
                  leads: d.leads,
                  humidity: d.humidity,
                }))}
                title=""
                lines={[
                  { dataKey: 'leads', name: 'Leads', color: '#008a4e', yAxisId: 'left' },
                  { dataKey: 'humidity', name: 'Humidity (%)', color: '#3b82f6', yAxisId: 'right' },
                ]}
                showDualAxis={true}
              />
            </WeatherCard>

            <WeatherCard title="Leads & Precipitation Over Time">
              <TimeSeriesChart
                data={combinedData.map(d => ({
                  date: d.date,
                  leads: d.leads,
                  precipitation: d.precipitation,
                }))}
                title=""
                lines={[
                  { dataKey: 'leads', name: 'Leads', color: '#008a4e', yAxisId: 'left' },
                  { dataKey: 'precipitation', name: 'Precipitation (in)', color: '#06b6d4', yAxisId: 'right' },
                ]}
                showDualAxis={true}
              />
            </WeatherCard>

            <WeatherCard title="Leads & UV Index Over Time">
              <TimeSeriesChart
                data={combinedData.map(d => ({
                  date: d.date,
                  leads: d.leads,
                  uvIndex: d.uvIndex,
                }))}
                title=""
                lines={[
                  { dataKey: 'leads', name: 'Leads', color: '#008a4e', yAxisId: 'left' },
                  { dataKey: 'uvIndex', name: 'UV Index', color: '#f59e0b', yAxisId: 'right' },
                ]}
                showDualAxis={true}
              />
            </WeatherCard>
          </div>
        )}

        {/* Correlation Matrix */}
        {correlations && (
          <div className="mt-8">
            <WeatherCard title="Correlation Matrix: All Weather Factors">
              <p className="text-sm text-gray-600 mb-4">
                Shows correlation between all weather metrics and lead volume. 
                Green = positive correlation, Red = negative correlation. 
                Values range from -1 (perfect negative) to +1 (perfect positive).
              </p>
              <CorrelationHeatmap matrix={correlations} />
            </WeatherCard>
          </div>
        )}

        {/* Seasonal Analysis */}
        {seasonalData.length > 0 && (
          <div className="mt-8">
            <WeatherCard title="Seasonal Analysis">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {seasonalData.map((season) => (
                  <div key={season.season} className="p-4 bg-gray-50 rounded-lg">
                    <h3 className="text-lg font-bold text-gray-800 mb-2">{season.season}</h3>
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs text-gray-600">Total Leads</p>
                        <p className="text-2xl font-bold text-primary">{season.leads.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Avg Leads/Day</p>
                        <p className="text-xl font-semibold text-gray-700">{season.avgLeads.toFixed(1)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Avg Temp</p>
                        <p className="text-xl font-semibold text-gray-700">{season.avgTemp.toFixed(1)}°F</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Days</p>
                        <p className="text-xl font-semibold text-gray-700">{season.days}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </WeatherCard>
          </div>
        )}

        {/* Optimal Temperature Ranges */}
        {tempRanges.length > 0 && (
          <div className="mt-8">
            <WeatherCard title="Optimal Temperature Ranges for Lead Generation">
              <p className="text-sm text-gray-600 mb-4">
                Temperature ranges ranked by average leads per day
              </p>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left p-3 font-semibold text-gray-700">Temperature Range</th>
                      <th className="text-right p-3 font-semibold text-gray-700">Total Leads</th>
                      <th className="text-right p-3 font-semibold text-gray-700">Avg Leads/Day</th>
                      <th className="text-right p-3 font-semibold text-gray-700">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tempRanges.slice(0, 10).map((range, index) => (
                      <tr key={range.tempRange} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="p-3">
                          <span className="font-semibold text-gray-800">{range.tempRange}</span>
                        </td>
                        <td className="text-right p-3 text-gray-700">{range.totalLeads.toLocaleString()}</td>
                        <td className="text-right p-3">
                          <span className="font-bold text-primary">{range.avgLeads.toFixed(1)}</span>
                        </td>
                        <td className="text-right p-3 text-gray-600">{range.days}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </WeatherCard>
          </div>
        )}

        {/* Google Trends */}
        <div className="mt-8">
          <WeatherCard title="Search Volume: Pest Control & Exterminator (Past 5 Years)">
            <GoogleTrends />
          </WeatherCard>
        </div>

        {/* Footer */}
        <footer className="mt-12 text-center text-white/70 text-sm pb-8">
          <p>Weather data provided by Visual Crossing Weather API</p>
          <p className="mt-2">Search trends data from Google Trends</p>
        </footer>
      </div>
    </div>
  );
}
