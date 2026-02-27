"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const FALLBACK_MARKETS = [
  "West Chester,PA",
  "North Wales,PA",
  "Hillsborough Township,NJ",
  "Lindenwold,NJ",
];

const FOURTH_METRIC_OPTIONS = [
  { key: "avgSnowDepth", label: "Avg Snow Depth", unit: "in", digits: 2 },
  { key: "avgPrecip", label: "Avg Precipitation", unit: "in", digits: 2 },
  { key: "avgHumidity", label: "Avg Humidity", unit: "%", digits: 0 },
  { key: "avgSnowfall", label: "Avg Snowfall", unit: "in", digits: 2 },
  { key: "snowDays", label: "Snow Days", unit: "days", digits: 1 },
];

const CHART_MODES = [
  { value: "overlay", label: "Overlay Years" },
  { value: "side", label: "Side by Side" },
  { value: "toggle", label: "Year Toggle" },
];

const WEATHER_LINE_OPTIONS = [
  { key: "avgTempMax", label: "Avg Temp Max" },
  { key: "avgUv", label: "Avg UV" },
  { key: "avgSnowDepth", label: "Avg Snow Depth" },
];

const LAG_METRIC_OPTIONS = [
  { key: "avgTempMax", label: "Avg Temp Max" },
  { key: "avgUv", label: "Avg UV" },
  { key: "avgSnowDepth", label: "Avg Snow Depth" },
];

const CHART_COLORS = ["#118257", "#1f4f86", "#8a5cf5", "#f08a24", "#da3f5f", "#0f766e"];

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return Number(value).toFixed(digits);
}

function formatTemp(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `${Number(value).toFixed(digits)}°F`;
}

function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `${Number(value).toFixed(digits)}%`;
}

function marketLabel(market) {
  if (!market) return "";
  return market.label || market.name || market.id || "";
}

function formatDateLabel(value) {
  if (!value) return "--";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatYoY(metric, digits = 1, suffix = "", label = "YoY") {
  if (!metric) {
    return { current: "--", delta: `${label}: --` };
  }

  const current =
    metric.current === null || metric.current === undefined
      ? "--"
      : `${Number(metric.current).toFixed(digits)}${suffix}`;
  const delta =
    metric.delta === null || metric.delta === undefined
      ? "--"
      : `${metric.delta >= 0 ? "+" : ""}${Number(metric.delta).toFixed(digits)}${suffix}`;

  return {
    current,
    delta: `${label}: ${delta}`,
  };
}

function compactDelta(metric, digits = 1, suffix = "", label = "YoY") {
  return formatYoY(metric, digits, suffix, label).delta.replace(/^[^:]+:\s*/, "");
}

function chartColor(index) {
  return CHART_COLORS[index % CHART_COLORS.length];
}

function nextFiftyAbove(value) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  return (Math.floor(safeValue / 50) + 1) * 50;
}

export default function HomePage() {
  const [markets, setMarkets] = useState([]);
  const [selectedMarket, setSelectedMarket] = useState(FALLBACK_MARKETS[0]);
  const [showAllLocations, setShowAllLocations] = useState(false);

  const [analysisDate, setAnalysisDate] = useState("");
  const [trendStartDate, setTrendStartDate] = useState("");
  const [trendEndDate, setTrendEndDate] = useState("");
  const [selectedYear, setSelectedYear] = useState(null);
  const [compareYears, setCompareYears] = useState([]);
  const [sourceFilter, setSourceFilter] = useState("All Sources");
  const [chartMode, setChartMode] = useState("overlay");
  const [toggleYear, setToggleYear] = useState(null);
  const [tableYear, setTableYear] = useState(null);
  const [weatherLineMetric, setWeatherLineMetric] = useState("avgTempMax");
  const [lagMetric, setLagMetric] = useState("avgTempMax");
  const [fourthMetricKey, setFourthMetricKey] = useState("avgSnowDepth");

  const [marketWeather, setMarketWeather] = useState(null);
  const [selectedWeather, setSelectedWeather] = useState(null);
  const [leadsOverview, setLeadsOverview] = useState(null);

  const [loadingMarkets, setLoadingMarkets] = useState(true);
  const [loadingMarketWeather, setLoadingMarketWeather] = useState(true);
  const [loadingSelectedWeather, setLoadingSelectedWeather] = useState(true);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [loadingPriorityForecast, setLoadingPriorityForecast] = useState(true);

  const [marketsError, setMarketsError] = useState("");
  const [weatherError, setWeatherError] = useState("");
  const [selectedWeatherError, setSelectedWeatherError] = useState("");
  const [leadsError, setLeadsError] = useState("");
  const [priorityForecastError, setPriorityForecastError] = useState("");

  const [forecastWindowDays, setForecastWindowDays] = useState(15);
  const [forecastScope, setForecastScope] = useState("blend");
  const [priorityForecast, setPriorityForecast] = useState(null);

  const [question, setQuestion] = useState("");
  const [chatAnswer, setChatAnswer] = useState("");
  const [chatError, setChatError] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const fourthMetric = useMemo(
    () =>
      FOURTH_METRIC_OPTIONS.find((option) => option.key === fourthMetricKey) ||
      FOURTH_METRIC_OPTIONS[0],
    [fourthMetricKey],
  );

  const locationOptions = useMemo(() => {
    if (!markets.length) {
      return FALLBACK_MARKETS.map((value) => ({ value, label: value }));
    }
    return markets
      .map((market) => ({ value: market.name, label: marketLabel(market) }))
      .filter((row) => row.value);
  }, [markets]);

  const availableYears = leadsOverview?.availableYears || [];
  const sourceOptions = leadsOverview?.sourceOptions || ["All Sources"];
  const chartSeries = leadsOverview?.yearSeries || [];
  const compareYearsForRequest = useMemo(() => {
    const merged = new Set(compareYears);
    if (tableYear) merged.add(tableYear);
    return [...merged].sort((a, b) => a - b);
  }, [compareYears, tableYear]);

  const displaySeries = useMemo(() => {
    if (!compareYears.length) return chartSeries;
    const selected = new Set(compareYears);
    const filtered = chartSeries.filter((series) => selected.has(series.year));
    return filtered.length ? filtered : chartSeries;
  }, [chartSeries, compareYears]);

  const selectedSeries =
    chartSeries.find((series) => series.year === selectedYear) || chartSeries[0] || null;
  const trendWindow = selectedSeries?.seasonWindow || leadsOverview?.seasonWindow || null;
  const rangeStart = trendStartDate || trendWindow?.start || "";
  const rangeEnd = trendEndDate || trendWindow?.end || "";

  function isWithinTrendRange(dateValue) {
    if (!dateValue) return false;
    if (rangeStart && dateValue < rangeStart) return false;
    if (rangeEnd && dateValue > rangeEnd) return false;
    return true;
  }

  const displaySeriesFiltered = useMemo(
    () =>
      displaySeries.map((series) => ({
        ...series,
        points: (series.points || []).filter((point) => isWithinTrendRange(point.date)),
      })),
    [displaySeries, rangeStart, rangeEnd],
  );

  const tableSeries =
    chartSeries.find((series) => series.year === tableYear) ||
    selectedSeries ||
    chartSeries[0] ||
    null;
  const tablePoints = useMemo(
    () => (tableSeries?.points || []).filter((point) => isWithinTrendRange(point.date)),
    [tableSeries, rangeStart, rangeEnd],
  );
  const sharedLeadAxisMax = useMemo(() => {
    const maxLead = displaySeriesFiltered.reduce((runningMax, series) => {
      const seriesMax = Math.max(
        ...(series.points || []).map((point) => {
          const leads = Number(point.filteredLeads);
          return Number.isFinite(leads) ? leads : 0;
        }),
        0,
      );
      return Math.max(runningMax, seriesMax);
    }, 0);
    return Math.max(50, nextFiftyAbove(maxLead));
  }, [displaySeriesFiltered]);

  const maxDailyLead = Math.max(...tablePoints.map((row) => row.filteredLeads), 0);
  const insights = leadsOverview?.insights || {};
  const conditionMatrix = insights.conditionMatrix || [];
  const lagEffect = insights.lagEffect || { lags: [], bestByMetric: {} };
  const goalTracking = insights.goalTracking || null;

  const goalTrackingData = goalTracking?.points || [];
  const goalAxisMax = useMemo(() => {
    const highest = Math.max(
      ...goalTrackingData.map((point) =>
        Math.max(
          Number(point.actualLeads) || 0,
          Number(point.expectedLeads) || 0,
          Number(point.upperBand) || 0,
        ),
      ),
      0,
    );
    return Math.max(50, nextFiftyAbove(highest));
  }, [goalTrackingData]);

  const lagChartData = useMemo(
    () =>
      (lagEffect?.lags || []).map((row) => ({
        lag: row.lag,
        correlation: row?.[lagMetric]?.correlation ?? null,
        sampleSize: row?.[lagMetric]?.sampleSize ?? 0,
      })),
    [lagEffect, lagMetric],
  );
  const lagBest = lagEffect?.bestByMetric?.[lagMetric] || null;
  const forecastMarketOptions = useMemo(() => {
    const options = [{ value: "blend", label: "Priority Blend (4 Markets)" }];
    for (const row of priorityForecast?.marketForecasts || []) {
      options.push({
        value: row.marketName,
        label: row.marketLabel || row.marketName,
      });
    }
    return options;
  }, [priorityForecast]);
  const selectedForecastMarket =
    (priorityForecast?.marketForecasts || []).find((row) => row.marketName === forecastScope) ||
    null;
  const forecastPoints =
    forecastScope === "blend"
      ? priorityForecast?.forecast || []
      : selectedForecastMarket?.forecast || [];
  const forecastScopeLabel =
    forecastScope === "blend"
      ? "Averaged across West Chester, North Wales, Hillsborough, and Lindenwold."
      : `Showing ${selectedForecastMarket?.marketLabel || selectedForecastMarket?.marketName || "selected market"} only.`;
  const forecastSummary = useMemo(() => {
    if (!forecastPoints.length) {
      return {
        avgMax: null,
        avgMin: null,
        avgPrecipProb: null,
        avgSnowDepth: null,
      };
    }
    const values = forecastPoints.reduce(
      (acc, point) => {
        if (Number.isFinite(Number(point.avgTempMax))) acc.max.push(Number(point.avgTempMax));
        if (Number.isFinite(Number(point.avgTempMin))) acc.min.push(Number(point.avgTempMin));
        if (Number.isFinite(Number(point.avgPrecipProb)))
          acc.precipProb.push(Number(point.avgPrecipProb));
        if (Number.isFinite(Number(point.avgSnowDepth)))
          acc.snowDepth.push(Number(point.avgSnowDepth));
        return acc;
      },
      { max: [], min: [], precipProb: [], snowDepth: [] },
    );
    const avg = (input) =>
      input.length ? input.reduce((sum, value) => sum + value, 0) / input.length : null;
    return {
      avgMax: avg(values.max),
      avgMin: avg(values.min),
      avgPrecipProb: avg(values.precipProb),
      avgSnowDepth: avg(values.snowDepth),
    };
  }, [forecastPoints]);

  useEffect(() => {
    if (!forecastMarketOptions.some((option) => option.value === forecastScope)) {
      setForecastScope("blend");
    }
  }, [forecastMarketOptions, forecastScope]);

  useEffect(() => {
    if (!locationOptions.length) return;
    if (!locationOptions.some((option) => option.value === selectedMarket)) {
      setSelectedMarket(locationOptions[0].value);
    }
  }, [locationOptions, selectedMarket]);

  useEffect(() => {
    let active = true;
    async function loadMarkets() {
      setLoadingMarkets(true);
      setMarketsError("");
      try {
        const response = await fetch("/api/markets", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load markets.");
        if (!active) return;
        setMarkets(Array.isArray(payload.markets) ? payload.markets : []);
      } catch (error) {
        if (active) setMarketsError(error.message);
      } finally {
        if (active) setLoadingMarkets(false);
      }
    }
    loadMarkets();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadLeadsOverview() {
      setLoadingLeads(true);
      setLeadsError("");
      try {
        const params = new URLSearchParams();
        if (selectedYear) params.set("year", String(selectedYear));
        if (sourceFilter) params.set("source", sourceFilter);
        if (compareYearsForRequest.length) {
          params.set("compareYears", compareYearsForRequest.join(","));
        }
        const response = await fetch(`/api/leads/overview?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load leads overview.");
        if (!active) return;
        setLeadsOverview(payload);

        if (!selectedYear && payload.selectedYear) {
          setSelectedYear(payload.selectedYear);
        }

        if (!compareYears.length && Array.isArray(payload.selectedCompareYears)) {
          setCompareYears(payload.selectedCompareYears);
        }

        if (!analysisDate && payload?.seasonWindow?.end) {
          setAnalysisDate(payload.seasonWindow.end);
        } else if (analysisDate && payload?.seasonWindow) {
          if (analysisDate < payload.seasonWindow.start) {
            setAnalysisDate(payload.seasonWindow.start);
          } else if (analysisDate > payload.seasonWindow.end) {
            setAnalysisDate(payload.seasonWindow.end);
          }
        }

        if (!toggleYear && payload.selectedYear) {
          setToggleYear(payload.selectedYear);
        }

        if (!tableYear && payload.selectedYear) {
          setTableYear(payload.selectedYear);
        }
      } catch (error) {
        if (active) setLeadsError(error.message);
      } finally {
        if (active) setLoadingLeads(false);
      }
    }

    loadLeadsOverview();
    return () => {
      active = false;
    };
  }, [selectedYear, sourceFilter, compareYearsForRequest]);

  useEffect(() => {
    if (!analysisDate) return;
    let active = true;
    async function loadMarketWeather() {
      setLoadingMarketWeather(true);
      setWeatherError("");
      try {
        const params = new URLSearchParams({
          mode: showAllLocations ? "all" : "priority",
          analysisDate,
          includeMarket: selectedMarket,
        });
        const response = await fetch(`/api/weather/markets?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load market weather.");
        if (active) setMarketWeather(payload);
      } catch (error) {
        if (active) setWeatherError(error.message);
      } finally {
        if (active) setLoadingMarketWeather(false);
      }
    }
    loadMarketWeather();
    return () => {
      active = false;
    };
  }, [analysisDate, showAllLocations, selectedMarket]);

  useEffect(() => {
    let active = true;
    async function loadPriorityForecast() {
      setLoadingPriorityForecast(true);
      setPriorityForecastError("");
      try {
        const params = new URLSearchParams({
          days: String(forecastWindowDays),
        });
        const response = await fetch(`/api/weather/priority-forecast?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load blended forecast.");
        }
        if (active) setPriorityForecast(payload);
      } catch (error) {
        if (active) setPriorityForecastError(error.message);
      } finally {
        if (active) setLoadingPriorityForecast(false);
      }
    }

    loadPriorityForecast();
    return () => {
      active = false;
    };
  }, [forecastWindowDays]);

  useEffect(() => {
    if (!analysisDate || !selectedMarket) return;
    let active = true;
    async function loadSelectedWeather() {
      setLoadingSelectedWeather(true);
      setSelectedWeatherError("");
      try {
        const params = new URLSearchParams({
          location: selectedMarket,
          analysisDate,
          lookbackDays: "30",
        });
        const response = await fetch(`/api/weather?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load selected market weather.");
        }
        if (active) setSelectedWeather(payload);
      } catch (error) {
        if (active) setSelectedWeatherError(error.message);
      } finally {
        if (active) setLoadingSelectedWeather(false);
      }
    }
    loadSelectedWeather();
    return () => {
      active = false;
    };
  }, [selectedMarket, analysisDate]);

  function toggleCompareYear(year) {
    setCompareYears((prev) => {
      if (prev.includes(year)) {
        const next = prev.filter((value) => value !== year);
        return next.length ? next : prev;
      }
      return [...prev, year].sort((a, b) => a - b);
    });
  }

  useEffect(() => {
    if (!availableYears.length) return;
    if (!tableYear || !availableYears.includes(tableYear)) {
      setTableYear(selectedYear || availableYears[availableYears.length - 1]);
    }
  }, [availableYears, tableYear, selectedYear]);

  useEffect(() => {
    if (!trendWindow?.start || !trendWindow?.end) return;
    setTrendStartDate((prev) => {
      if (!prev || prev < trendWindow.start || prev > trendWindow.end) {
        return trendWindow.start;
      }
      return prev;
    });
    setTrendEndDate((prev) => {
      if (!prev || prev > trendWindow.end || prev < trendWindow.start) {
        return trendWindow.end;
      }
      return prev;
    });
  }, [trendWindow?.start, trendWindow?.end, selectedYear]);

  useEffect(() => {
    if (!displaySeriesFiltered.length) return;
    if (!toggleYear || !displaySeriesFiltered.some((series) => series.year === toggleYear)) {
      setToggleYear(displaySeriesFiltered[0].year);
    }
  }, [displaySeriesFiltered, toggleYear]);

  async function askCopilot(event) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;

    setChatLoading(true);
    setChatError("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          weatherContext: {
            radar: marketWeather,
            selectedMarket: selectedWeather,
          },
          analysisContext: { leads: leadsOverview },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Chat request failed.");
      setChatAnswer(payload.answer || "");
    } catch (error) {
      setChatError(error.message);
    } finally {
      setChatLoading(false);
    }
  }

  function handleTrendStartChange(value) {
    setTrendStartDate(value);
    if (trendEndDate && value > trendEndDate) {
      setTrendEndDate(value);
    }
  }

  function handleTrendEndChange(value) {
    setTrendEndDate(value);
    if (trendStartDate && value < trendStartDate) {
      setTrendStartDate(value);
    }
  }

  const overlayData = useMemo(() => {
    const map = new Map();
    for (const series of displaySeriesFiltered) {
      for (const point of series.points || []) {
        const row = map.get(point.dayKey) || { dayKey: point.dayKey };
        row[`leads_${series.year}`] = point.filteredLeads;
        row[`weather_avgTempMax_${series.year}`] = point.weather?.avgTempMax ?? null;
        row[`weather_avgUv_${series.year}`] = point.weather?.avgUv ?? null;
        row[`weather_avgSnowDepth_${series.year}`] = point.weather?.avgSnowDepth ?? null;
        map.set(point.dayKey, row);
      }
    }
    return [...map.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  }, [displaySeriesFiltered]);

  const selectedRadarMarket =
    (marketWeather?.markets || []).find((market) => market.name === selectedMarket) || null;
  const yoyCards = selectedRadarMarket?.yoy || marketWeather?.overview?.yoyCards || {};
  const weatherComparisonLabel =
    selectedRadarMarket?.comparisonLabel || marketWeather?.overview?.comparisonLabel || "vs 5Y Avg";
  const metricCard4 = yoyCards[fourthMetric.key] || null;
  const toggleSeries =
    displaySeriesFiltered.find((series) => series.year === Number(toggleYear)) ||
    displaySeriesFiltered[0] ||
    null;

  return (
    <main className="analysis-page">
      <header className="analysis-header">
        <h1>Weather Analysis</h1>
      </header>

      <section className="top-grid">
        <article className="panel">
          <h2>Filters</h2>
          <div className="filter-grid">
            <label>
              Year
              <select
                value={selectedYear || ""}
                onChange={(event) => setSelectedYear(Number(event.target.value))}
                disabled={!availableYears.length}
              >
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Date
              <input
                type="date"
                value={analysisDate}
                min={leadsOverview?.seasonWindow?.start || undefined}
                max={leadsOverview?.seasonWindow?.end || undefined}
                onChange={(event) => setAnalysisDate(event.target.value)}
                disabled={!analysisDate}
              />
            </label>

            <label>
              Selected Market
              <select
                value={selectedMarket}
                onChange={(event) => setSelectedMarket(event.target.value)}
                disabled={loadingMarkets}
              >
                {locationOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="filter-actions">
            <button type="button" onClick={() => setShowAllLocations((value) => !value)}>
              {showAllLocations ? "Show Key Locations" : "View All Locations"}
            </button>
            <p className="subtle">
              Market radar values are rolling 7-day averages ending on selected date.
            </p>
          </div>
        </article>

        <article className="panel">
          <h2>
            Selected Market Day Snapshot ({formatDateLabel(selectedWeather?.analysisDate || analysisDate)})
          </h2>
          {loadingSelectedWeather ? (
            <p>Loading selected market...</p>
          ) : (
            <ul className="metric-list">
              <li>
                <span>Conditions</span>
                <strong>{selectedWeather?.selectedDay?.conditions || "--"}</strong>
              </li>
              <li>
                <span>Max Temp</span>
                <strong>{formatTemp(selectedWeather?.selectedDay?.tempmax, 0)}</strong>
              </li>
              <li>
                <span>Min Temp</span>
                <strong>{formatTemp(selectedWeather?.selectedDay?.tempmin, 0)}</strong>
              </li>
              <li>
                <span>UV</span>
                <strong>{formatNumber(selectedWeather?.selectedDay?.uvindex, 1)}</strong>
              </li>
              <li>
                <span>Snow Depth</span>
                <strong>{formatNumber(selectedWeather?.selectedDay?.snowdepth, 2)} in</strong>
              </li>
              <li>
                <span>Precip</span>
                <strong>{formatNumber(selectedWeather?.selectedDay?.precip, 2)} in</strong>
              </li>
            </ul>
          )}
        </article>
      </section>

      {(marketsError || weatherError || selectedWeatherError || leadsError || priorityForecastError) && (
        <section>
          {marketsError && <p className="error">{marketsError}</p>}
          {weatherError && <p className="error">{weatherError}</p>}
          {selectedWeatherError && <p className="error">{selectedWeatherError}</p>}
          {leadsError && <p className="error">{leadsError}</p>}
          {priorityForecastError && <p className="error">{priorityForecastError}</p>}
        </section>
      )}

      <section className="kpi-grid">
        <article className="kpi-card">
          <h3>Avg Max Temp ({weatherComparisonLabel})</h3>
          <p className="kpi-value">
            {formatYoY(yoyCards.avgMaxTemp, 1, "°F", weatherComparisonLabel).current}
          </p>
          <p className="kpi-delta">
            {formatYoY(yoyCards.avgMaxTemp, 1, "°F", weatherComparisonLabel).delta}
          </p>
        </article>

        <article className="kpi-card">
          <h3>Avg Min Temp ({weatherComparisonLabel})</h3>
          <p className="kpi-value">
            {formatYoY(yoyCards.avgMinTemp, 1, "°F", weatherComparisonLabel).current}
          </p>
          <p className="kpi-delta">
            {formatYoY(yoyCards.avgMinTemp, 1, "°F", weatherComparisonLabel).delta}
          </p>
        </article>

        <article className="kpi-card">
          <h3>Avg UV ({weatherComparisonLabel})</h3>
          <p className="kpi-value">{formatYoY(yoyCards.avgUv, 1, "", weatherComparisonLabel).current}</p>
          <p className="kpi-delta">{formatYoY(yoyCards.avgUv, 1, "", weatherComparisonLabel).delta}</p>
        </article>

        <article className="kpi-card">
          <div className="kpi-header-inline">
            <h3>
              {fourthMetric.label} ({weatherComparisonLabel})
            </h3>
            <select
              value={fourthMetric.key}
              onChange={(event) => setFourthMetricKey(event.target.value)}
            >
              {FOURTH_METRIC_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <p className="kpi-value">
            {formatYoY(
              metricCard4,
              fourthMetric.digits,
              ` ${fourthMetric.unit}`,
              weatherComparisonLabel,
            ).current}
          </p>
          <p className="kpi-delta">
            {formatYoY(
              metricCard4,
              fourthMetric.digits,
              ` ${fourthMetric.unit}`,
              weatherComparisonLabel,
            ).delta}
          </p>
        </article>
      </section>

      <section className="panel">
        <div className="trend-header">
          <h2>Priority Market Forecast Blend</h2>
          <div className="forecast-controls">
            <label>
              Forecast View
              <select
                value={forecastScope}
                onChange={(event) => setForecastScope(event.target.value)}
              >
                {forecastMarketOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="forecast-window-toggle">
              {[3, 7, 15].map((days) => (
                <button
                  key={days}
                  type="button"
                  className={forecastWindowDays === days ? "active" : ""}
                  onClick={() => setForecastWindowDays(days)}
                >
                  {days} Day
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="subtle">
          {forecastScopeLabel}
        </p>
        {loadingPriorityForecast ? (
          <p>Loading blended forecast...</p>
        ) : (
          <>
            <div className="forecast-summary-grid">
              <article className="forecast-mini-card">
                <span>Avg Max Temp</span>
                <strong>{formatTemp(forecastSummary.avgMax, 0)}</strong>
              </article>
              <article className="forecast-mini-card">
                <span>Avg Min Temp</span>
                <strong>{formatTemp(forecastSummary.avgMin, 0)}</strong>
              </article>
              <article className="forecast-mini-card">
                <span>Avg Precip Prob</span>
                <strong>{formatPercent(forecastSummary.avgPrecipProb, 0)}</strong>
              </article>
              <article className="forecast-mini-card">
                <span>Avg Snow Depth</span>
                <strong>{formatNumber(forecastSummary.avgSnowDepth, 2)} in</strong>
              </article>
            </div>

            <div className="chart-wrap forecast-chart-wrap">
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={forecastPoints}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="dayLabel" />
                  <YAxis yAxisId="temp" />
                  <YAxis yAxisId="precipProb" orientation="right" />
                  <Tooltip />
                  <Legend />
                  <Line
                    yAxisId="temp"
                    type="monotone"
                    dataKey="avgTempMax"
                    name="Avg Temp Max"
                    stroke="#1f4f86"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="temp"
                    type="monotone"
                    dataKey="avgTempMin"
                    name="Avg Temp Min"
                    stroke="#118257"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Bar
                    yAxisId="precipProb"
                    dataKey="avgPrecipProb"
                    name="Avg Precip Prob (%)"
                    fill="#8a5cf5"
                    barSize={10}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Avg Max Temp</th>
                    <th>Avg Min Temp</th>
                    <th>Avg UV</th>
                    <th>Avg Precip Prob</th>
                    <th>Avg Snow Depth</th>
                  </tr>
                </thead>
                <tbody>
                  {forecastPoints.map((point) => (
                    <tr key={point.date}>
                      <td>{point.dayLabel}</td>
                      <td>{formatTemp(point.avgTempMax, 0)}</td>
                      <td>{formatTemp(point.avgTempMin, 0)}</td>
                      <td>{formatNumber(point.avgUv, 1)}</td>
                      <td>{formatPercent(point.avgPrecipProb, 0)}</td>
                      <td>{formatNumber(point.avgSnowDepth, 2)} in</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2>AI Strategy Assistant</h2>
        <form onSubmit={askCopilot} className="chat-form">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={4}
            placeholder="Ask: How did weather impact lead response and direct-mail timing?"
          />
          <button type="submit" disabled={chatLoading}>
            {chatLoading ? "Thinking..." : "Ask AI"}
          </button>
        </form>
        {chatError && <p className="error">{chatError}</p>}
        {chatAnswer && <p className="chat-answer">{chatAnswer}</p>}
      </section>

      <section className="panel">
        <h2>Market Weather Radar</h2>
        {loadingMarketWeather ? (
          <p>Loading market weather radar...</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Avg Max Temp ({weatherComparisonLabel})</th>
                  <th>Avg Min Temp ({weatherComparisonLabel})</th>
                  <th>Avg UV ({weatherComparisonLabel})</th>
                  <th>Avg Snow Depth ({weatherComparisonLabel})</th>
                </tr>
              </thead>
              <tbody>
                {(marketWeather?.markets || []).map((market) => (
                  <tr key={market.id || market.name}>
                    <td>{marketLabel(market)}</td>
                    <td>
                      {formatYoY(market.yoy?.avgMaxTemp, 1, "°F", weatherComparisonLabel).current} /{" "}
                      {compactDelta(market.yoy?.avgMaxTemp, 1, "°F", weatherComparisonLabel)}
                    </td>
                    <td>
                      {formatYoY(market.yoy?.avgMinTemp, 1, "°F", weatherComparisonLabel).current} /{" "}
                      {compactDelta(market.yoy?.avgMinTemp, 1, "°F", weatherComparisonLabel)}
                    </td>
                    <td>
                      {formatYoY(market.yoy?.avgUv, 1, "", weatherComparisonLabel).current} /{" "}
                      {compactDelta(market.yoy?.avgUv, 1, "", weatherComparisonLabel)}
                    </td>
                    <td>
                      {formatYoY(market.yoy?.avgSnowDepth, 2, " in", weatherComparisonLabel).current} /{" "}
                      {compactDelta(market.yoy?.avgSnowDepth, 2, " in", weatherComparisonLabel)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="trend-header">
          <h2>Leads & Weather Trend</h2>
          <div className="trend-controls">
            <label>
              Comparison View
              <select value={chartMode} onChange={(event) => setChartMode(event.target.value)}>
                {CHART_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Lead Source Filter
              <select
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value)}
                disabled={loadingLeads}
              >
                {sourceOptions.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Weather Line
              <select
                value={weatherLineMetric}
                onChange={(event) => setWeatherLineMetric(event.target.value)}
              >
                {WEATHER_LINE_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Start Date
              <input
                type="date"
                value={trendStartDate}
                min={trendWindow?.start || undefined}
                max={trendEndDate || trendWindow?.end || undefined}
                onChange={(event) => handleTrendStartChange(event.target.value)}
                disabled={!trendWindow?.start}
              />
            </label>

            <label>
              End Date
              <input
                type="date"
                value={trendEndDate}
                min={trendStartDate || trendWindow?.start || undefined}
                max={trendWindow?.end || undefined}
                onChange={(event) => handleTrendEndChange(event.target.value)}
                disabled={!trendWindow?.end}
              />
            </label>

            {chartMode === "toggle" && (
              <label>
                Display Year
                <select
                  value={toggleYear || selectedYear || ""}
                  onChange={(event) => setToggleYear(Number(event.target.value))}
                >
                  {(displaySeriesFiltered.length
                    ? displaySeriesFiltered.map((series) => series.year)
                    : availableYears
                  ).map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>

        <div className="compare-years chart-compare-years">
          <strong>Compare Years</strong>
          <div className="compare-options">
            {availableYears.map((year) => (
              <label key={year} className="compare-pill">
                <input
                  type="checkbox"
                  checked={compareYears.includes(year)}
                  onChange={() => toggleCompareYear(year)}
                />
                <span>{year}</span>
              </label>
            ))}
          </div>
        </div>

        {loadingLeads ? (
          <p>Loading lead trends...</p>
        ) : chartMode === "overlay" ? (
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={overlayData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="dayKey" />
                <YAxis yAxisId="leads" domain={[0, sharedLeadAxisMax]} />
                <YAxis yAxisId="temp" orientation="right" />
                <Tooltip />
                <Legend />
                {displaySeriesFiltered.map((series, index) => (
                  <Line
                    key={`leads-${series.year}`}
                    yAxisId="leads"
                    type="monotone"
                    dataKey={`leads_${series.year}`}
                    name={`${series.year} Leads`}
                    stroke={chartColor(index)}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
                {displaySeriesFiltered.map((series, index) => (
                  <Line
                    key={`weather-${series.year}`}
                    yAxisId="temp"
                    type="monotone"
                    dataKey={`weather_${weatherLineMetric}_${series.year}`}
                    name={`${series.year} ${
                      WEATHER_LINE_OPTIONS.find((option) => option.key === weatherLineMetric)?.label ||
                      "Weather"
                    }`}
                    stroke={chartColor(index)}
                    strokeDasharray="6 3"
                    strokeWidth={1.8}
                    dot={false}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : chartMode === "side" ? (
          <div className="side-chart-grid">
            {displaySeriesFiltered.map((series, index) => (
                <article key={series.year} className="mini-chart-card">
                  <h3>{series.year}</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <ComposedChart data={series.points}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="dayKey" />
                      <YAxis yAxisId="leads" domain={[0, sharedLeadAxisMax]} />
                      <YAxis yAxisId="temp" orientation="right" />
                      <Tooltip />
                      <Bar
                        yAxisId="leads"
                        dataKey="filteredLeads"
                        name="Leads"
                        fill={chartColor(index)}
                        barSize={8}
                      />
                      <Line
                        yAxisId="temp"
                        type="monotone"
                        dataKey={`weather.${weatherLineMetric}`}
                        name={
                          WEATHER_LINE_OPTIONS.find((option) => option.key === weatherLineMetric)
                            ?.label || "Weather"
                        }
                        stroke="#1f4f86"
                        strokeWidth={2}
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </article>
              ))}
          </div>
        ) : (
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={toggleSeries?.points || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="dayKey" />
                <YAxis yAxisId="leads" domain={[0, sharedLeadAxisMax]} />
                <YAxis yAxisId="temp" orientation="right" />
                <Tooltip />
                <Legend />
                <Bar yAxisId="leads" dataKey="filteredLeads" name="Leads" fill="#118257" />
                <Line
                  yAxisId="temp"
                  type="monotone"
                  dataKey={`weather.${weatherLineMetric}`}
                  name={
                    WEATHER_LINE_OPTIONS.find((option) => option.key === weatherLineMetric)
                      ?.label || "Weather"
                  }
                  stroke="#1f4f86"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="trend-header">
          <h2>Weather-Normalized Goal Tracking</h2>
          <p className="subtle">Expected leads are modeled from temp, UV, snow depth, and precipitation.</p>
        </div>
        {loadingLeads ? (
          <p>Building weather-adjusted baseline...</p>
        ) : (
          <>
            <div className="goal-summary">
              <span>MAE: {formatNumber(goalTracking?.mae, 1)}</span>
              <span>R²: {formatNumber(goalTracking?.rSquared, 2)}</span>
            </div>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={goalTrackingData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="dayKey" />
                  <YAxis yAxisId="leads" domain={[0, goalAxisMax]} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="leads" dataKey="actualLeads" name="Actual Leads" fill="#118257" />
                  <Line
                    yAxisId="leads"
                    type="monotone"
                    dataKey="expectedLeads"
                    name="Expected Leads"
                    stroke="#1f4f86"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="leads"
                    type="monotone"
                    dataKey="upperBand"
                    name="Upper Band"
                    stroke="#8a5cf5"
                    strokeDasharray="4 4"
                    dot={false}
                  />
                  <Line
                    yAxisId="leads"
                    type="monotone"
                    dataKey="lowerBand"
                    name="Lower Band"
                    stroke="#8a5cf5"
                    strokeDasharray="4 4"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <div className="trend-header">
          <h2>Lag Effect (0-7 Day)</h2>
          <div className="trend-controls">
            <label>
              Weather Metric
              <select value={lagMetric} onChange={(event) => setLagMetric(event.target.value)}>
                {LAG_METRIC_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {loadingLeads ? (
          <p>Calculating lag effects...</p>
        ) : (
          <>
            <p className="subtle">
              Strongest lag signal:{" "}
              {lagBest
                ? `${lagBest.lag} day(s), correlation ${formatNumber(lagBest.correlation, 2)}`
                : "Not enough data"}
            </p>
            <div className="chart-wrap lag-chart-wrap">
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={lagChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="lag" />
                  <YAxis yAxisId="corr" domain={[-1, 1]} />
                  <YAxis yAxisId="sample" orientation="right" />
                  <Tooltip />
                  <Legend />
                  <Bar
                    yAxisId="corr"
                    dataKey="correlation"
                    name="Correlation to Leads"
                    fill="#1f4f86"
                    barSize={24}
                  />
                  <Line
                    yAxisId="sample"
                    type="monotone"
                    dataKey="sampleSize"
                    name="Sample Size"
                    stroke="#118257"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Weather Condition Performance Matrix</h2>
        {loadingLeads ? (
          <p>Summarizing condition buckets...</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Condition Bucket</th>
                  <th>Days</th>
                  <th>Avg Leads (Filtered)</th>
                  <th>Avg Total Leads</th>
                  <th>Avg DM Leads</th>
                  <th>DM Mix</th>
                  <th>Selected Source Share</th>
                  <th>Avg Temp Max</th>
                  <th>Avg Snow Depth</th>
                  <th>Avg Precip</th>
                </tr>
              </thead>
              <tbody>
                {conditionMatrix.length ? (
                  conditionMatrix.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>{row.days}</td>
                      <td>{formatNumber(row.avgFilteredLeads, 1)}</td>
                      <td>{formatNumber(row.avgTotalLeads, 1)}</td>
                      <td>{formatNumber(row.avgDirectMailLeads, 1)}</td>
                      <td>{formatPercent(row.directMailShare, 1)}</td>
                      <td>{formatPercent(row.selectedSourceShare, 1)}</td>
                      <td>{formatTemp(row.avgTempMax, 0)}</td>
                      <td>{formatNumber(row.avgSnowDepth, 2)} in</td>
                      <td>{formatNumber(row.avgPrecip, 2)} in</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10}>No condition buckets available for this selection.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="table-header-row">
          <h2>Leads by Date vs Weather</h2>
          <div className="table-header-controls">
            <label>
              Lead Source Filter
              <select
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value)}
                disabled={loadingLeads}
              >
                {sourceOptions.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Table Year
              <select
                value={tableYear || selectedYear || ""}
                onChange={(event) => setTableYear(Number(event.target.value))}
              >
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Start Date
              <input
                type="date"
                value={trendStartDate}
                min={trendWindow?.start || undefined}
                max={trendEndDate || trendWindow?.end || undefined}
                onChange={(event) => handleTrendStartChange(event.target.value)}
                disabled={!trendWindow?.start}
              />
            </label>

            <label>
              End Date
              <input
                type="date"
                value={trendEndDate}
                min={trendStartDate || trendWindow?.start || undefined}
                max={trendWindow?.end || undefined}
                onChange={(event) => handleTrendEndChange(event.target.value)}
                disabled={!trendWindow?.end}
              />
            </label>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Leads (Filtered)</th>
                <th>Total Leads</th>
                <th>Direct Mail Leads</th>
                <th>Lead Bar</th>
                <th>Avg Temp Max</th>
                <th>Avg UV</th>
                <th>Avg Snow Depth</th>
              </tr>
            </thead>
            <tbody>
              {tablePoints.map((point) => (
                <tr key={point.date}>
                  <td>{point.date}</td>
                  <td>{point.filteredLeads}</td>
                  <td>{point.totalLeads}</td>
                  <td>{point.directMailLeads}</td>
                  <td>
                    <div className="daily-bar-track">
                      <div
                        className="daily-bar-fill"
                        style={{
                          width: `${maxDailyLead ? Math.max(4, Math.round((point.filteredLeads / maxDailyLead) * 100)) : 0}%`,
                        }}
                      />
                    </div>
                  </td>
                  <td>{formatTemp(point.weather?.avgTempMax, 0)}</td>
                  <td>{formatNumber(point.weather?.avgUv, 1)}</td>
                  <td>{formatNumber(point.weather?.avgSnowDepth, 2)} in</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
