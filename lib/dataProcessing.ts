import { LeadData, LeadDataset, WeatherDay, WeatherLeadData } from '@/types';
import { parse } from 'date-fns';

export class DataProcessingService {
  /**
   * Parse CSV/Excel lead data
   * Expected columns: date, leads, source (optional), cost (optional), conversions (optional)
   */
  static parseLeadData(rawData: any[]): LeadDataset {
    const parsedData = rawData
      .map(row => {
        // Try to parse the date in various formats
        let date: Date | null = null;
        const dateStr = row.date || row.Date || row.DATE;

        if (!dateStr) return null;

        try {
          // Try ISO format first
          date = new Date(dateStr);
          if (isNaN(date.getTime())) {
            // Try common US format
            date = parse(dateStr, 'MM/dd/yyyy', new Date());
          }
          if (isNaN(date.getTime())) {
            // Try other common formats
            date = parse(dateStr, 'yyyy-MM-dd', new Date());
          }
        } catch (e) {
          console.error('Failed to parse date:', dateStr);
          return null;
        }

        if (!date || isNaN(date.getTime())) return null;

        return {
          date: date.toISOString().split('T')[0],
          leads: Number(row.leads || row.Leads || row.LEADS || 0),
          source: row.source || row.Source,
          campaign: row.campaign || row.Campaign,
          cost: row.cost ? Number(row.cost) : undefined,
          conversions: row.conversions ? Number(row.conversions) : undefined,
        };
      })
      .filter(item => item !== null)
      .sort((a, b) => a!.date.localeCompare(b!.date)) as LeadData[];

    const totalLeads = parsedData.reduce((sum, item) => sum + item.leads, 0);
    const startDate = parsedData.length > 0 ? parsedData[0].date : '';
    const endDate = parsedData.length > 0 ? parsedData[parsedData.length - 1].date : '';

    return {
      data: parsedData,
      startDate,
      endDate,
      totalLeads,
    };
  }

  /**
   * Aggregate lead data by date (in case there are multiple entries per day)
   */
  static aggregateLeadsByDate(leadData: LeadData[]): LeadData[] {
    const aggregated = new Map<string, LeadData>();

    leadData.forEach(item => {
      const existing = aggregated.get(item.date);
      if (existing) {
        existing.leads += item.leads;
        if (item.cost) {
          existing.cost = (existing.cost || 0) + item.cost;
        }
        if (item.conversions) {
          existing.conversions = (existing.conversions || 0) + item.conversions;
        }
      } else {
        aggregated.set(item.date, { ...item });
      }
    });

    return Array.from(aggregated.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Combine weather and lead data
   */
  static combineWeatherAndLeads(
    weatherData: WeatherDay[],
    leadData: LeadData[]
  ): WeatherLeadData[] {
    const leadMap = new Map(leadData.map(item => [item.date, item]));
    
    return weatherData
      .map(weather => {
        const lead = leadMap.get(weather.datetime) || { date: weather.datetime, leads: 0 };
        
        return {
          date: weather.datetime,
          tempHigh: weather.tempmax,
          tempLow: weather.tempmin,
          tempAvg: weather.temp,
          humidity: weather.humidity,
          precipitation: weather.precip,
          precipProb: weather.precipprob,
          uvIndex: weather.uvindex,
          windSpeed: weather.windspeed,
          pressure: weather.pressure,
          cloudCover: weather.cloudcover,
          leads: lead.leads,
          cost: lead.cost,
          conversions: lead.conversions,
        };
      })
      .filter(item => item.date >= leadData[0]?.date && item.date <= leadData[leadData.length - 1]?.date);
  }

  /**
   * Calculate daily statistics
   */
  static calculateDailyStats(data: WeatherLeadData[]) {
    const totalLeads = data.reduce((sum, d) => sum + d.leads, 0);
    const avgLeads = totalLeads / data.length;
    const avgTemp = data.reduce((sum, d) => sum + d.tempAvg, 0) / data.length;
    const avgHumidity = data.reduce((sum, d) => sum + d.humidity, 0) / data.length;
    const totalPrecip = data.reduce((sum, d) => sum + d.precipitation, 0);

    return {
      totalLeads,
      avgLeads: Math.round(avgLeads * 10) / 10,
      avgTemp: Math.round(avgTemp * 10) / 10,
      avgHumidity: Math.round(avgHumidity * 10) / 10,
      totalPrecip: Math.round(totalPrecip * 100) / 100,
      daysAnalyzed: data.length,
    };
  }

  /**
   * Group data by month for monthly analysis
   */
  static groupByMonth(data: WeatherLeadData[]) {
    const grouped = new Map<string, WeatherLeadData[]>();

    data.forEach(item => {
      const month = item.date.substring(0, 7); // YYYY-MM
      if (!grouped.has(month)) {
        grouped.set(month, []);
      }
      grouped.get(month)!.push(item);
    });

    return Array.from(grouped.entries()).map(([month, items]) => ({
      month,
      leads: items.reduce((sum, d) => sum + d.leads, 0),
      avgTemp: items.reduce((sum, d) => sum + d.tempAvg, 0) / items.length,
      avgHumidity: items.reduce((sum, d) => sum + d.humidity, 0) / items.length,
      totalPrecip: items.reduce((sum, d) => sum + d.precipitation, 0),
      days: items.length,
    }));
  }

  /**
   * Group data by season
   */
  static groupBySeason(data: WeatherLeadData[]) {
    const seasons = {
      Spring: [] as WeatherLeadData[],
      Summer: [] as WeatherLeadData[],
      Fall: [] as WeatherLeadData[],
      Winter: [] as WeatherLeadData[],
    };

    data.forEach(item => {
      const month = parseInt(item.date.substring(5, 7));
      if (month >= 3 && month <= 5) seasons.Spring.push(item);
      else if (month >= 6 && month <= 8) seasons.Summer.push(item);
      else if (month >= 9 && month <= 11) seasons.Fall.push(item);
      else seasons.Winter.push(item);
    });

    return Object.entries(seasons).map(([season, items]) => ({
      season,
      leads: items.reduce((sum, d) => sum + d.leads, 0),
      avgLeads: items.length > 0 ? items.reduce((sum, d) => sum + d.leads, 0) / items.length : 0,
      avgTemp: items.length > 0 ? items.reduce((sum, d) => sum + d.tempAvg, 0) / items.length : 0,
      avgHumidity: items.length > 0 ? items.reduce((sum, d) => sum + d.humidity, 0) / items.length : 0,
      days: items.length,
    }));
  }

  /**
   * Find temperature ranges with highest lead volume
   */
  static findOptimalTempRanges(data: WeatherLeadData[], bucketSize: number = 5) {
    const buckets = new Map<number, { leads: number; count: number }>();

    data.forEach(item => {
      const bucket = Math.floor(item.tempAvg / bucketSize) * bucketSize;
      const existing = buckets.get(bucket) || { leads: 0, count: 0 };
      existing.leads += item.leads;
      existing.count += 1;
      buckets.set(bucket, existing);
    });

    return Array.from(buckets.entries())
      .map(([temp, data]) => ({
        tempRange: `${temp}-${temp + bucketSize}°F`,
        totalLeads: data.leads,
        avgLeads: data.leads / data.count,
        days: data.count,
      }))
      .sort((a, b) => b.avgLeads - a.avgLeads);
  }
}
