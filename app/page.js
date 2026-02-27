"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
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

const CHART_COLORS = ["#118257", "#1f4f86", "#8a5cf5", "#f08a24", "#da3f5f", "#0f766e"];

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return Number(value).toFixed(digits);
}

function formatTemp(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `${Number(value).toFixed(digits)}°F`;
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

function formatYoY(metric, digits = 1, suffix = "") {
  if (!metric) {
    return { current: "--", delta: "YoY: --" };
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
    delta: `YoY: ${delta}`,
  };
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
  const [selectedYear, setSelectedYear] = useState(null);
  const [compareYears, setCompareYears] = useState([]);
  const [sourceFilter, setSourceFilter] = useState("All Sources");
  const [chartMode, setChartMode] = useState("overlay");
  const [toggleYear, setToggleYear] = useState(null);
  const [tableYear, setTableYear] = useState(null);
  const [weatherLineMetric, setWeatherLineMetric] = useState("avgTempMax");
  const [fourthMetricKey, setFourthMetricKey] = useState("avgSnowDepth");

  const [marketWeather, setMarketWeather] = useState(null);
  const [selectedWeather, setSelectedWeather] = useState(null);
  const [leadsOverview, setLeadsOverview] = useState(null);

  const [loadingMarkets, setLoadingMarkets] = useState(true);
  const [loadingMarketWeather, setLoadingMarketWeather] = useState(true);
  const [loadingSelectedWeather, setLoadingSelectedWeather] = useState(true);
  const [loadingLeads, setLoadingLeads] = useState(true);

  const [marketsError, setMarketsError] = useState("");
  const [weatherError, setWeatherError] = useState("");
  const [selectedWeatherError, setSelectedWeatherError] = useState("");
  const [leadsError, setLeadsError] = useState("");

  const [question, setQuestion] = useState("");
  const [chatAnswer, setChatAnswer] = useState("");
  const [chatError, setChatError] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const [growthPct, setGrowthPct] = useState(0);
  const [forecast, setForecast] = useState(null);
  const [seasonalCurve, setSeasonalCurve] = useState(null);
  const [loadingForecast, setLoadingForecast] = useState(true);

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
  const tableSeries =
    chartSeries.find((series) => series.year === tableYear) ||
    selectedSeries ||
    chartSeries[0] ||
    null;
  const sharedLeadAxisMax = useMemo(() => {
    const maxLead = displaySeries.reduce((runningMax, series) => {
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
  }, [displaySeries]);

  const maxDailyLead = Math.max(
    ...(tableSeries?.points || []).map((row) => row.filteredLeads),
    0,
  );

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
    if (!displaySeries.length) return;
    if (!toggleYear || !displaySeries.some((series) => series.year === toggleYear)) {
      setToggleYear(displaySeries[0].year);
    }
  }, [displaySeries, toggleYear]);

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

  // Fetch forecast for analysis date and seasonal baseline curve
  useEffect(() => {
    let active = true;
    async function loadForecast() {
      setLoadingForecast(true);
      try {
        const dateToForecast = analysisDate || new Date().toISOString().slice(0, 10);
        const params = new URLSearchParams({ date: dateToForecast });
        if (growthPct) params.set("growth_pct", String(growthPct));

        const weatherDay = selectedWeather?.selectedDay;
        if (weatherDay) {
          if (weatherDay.tempmax != null) params.set("temp_max", String(weatherDay.tempmax));
          if (weatherDay.uvindex != null) params.set("sunshine_hrs", String(Math.min(weatherDay.uvindex * 1.5, 14)));
          if (weatherDay.precip != null) params.set("precip_in", String(weatherDay.precip));
          if (weatherDay.snowdepth != null && weatherDay.snowdepth > 0) params.set("snowfall_in", String(weatherDay.snowdepth));
        }

        const resp = await fetch(`/api/leads/forecast?${params.toString()}`, { cache: "no-store" });
        const payload = await resp.json();
        if (active) setForecast(payload?.forecasts?.[0] || null);
      } catch {
        if (active) setForecast(null);
      } finally {
        if (active) setLoadingForecast(false);
      }
    }
    loadForecast();
    return () => { active = false; };
  }, [analysisDate, selectedWeather, growthPct]);

  useEffect(() => {
    let active = true;
    async function loadCurve() {
      try {
        const year = selectedYear || new Date().getFullYear();
        const params = new URLSearchParams({ seasonal_curve: String(year) });
        if (growthPct) params.set("growth_pct", String(growthPct));
        const resp = await fetch(`/api/leads/forecast?${params.toString()}`, { cache: "no-store" });
        const payload = await resp.json();
        if (active) setSeasonalCurve(payload);
      } catch {
        if (active) setSeasonalCurve(null);
      }
    }
    loadCurve();
    return () => { active = false; };
  }, [selectedYear, growthPct]);

  const overlayData = useMemo(() => {
    const map = new Map();
    for (const series of displaySeries) {
      for (const point of series.points || []) {
        const row = map.get(point.dayKey) || { dayKey: point.dayKey };
        row[`leads_${series.year}`] = point.filteredLeads;
        row[`weather_avgTempMax_${series.year}`] = point.weather?.avgTempMax ?? null;
        row[`weather_avgUv_${series.year}`] = point.weather?.avgUv ?? null;
        row[`weather_avgSnowDepth_${series.year}`] = point.weather?.avgSnowDepth ?? null;
        map.set(point.dayKey, row);
      }
    }

    if (seasonalCurve?.curve) {
      for (const cp of seasonalCurve.curve) {
        const row = map.get(cp.dayKey) || { dayKey: cp.dayKey };
        row.baselineWeekday = cp.weekdayBaseline;
        row.baselineSaturday = cp.saturdayBaseline;
        map.set(cp.dayKey, row);
      }
    }

    return [...map.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  }, [displaySeries, seasonalCurve]);

  // Weather badge logic for table rows
  const forecastWeatherBadge = useCallback((point) => {
    if (!point?.weather) return null;
    const temp = point.weather.avgTempMax;
    const snow = point.weather.avgSnowDepth ?? 0;
    if (temp == null) return null;

    if (snow > 0.5) return { label: "Snow", color: "#e0e0e0", textColor: "#333", pct: -59 };
    if (temp < 40) return { label: "Cold", color: "#bbdefb", textColor: "#0d47a1", pct: -46 };
    if (temp >= 60 && temp < 70) return { label: "Sunny", color: "#fff9c4", textColor: "#f57f17", pct: +20 };
    if (temp >= 70 && temp < 80) return { label: "Warm", color: "#c8e6c9", textColor: "#2e7d32", pct: +15 };
    if (temp >= 80) return { label: "Hot", color: "#ffccbc", textColor: "#bf360c", pct: +7 };
    if (temp >= 50 && temp < 60) return { label: "Mild", color: "#e3f2fd", textColor: "#1565c0", pct: -1 };
    if (temp >= 40 && temp < 50) return { label: "Cool", color: "#e8eaf6", textColor: "#283593", pct: -17 };
    return null;
  }, []);

  const currentPhase = useMemo(() => {
    if (!forecast?.phase) return null;
    return forecast.phase;
  }, [forecast]);

  const phaseBannerConfig = useMemo(() => {
    if (!currentPhase) return null;
    const configs = {
      Early: {
        bg: "#e3f2fd",
        border: "#90caf9",
        icon: "snowflake",
        message: `Early season — weather sensitivity is VERY HIGH. Nice days can produce +${currentPhase.niceUplift}% more leads.`,
      },
      Ramp: {
        bg: "#f3e5f5",
        border: "#ce93d8",
        icon: "trending_up",
        message: `Ramp-up phase — weather sensitivity is HIGH. Nice days drive +${currentPhase.niceUplift}% uplift, bad days suppress ${currentPhase.badDrag}%.`,
      },
      Peak: {
        bg: "#e8f5e9",
        border: "#81c784",
        icon: "local_florist",
        message: `Peak season — demand is strong regardless. Weather has moderate impact (+${currentPhase.niceUplift}% nice / ${currentPhase.badDrag}% bad).`,
      },
      Tail: {
        bg: "#fff3e0",
        border: "#ffb74d",
        icon: "schedule",
        message: `Late season tail — leads are winding down. Bad weather accelerates the decline (${currentPhase.badDrag}%).`,
      },
    };
    return configs[currentPhase.name] || null;
  }, [currentPhase]);

  const selectedRadarMarket =
    (marketWeather?.markets || []).find((market) => market.name === selectedMarket) || null;
  const yoyCards = selectedRadarMarket?.yoy || marketWeather?.overview?.yoyCards || {};
  const metricCard4 = yoyCards[fourthMetric.key] || null;
  const toggleSeries =
    displaySeries.find((series) => series.year === Number(toggleYear)) ||
    displaySeries[0] ||
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

      {(marketsError || weatherError || selectedWeatherError || leadsError) && (
        <section>
          {marketsError && <p className="error">{marketsError}</p>}
          {weatherError && <p className="error">{weatherError}</p>}
          {selectedWeatherError && <p className="error">{selectedWeatherError}</p>}
          {leadsError && <p className="error">{leadsError}</p>}
        </section>
      )}

      <section className="kpi-grid">
        <article className="kpi-card">
          <h3>Avg Max Temp (YoY)</h3>
          <p className="kpi-value">{formatYoY(yoyCards.avgMaxTemp, 1, "°F").current}</p>
          <p className="kpi-delta">{formatYoY(yoyCards.avgMaxTemp, 1, "°F").delta}</p>
        </article>

        <article className="kpi-card">
          <h3>Avg Min Temp (YoY)</h3>
          <p className="kpi-value">{formatYoY(yoyCards.avgMinTemp, 1, "°F").current}</p>
          <p className="kpi-delta">{formatYoY(yoyCards.avgMinTemp, 1, "°F").delta}</p>
        </article>

        <article className="kpi-card">
          <h3>Avg UV (YoY)</h3>
          <p className="kpi-value">{formatYoY(yoyCards.avgUv, 1).current}</p>
          <p className="kpi-delta">{formatYoY(yoyCards.avgUv, 1).delta}</p>
        </article>

        <article className="kpi-card">
          <div className="kpi-header-inline">
            <h3>{fourthMetric.label} (YoY)</h3>
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
            {formatYoY(metricCard4, fourthMetric.digits, ` ${fourthMetric.unit}`).current}
          </p>
          <p className="kpi-delta">
            {formatYoY(metricCard4, fourthMetric.digits, ` ${fourthMetric.unit}`).delta}
          </p>
        </article>
      </section>

      {/* Lead Prediction Model Section */}
      <section className="prediction-section">
        <article className="panel forecast-card">
          <div className="forecast-header">
            <h2>Lead Forecast</h2>
            <div className="growth-calibration">
              <label>
                YoY Growth Adjustment
                <div className="growth-input-row">
                  <input
                    type="range"
                    min="-30"
                    max="50"
                    step="5"
                    value={growthPct}
                    onChange={(event) => setGrowthPct(Number(event.target.value))}
                  />
                  <span className="growth-value">{growthPct >= 0 ? "+" : ""}{growthPct}%</span>
                </div>
              </label>
            </div>
          </div>

          {loadingForecast ? (
            <p className="subtle">Loading forecast...</p>
          ) : forecast?.inSeason ? (
            <div className="forecast-body">
              <div className="forecast-main">
                <div className="forecast-predicted">
                  <span className="forecast-number">{forecast.predictedLeads}</span>
                  <span className="forecast-label">expected leads</span>
                </div>
                <div className="forecast-date">
                  {formatDateLabel(forecast.date)} ({forecast.dowLabel})
                </div>
              </div>
              <div className="forecast-factors">
                <div className="factor-pill factor-season">
                  <span className="factor-name">Seasonal Baseline</span>
                  <span className="factor-value">{forecast.seasonalBaseline}</span>
                </div>
                <div className="factor-pill factor-dow">
                  <span className="factor-name">{forecast.dowLabel}</span>
                  <span className="factor-value">{forecast.dowMultiplier}x</span>
                </div>
                {forecast.weatherKey && (
                  <div className={`factor-pill factor-weather ${forecast.weatherUpliftPct >= 0 ? "factor-positive" : "factor-negative"}`}>
                    <span className="factor-name">{forecast.weatherCondition}</span>
                    <span className="factor-value">{forecast.weatherUpliftPct >= 0 ? "+" : ""}{forecast.weatherUpliftPct}%</span>
                  </div>
                )}
                {growthPct !== 0 && (
                  <div className="factor-pill factor-growth">
                    <span className="factor-name">Growth Adj.</span>
                    <span className="factor-value">{growthPct >= 0 ? "+" : ""}{growthPct}%</span>
                  </div>
                )}
              </div>
            </div>
          ) : forecast ? (
            <p className="subtle">{forecast.message || "Outside lawn season"}</p>
          ) : (
            <p className="subtle">Select a date within lawn season (Feb 15 - May 10)</p>
          )}
        </article>

        {phaseBannerConfig && (
          <article
            className="panel phase-banner"
            style={{ background: phaseBannerConfig.bg, borderColor: phaseBannerConfig.border }}
          >
            <div className="phase-content">
              <strong className="phase-name">{currentPhase.name} Season</strong>
              <span className="phase-sensitivity">Weather Sensitivity: {currentPhase.weatherSensitivity.toUpperCase()}</span>
            </div>
            <p className="phase-message">{phaseBannerConfig.message}</p>
          </article>
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
                  <th>Avg Max Temp (YoY)</th>
                  <th>Avg Min Temp (YoY)</th>
                  <th>Avg UV (YoY)</th>
                  <th>Avg Snow Depth (YoY)</th>
                </tr>
              </thead>
              <tbody>
                {(marketWeather?.markets || []).map((market) => (
                  <tr key={market.id || market.name}>
                    <td>{marketLabel(market)}</td>
                    <td>
                      {formatYoY(market.yoy?.avgMaxTemp, 1, "°F").current} /{" "}
                      {formatYoY(market.yoy?.avgMaxTemp, 1, "°F").delta.replace("YoY: ", "")}
                    </td>
                    <td>
                      {formatYoY(market.yoy?.avgMinTemp, 1, "°F").current} /{" "}
                      {formatYoY(market.yoy?.avgMinTemp, 1, "°F").delta.replace("YoY: ", "")}
                    </td>
                    <td>
                      {formatYoY(market.yoy?.avgUv, 1).current} /{" "}
                      {formatYoY(market.yoy?.avgUv, 1).delta.replace("YoY: ", "")}
                    </td>
                    <td>
                      {formatYoY(market.yoy?.avgSnowDepth, 2, " in").current} /{" "}
                      {formatYoY(market.yoy?.avgSnowDepth, 2, " in").delta.replace("YoY: ", "")}
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

            {chartMode === "toggle" && (
              <label>
                Display Year
                <select
                  value={toggleYear || selectedYear || ""}
                  onChange={(event) => setToggleYear(Number(event.target.value))}
                >
                  {(displaySeries.length
                    ? displaySeries.map((series) => series.year)
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
                {displaySeries.map((series, index) => (
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
                {seasonalCurve?.curve && (
                  <Line
                    yAxisId="leads"
                    type="monotone"
                    dataKey="baselineWeekday"
                    name="Model Baseline"
                    stroke="#9e9e9e"
                    strokeDasharray="8 4"
                    strokeWidth={2.2}
                    dot={false}
                    connectNulls
                  />
                )}
                {displaySeries.map((series, index) => (
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
            {displaySeries.map((series, index) => (
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
          </div>
        </div>
        <div className="table-wrap">
            <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Day</th>
                <th>Leads (Filtered)</th>
                <th>Total Leads</th>
                <th>DM Leads</th>
                <th>Weather Impact</th>
                <th>Lead Bar</th>
                <th>Avg Temp Max</th>
                <th>Avg UV</th>
                <th>Snow Depth</th>
              </tr>
            </thead>
            <tbody>
              {(tableSeries?.points || []).map((point) => {
                const badge = forecastWeatherBadge(point);
                const d = new Date(`${point.date}T00:00:00`);
                const dayName = d.toLocaleDateString("en-US", { weekday: "short" });
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                return (
                <tr key={point.date} style={isWeekend ? { background: "#f8f9fa" } : undefined}>
                  <td>{point.date}</td>
                  <td style={isWeekend ? { fontWeight: 600, color: "#6c757d" } : undefined}>{dayName}</td>
                  <td>{point.filteredLeads}</td>
                  <td>{point.totalLeads}</td>
                  <td>{point.directMailLeads}</td>
                  <td>
                    {badge ? (
                      <span
                        className="weather-badge"
                        style={{ background: badge.color, color: badge.textColor }}
                      >
                        {badge.label} {badge.pct >= 0 ? "+" : ""}{badge.pct}%
                      </span>
                    ) : (
                      <span className="weather-badge weather-badge-neutral">--</span>
                    )}
                  </td>
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
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
