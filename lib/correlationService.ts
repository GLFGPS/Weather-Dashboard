import { WeatherLeadData, CorrelationResult, CorrelationMatrix } from '@/types';

export class CorrelationService {
  /**
   * Calculate Pearson correlation coefficient
   */
  static pearsonCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) {
      throw new Error('Arrays must have the same non-zero length');
    }

    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    if (denominator === 0) return 0;

    return numerator / denominator;
  }

  /**
   * Calculate statistical significance (p-value approximation)
   * Using t-statistic for correlation
   */
  static calculatePValue(r: number, n: number): number {
    if (n < 3) return 1;

    const t = r * Math.sqrt((n - 2) / (1 - r * r));
    const df = n - 2;

    // Simplified p-value approximation
    // For a more accurate calculation, you'd use a t-distribution table
    const pValue = 2 * (1 - this.tCDF(Math.abs(t), df));
    return Math.min(pValue, 1);
  }

  /**
   * Simplified t-distribution CDF approximation
   */
  private static tCDF(t: number, df: number): number {
    // Very rough approximation - good enough for demonstration
    const x = df / (df + t * t);
    return 1 - 0.5 * Math.pow(x, df / 2);
  }

  /**
   * Categorize correlation strength
   */
  static categorizeStrength(r: number): 'very weak' | 'weak' | 'moderate' | 'strong' | 'very strong' {
    const absR = Math.abs(r);
    if (absR < 0.2) return 'very weak';
    if (absR < 0.4) return 'weak';
    if (absR < 0.6) return 'moderate';
    if (absR < 0.8) return 'strong';
    return 'very strong';
  }

  /**
   * Calculate correlation between two metrics across the dataset
   */
  static calculateCorrelation(
    data: WeatherLeadData[],
    metric1: keyof WeatherLeadData,
    metric2: keyof WeatherLeadData
  ): CorrelationResult {
    const x = data.map(d => Number(d[metric1])).filter(v => !isNaN(v));
    const y = data.map(d => Number(d[metric2])).filter(v => !isNaN(v));

    const correlation = this.pearsonCorrelation(x, y);
    const pValue = this.calculatePValue(correlation, x.length);
    const significant = pValue < 0.05;
    const strength = this.categorizeStrength(correlation);

    return {
      metric1: metric1 as string,
      metric2: metric2 as string,
      correlation,
      pValue,
      significant,
      strength,
    };
  }

  /**
   * Calculate full correlation matrix
   */
  static calculateCorrelationMatrix(data: WeatherLeadData[]): CorrelationMatrix {
    const metrics: (keyof WeatherLeadData)[] = [
      'tempHigh',
      'tempLow',
      'tempAvg',
      'humidity',
      'precipitation',
      'precipProb',
      'uvIndex',
      'windSpeed',
      'pressure',
      'cloudCover',
      'leads',
    ];

    const metricNames = metrics.map(m => m as string);
    const n = metrics.length;
    const correlations: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
    const results: CorrelationResult[] = [];

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          correlations[i][j] = 1;
        } else if (i < j) {
          const result = this.calculateCorrelation(data, metrics[i], metrics[j]);
          correlations[i][j] = result.correlation;
          correlations[j][i] = result.correlation;
          results.push(result);
        }
      }
    }

    return {
      metrics: metricNames,
      correlations,
      results: results.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)),
    };
  }

  /**
   * Find top correlations with leads
   */
  static findTopLeadCorrelations(matrix: CorrelationMatrix, topN: number = 5): CorrelationResult[] {
    return matrix.results
      .filter(r => r.metric1 === 'leads' || r.metric2 === 'leads')
      .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
      .slice(0, topN);
  }

  /**
   * Calculate moving average for time series smoothing
   */
  static movingAverage(data: number[], window: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < data.length; i++) {
      const start = Math.max(0, i - Math.floor(window / 2));
      const end = Math.min(data.length, i + Math.ceil(window / 2));
      const slice = data.slice(start, end);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      result.push(avg);
    }
    return result;
  }

  /**
   * Calculate seasonal decomposition (simplified)
   * Returns trend, seasonal, and residual components
   */
  static seasonalDecomposition(data: number[], period: number = 365) {
    // Simple seasonal decomposition
    const n = data.length;
    const trend = this.movingAverage(data, period);
    const detrended = data.map((val, i) => val - trend[i]);
    
    // Calculate seasonal component
    const seasonal: number[] = Array(n).fill(0);
    const seasonalSums: number[] = Array(period).fill(0);
    const seasonalCounts: number[] = Array(period).fill(0);

    detrended.forEach((val, i) => {
      const seasonIdx = i % period;
      seasonalSums[seasonIdx] += val;
      seasonalCounts[seasonIdx]++;
    });

    const seasonalAvg = seasonalSums.map((sum, i) => sum / seasonalCounts[i]);

    data.forEach((_, i) => {
      seasonal[i] = seasonalAvg[i % period];
    });

    const residual = data.map((val, i) => val - trend[i] - seasonal[i]);

    return { trend, seasonal, residual };
  }
}
