// Weather Data Types
export interface WeatherDay {
  datetime: string;
  tempmax: number;
  tempmin: number;
  temp: number;
  feelslike: number;
  humidity: number;
  precip: number;
  precipprob: number;
  preciptype?: string[];
  snow?: number;
  snowdepth?: number;
  windspeed: number;
  winddir: number;
  pressure: number;
  cloudcover: number;
  visibility: number;
  solarradiation?: number;
  solarenergy?: number;
  uvindex: number;
  sunrise: string;
  sunset: string;
  conditions: string;
  description?: string;
  icon?: string;
}

export interface CurrentConditions extends WeatherDay {
  datetimeEpoch: number;
}

export interface WeatherResponse {
  queryCost: number;
  latitude: number;
  longitude: number;
  resolvedAddress: string;
  address: string;
  timezone: string;
  tzoffset: number;
  days: WeatherDay[];
  currentConditions?: CurrentConditions;
}

// Lead Data Types
export interface LeadData {
  date: string; // YYYY-MM-DD format
  leads: number;
  source?: string;
  campaign?: string;
  cost?: number;
  conversions?: number;
}

export interface LeadDataset {
  data: LeadData[];
  startDate: string;
  endDate: string;
  totalLeads: number;
}

// Weather + Lead Combined Data
export interface WeatherLeadData {
  date: string;
  // Weather metrics
  tempHigh: number;
  tempLow: number;
  tempAvg: number;
  humidity: number;
  precipitation: number;
  precipProb: number;
  uvIndex: number;
  windSpeed: number;
  pressure: number;
  cloudCover: number;
  // Lead metrics
  leads: number;
  cost?: number;
  conversions?: number;
}

// Correlation Analysis Types
export interface CorrelationResult {
  metric1: string;
  metric2: string;
  correlation: number; // -1 to 1
  pValue: number;
  significant: boolean; // true if p < 0.05
  strength: 'very weak' | 'weak' | 'moderate' | 'strong' | 'very strong';
}

export interface CorrelationMatrix {
  metrics: string[];
  correlations: number[][];
  results: CorrelationResult[];
}

// Chart Data Types
export interface TimeSeriesData {
  date: string;
  [key: string]: number | string;
}

// Google Trends Types
export interface TrendsData {
  date: string;
  pestControl: number;
  exterminator: number;
}

// Dashboard State
export interface DashboardData {
  currentWeather?: WeatherResponse;
  historicalWeather: WeatherDay[];
  leads: LeadDataset;
  combinedData: WeatherLeadData[];
  correlations?: CorrelationMatrix;
  trendsData?: TrendsData[];
}
