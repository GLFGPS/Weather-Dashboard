import { WeatherResponse, WeatherDay } from '@/types';

const API_KEY = process.env.NEXT_PUBLIC_WEATHER_API_KEY;
const BASE_URL = 'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline';

export class WeatherService {
  /**
   * Fetch current weather and forecast
   */
  static async getCurrentWeather(location: string): Promise<WeatherResponse> {
    const today = new Date().toISOString().split('T')[0];
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const future = futureDate.toISOString().split('T')[0];

    const url = `${BASE_URL}/${encodeURIComponent(location)}/${today}/${future}?unitGroup=us&include=current&key=${API_KEY}&contentType=json`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Fetch historical weather data for a specific date
   */
  static async getHistoricalWeather(location: string, date: string): Promise<WeatherDay> {
    const url = `${BASE_URL}/${encodeURIComponent(location)}/${date}?unitGroup=us&key=${API_KEY}&contentType=json`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status} ${response.statusText}`);
    }

    const data: WeatherResponse = await response.json();
    return data.days[0];
  }

  /**
   * Fetch historical weather data for a date range
   */
  static async getHistoricalWeatherRange(
    location: string,
    startDate: string,
    endDate: string
  ): Promise<WeatherDay[]> {
    const url = `${BASE_URL}/${encodeURIComponent(location)}/${startDate}/${endDate}?unitGroup=us&key=${API_KEY}&contentType=json`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status} ${response.statusText}`);
    }

    const data: WeatherResponse = await response.json();
    return data.days;
  }

  /**
   * Fetch 5 years of historical data for the same date/period
   * This is useful for year-over-year comparisons
   */
  static async getFiveYearHistorical(
    location: string,
    monthDay: string // format: "MM-DD"
  ): Promise<WeatherDay[]> {
    const currentYear = new Date().getFullYear();
    const promises: Promise<WeatherDay>[] = [];

    for (let i = 0; i < 5; i++) {
      const year = currentYear - i;
      const date = `${year}-${monthDay}`;
      promises.push(this.getHistoricalWeather(location, date));
    }

    const results = await Promise.allSettled(promises);
    return results
      .filter((result): result is PromiseFulfilledResult<WeatherDay> => result.status === 'fulfilled')
      .map(result => result.value);
  }

  /**
   * Fetch all historical data for the past N years
   * Note: This can be expensive on API quota
   */
  static async getMultiYearHistorical(
    location: string,
    years: number = 5
  ): Promise<WeatherDay[]> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);

    // Visual Crossing API has a limit on date range per request
    // We'll break it into yearly chunks to avoid issues
    const allData: WeatherDay[] = [];
    const currentYear = endDate.getFullYear();

    for (let i = 0; i < years; i++) {
      const yearStart = new Date(startDate);
      yearStart.setFullYear(currentYear - i, 0, 1);
      const yearEnd = new Date(startDate);
      yearEnd.setFullYear(currentYear - i, 11, 31);

      // Don't go beyond today
      if (yearEnd > endDate) {
        yearEnd.setTime(endDate.getTime());
      }

      const yearStartStr = yearStart.toISOString().split('T')[0];
      const yearEndStr = yearEnd.toISOString().split('T')[0];

      try {
        const yearData = await this.getHistoricalWeatherRange(location, yearStartStr, yearEndStr);
        allData.push(...yearData);
      } catch (error) {
        console.error(`Error fetching data for ${yearStartStr} to ${yearEndStr}:`, error);
      }

      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return allData;
  }
}
