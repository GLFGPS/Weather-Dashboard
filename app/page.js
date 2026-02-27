"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
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

const TREND_DAY_RANGE_START = "02-15";
const TREND_DAY_RANGE_END = "05-10";

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

function formatDayKeyLabel(dayKey) {
  if (!dayKey) return "--";
  const d = new Date(`2026-${dayKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildSeasonDayOptions(startDay, endDay) {
  const start = new Date(`2024-${startDay}T00:00:00Z`);
  const end = new Date(`2024-${endDay}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const options = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    options.push(cursor.toISOString().slice(5, 10));
  }
  return options;
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
  const [trendStartDay, setTrendStartDay] = useState("");
  const [trendEndDay, setTrendEndDay] = useState("");
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

  const [growthPct, setGrowthPct] = useState(0);
  const [forecastDate, setForecastDate] = useState("");
  const [dmInHome, setDmInHome] = useState(false);
  const [leadForecast, setLeadForecast] = useState(null);
  const [seasonalCurve, setSeasonalCurve] = useState(null);
  const [loadingLeadForecast, setLoadingLeadForecast] = useState(true);

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
  const seasonDayOptions = useMemo(
    () => buildSeasonDayOptions(TREND_DAY_RANGE_START, TREND_DAY_RANGE_END),
    [],
  );
  const rangeStartDay = trendStartDay || seasonDayOptions[0] || "";
  const rangeEndDay = trendEndDay || seasonDayOptions[seasonDayOptions.length - 1] || "";

  function isWithinTrendRange(point) {
    const dayKey = point?.dayKey || point?.date?.slice(5) || "";
    if (!dayKey) return false;
    if (rangeStartDay && dayKey < rangeStartDay) return false;
    if (rangeEndDay && dayKey > rangeEndDay) return false;
    return true;
  }

  const displaySeriesFiltered = useMemo(
    () =>
      displaySeries.map((series) => ({
        ...series,
        points: (series.points || []).filter((point) => isWithinTrendRange(point)),
      })),
    [displaySeries, rangeStartDay, rangeEndDay],
  );

  const tableSeries =
    chartSeries.find((series) => series.year === tableYear) ||
    selectedSeries ||
    chartSeries[0] ||
    null;
  const tablePoints = useMemo(
    () => (tableSeries?.points || []).filter((point) => isWithinTrendRange(point)),
    [tableSeries, rangeStartDay, rangeEndDay],
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
    if (!seasonDayOptions.length) return;
    setTrendStartDay((prev) => {
      if (!prev || !seasonDayOptions.includes(prev)) {
        return seasonDayOptions[0];
      }
      return prev;
    });
    setTrendEndDay((prev) => {
      if (!prev || !seasonDayOptions.includes(prev)) {
        return seasonDayOptions[seasonDayOptions.length - 1];
      }
      return prev;
    });
  }, [seasonDayOptions, selectedYear]);

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

  const forecastDateMin = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const forecastDateMax = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    const seasonEnd = `${d.getFullYear()}-05-10`;
    const futureDate = d.toISOString().slice(0, 10);
    return futureDate < seasonEnd ? futureDate : seasonEnd;
  }, []);

  useEffect(() => {
    if (!forecastDate) {
      setForecastDate(forecastDateMin);
    }
  }, [forecastDateMin, forecastDate]);

  useEffect(() => {
    let active = true;
    async function loadLeadForecast() {
      setLoadingLeadForecast(true);
      try {
        const dateToForecast = forecastDate || forecastDateMin;
        const params = new URLSearchParams({ date: dateToForecast });
        if (growthPct) params.set("growth_pct", String(growthPct));
        if (dmInHome) params.set("dm_in_home", "1");

        const forecastDay = (priorityForecast?.forecast || []).find((p) => p.date === dateToForecast);
        if (forecastDay) {
          if (forecastDay.avgTempMax != null) params.set("temp_max", String(forecastDay.avgTempMax));
          if (forecastDay.avgPrecipProb != null) params.set("precip_prob", String(forecastDay.avgPrecipProb));
          if (forecastDay.avgSnowDepth != null) params.set("snow_depth", String(forecastDay.avgSnowDepth));
        }

        const resp = await fetch(`/api/leads/forecast?${params.toString()}`, { cache: "no-store" });
        const payload = await resp.json();
        if (active) setLeadForecast(payload?.forecasts?.[0] || null);
      } catch {
        if (active) setLeadForecast(null);
      } finally {
        if (active) setLoadingLeadForecast(false);
      }
    }
    loadLeadForecast();
    return () => { active = false; };
  }, [forecastDate, forecastDateMin, priorityForecast, growthPct, dmInHome]);

  useEffect(() => {
    let active = true;
    async function loadCurve() {
      try {
        const year = selectedYear || new Date().getFullYear();
        const params = new URLSearchParams({ seasonal_curve: String(year) });
        if (growthPct) params.set("growth_pct", String(growthPct));
        if (dmInHome) params.set("dm_in_home", "1");
        const resp = await fetch(`/api/leads/forecast?${params.toString()}`, { cache: "no-store" });
        const payload = await resp.json();
        if (active) setSeasonalCurve(payload);
      } catch {
        if (active) setSeasonalCurve(null);
      }
    }
    loadCurve();
    return () => { active = false; };
  }, [selectedYear, growthPct, dmInHome]);

  const forecastWeatherBadge = useCallback((point) => {
    if (!point?.weather) return null;
    const temp = point.weather.avgTempMax;
    const snow = point.weather.avgSnowDepth ?? 0;
    if (temp == null) return null;
    if (snow > 0.5) return { label: "Snow", color: "#e0e0e0", textColor: "#333", pct: -59 };
    if (temp < 40) return { label: "Cold", color: "#bbdefb", textColor: "#0d47a1", pct: -46 };
    if (temp >= 60 && temp < 70) return { label: "Ideal", color: "#c8e6c9", textColor: "#2e7d32", pct: +20 };
    if (temp >= 70 && temp < 80) return { label: "Warm", color: "#fff9c4", textColor: "#f57f17", pct: +15 };
    if (temp >= 80) return { label: "Hot", color: "#ffccbc", textColor: "#bf360c", pct: +7 };
    if (temp >= 50 && temp < 60) return { label: "Mild", color: "#e3f2fd", textColor: "#1565c0", pct: -1 };
    if (temp >= 40 && temp < 50) return { label: "Cool", color: "#e8eaf6", textColor: "#283593", pct: -17 };
    return null;
  }, []);

  const currentPhase = leadForecast?.phase || null;

  const phaseBannerConfig = useMemo(() => {
    if (!currentPhase) return null;
    const configs = {
      Early: { bg: "#e3f2fd", border: "#90caf9", message: `Early season \u2014 weather sensitivity is VERY HIGH. Nice days can produce +${currentPhase.niceUplift}% more leads.` },
      Ramp: { bg: "#f3e5f5", border: "#ce93d8", message: `Ramp-up phase \u2014 weather sensitivity is HIGH. Nice days drive +${currentPhase.niceUplift}% uplift, bad days suppress ${currentPhase.badDrag}%.` },
      Peak: { bg: "#e8f5e9", border: "#81c784", message: `Peak season \u2014 demand is strong regardless. Weather has moderate impact (+${currentPhase.niceUplift}% nice / ${currentPhase.badDrag}% bad).` },
      Tail: { bg: "#fff3e0", border: "#ffb74d", message: `Late season tail \u2014 leads are winding down. Bad weather accelerates the decline (${currentPhase.badDrag}%).` },
    };
    return configs[currentPhase.name] || null;
  }, [currentPhase]);

  function handleTrendStartChange(value) {
    setTrendStartDay(value);
    if (rangeEndDay && value > rangeEndDay) {
      setTrendEndDay(value);
    }
  }

  function handleTrendEndChange(value) {
    setTrendEndDay(value);
    if (rangeStartDay && value < rangeStartDay) {
      setTrendStartDay(value);
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
    if (seasonalCurve?.curve) {
      for (const cp of seasonalCurve.curve) {
        if (!isWithinTrendRange({ dayKey: cp.dayKey })) continue;
        const row = map.get(cp.dayKey) || { dayKey: cp.dayKey };
        row.baselineWeekday = cp.weekdayBaseline;
        map.set(cp.dayKey, row);
      }
    }
    return [...map.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  }, [displaySeriesFiltered, seasonalCurve, rangeStartDay, rangeEndDay]);

  const selectedRadarMarket =
    (marketWeather?.markets || []).find((market) => market.name === selectedMarket) || null;
  const weatherComparisonLabel =
    selectedRadarMarket?.comparisonLabel || marketWeather?.overview?.comparisonLabel || "vs 5Y Avg";
  const rollingComparison = selectedWeather?.rollingComparisons || null;
  const rollingComparisonLabel = rollingComparison?.comparisonLabel || "vs 5Y Avg";
  const prior7Cards = rollingComparison?.prior7?.cards || null;
  const next7Cards = rollingComparison?.next7?.cards || null;
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

      <section className="panel">
        <div className="trend-header">
          <h2>7-Day Actual + 7-Day Forecast ({rollingComparisonLabel})</h2>
        </div>
        <div className="split-kpi-sections">
          <div>
            <h3 className="subsection-title">Prior 7 Days</h3>
            <div className="kpi-grid compact-kpi-grid">
              <article className="kpi-card">
                <h3>Avg Max Temp</h3>
                <p className="kpi-value">
                  {formatYoY(prior7Cards?.avgMaxTemp, 1, "°F", rollingComparisonLabel).current}
                </p>
                <p className="kpi-delta">
                  {formatYoY(prior7Cards?.avgMaxTemp, 1, "°F", rollingComparisonLabel).delta}
                </p>
              </article>
              <article className="kpi-card">
                <h3>Avg Min Temp</h3>
                <p className="kpi-value">
                  {formatYoY(prior7Cards?.avgMinTemp, 1, "°F", rollingComparisonLabel).current}
                </p>
                <p className="kpi-delta">
                  {formatYoY(prior7Cards?.avgMinTemp, 1, "°F", rollingComparisonLabel).delta}
                </p>
              </article>
              <article className="kpi-card">
                <h3>Avg UV</h3>
                <p className="kpi-value">
                  {formatYoY(prior7Cards?.avgUv, 1, "", rollingComparisonLabel).current}
                </p>
                <p className="kpi-delta">
                  {formatYoY(prior7Cards?.avgUv, 1, "", rollingComparisonLabel).delta}
                </p>
              </article>
              <article className="kpi-card">
                <div className="kpi-header-inline">
                  <h3>{fourthMetric.label}</h3>
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
                    prior7Cards?.[fourthMetric.key],
                    fourthMetric.digits,
                    ` ${fourthMetric.unit}`,
                    rollingComparisonLabel,
                  ).current}
                </p>
                <p className="kpi-delta">
                  {formatYoY(
                    prior7Cards?.[fourthMetric.key],
                    fourthMetric.digits,
                    ` ${fourthMetric.unit}`,
                    rollingComparisonLabel,
                  ).delta}
                </p>
              </article>
            </div>
          </div>

          <div>
            <h3 className="subsection-title">Next 7 Days Forecast</h3>
            <div className="kpi-grid compact-kpi-grid">
              <article className="kpi-card">
                <h3>Avg Max Temp</h3>
                <p className="kpi-value">
                  {formatYoY(next7Cards?.avgMaxTemp, 1, "°F", rollingComparisonLabel).current}
                </p>
                <p className="kpi-delta">
                  {formatYoY(next7Cards?.avgMaxTemp, 1, "°F", rollingComparisonLabel).delta}
                </p>
              </article>
              <article className="kpi-card">
                <h3>Avg Min Temp</h3>
                <p className="kpi-value">
                  {formatYoY(next7Cards?.avgMinTemp, 1, "°F", rollingComparisonLabel).current}
                </p>
                <p className="kpi-delta">
                  {formatYoY(next7Cards?.avgMinTemp, 1, "°F", rollingComparisonLabel).delta}
                </p>
              </article>
              <article className="kpi-card">
                <h3>Avg UV</h3>
                <p className="kpi-value">
                  {formatYoY(next7Cards?.avgUv, 1, "", rollingComparisonLabel).current}
                </p>
                <p className="kpi-delta">
                  {formatYoY(next7Cards?.avgUv, 1, "", rollingComparisonLabel).delta}
                </p>
              </article>
              <article className="kpi-card">
                <h3>{fourthMetric.label}</h3>
                <p className="kpi-value">
                  {formatYoY(
                    next7Cards?.[fourthMetric.key],
                    fourthMetric.digits,
                    ` ${fourthMetric.unit}`,
                    rollingComparisonLabel,
                  ).current}
                </p>
                <p className="kpi-delta">
                  {formatYoY(
                    next7Cards?.[fourthMetric.key],
                    fourthMetric.digits,
                    ` ${fourthMetric.unit}`,
                    rollingComparisonLabel,
                  ).delta}
                </p>
              </article>
            </div>
          </div>
        </div>
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
                <span>Projected Snow Depth</span>
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
                    <th>Projected Snow Depth</th>
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

      <section className="panel prediction-card">
        <div className="prediction-layout">
          <div className="prediction-left">
            <h2>Lead Forecast</h2>
            <div className="prediction-controls-row">
              <label>
                Forecast Date (next 15 days)
                <input
                  type="date"
                  value={forecastDate || forecastDateMin}
                  min={forecastDateMin}
                  max={forecastDateMax}
                  onChange={(event) => setForecastDate(event.target.value)}
                />
              </label>
              <label className="dm-toggle-label">
                DM In Home
                <button
                  type="button"
                  className={`dm-toggle ${dmInHome ? "dm-toggle-on" : ""}`}
                  onClick={() => setDmInHome((v) => !v)}
                >
                  {dmInHome ? "Yes — DM Drop Active" : "No DM Drop"}
                </button>
              </label>
            </div>

            {loadingLeadForecast ? (
              <p className="subtle">Loading forecast...</p>
            ) : leadForecast?.inSeason ? (
              <div className="prediction-body">
                <div className="prediction-main">
                  <div className="prediction-predicted">
                    <span className="prediction-number">{leadForecast.predictedLeads}</span>
                    <span className="prediction-label">expected leads</span>
                  </div>
                  <div className="prediction-date">
                    {formatDateLabel(leadForecast.date)} ({leadForecast.dowLabel})
                  </div>
                </div>
                <div className="prediction-factors">
                  <div className="factor-pill factor-season">
                    <span className="factor-name">{leadForecast.dmInHome ? "Historical Avg + DM" : "Historical Avg"}</span>
                    <span className="factor-value">
                      {leadForecast.seasonalBaseline}
                      {leadForecast.dmInHome && leadForecast.dmAddon > 0 && (
                        <span style={{ fontSize: "0.72rem", fontWeight: 400, color: "#5c7184" }}>
                          {" "}({leadForecast.organicBaseline} + {leadForecast.dmAddon})
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="factor-pill factor-dow">
                    <span className="factor-name">{leadForecast.dowLabel}</span>
                    <span className="factor-value">{leadForecast.dowMultiplier}x</span>
                  </div>
                  {leadForecast.weatherKey && (
                    <div className={`factor-pill ${leadForecast.weatherUpliftPct >= 0 ? "factor-positive" : "factor-negative"}`}>
                      <span className="factor-name">{leadForecast.weatherCondition}</span>
                      <span className="factor-value">{leadForecast.weatherUpliftPct >= 0 ? "+" : ""}{leadForecast.weatherUpliftPct}%</span>
                    </div>
                  )}
                  {leadForecast.weatherInput && (
                    <div className="factor-pill">
                      <span className="factor-name">Forecast Weather</span>
                      <span className="factor-value">{Math.round(leadForecast.weatherInput.tempMax)}°F · {Math.round(leadForecast.weatherInput.precipProb ?? 0)}% precip</span>
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
            ) : leadForecast ? (
              <p className="subtle">{leadForecast.message || "Outside lawn season"}</p>
            ) : (
              <p className="subtle">Select a date within lawn season (Feb 15 - May 10)</p>
            )}
          </div>

          <div className="prediction-right">
            <div className="prediction-math">
              <h3>How This Works</h3>
              <p>Predicted from 5 years of data (48K leads, 2021-2025). Uses the actual weather forecast for the selected date from our priority markets.</p>
              <div className="math-formula">
                <span>Baseline</span>
                <span className="math-op">&times;</span>
                <span>DOW</span>
                <span className="math-op">&times;</span>
                <span>Weather</span>
                <span className="math-op">=</span>
                <span className="math-result">{leadForecast?.predictedLeads ?? "—"}</span>
              </div>
              {leadForecast?.inSeason && (
                <p className="subtle" style={{ fontSize: "0.76rem" }}>
                  {leadForecast.seasonalBaseline}
                  {" "}&times; {leadForecast.dowMultiplier}
                  {" "}&times; {leadForecast.weatherMultiplier}
                  {" "}= {leadForecast.predictedLeads}
                </p>
              )}
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
              <p className="subtle">R² = 0.98 &middot; Trained on seasonal curve + day of week + weather conditions</p>
            </div>
          </div>
        </div>

        <div className="phase-track">
          {[
            { name: "Early", range: "Feb 15 – Mar 1", sensitivity: "Very High", bg: "#e3f2fd", border: "#90caf9", nice: "+50%", bad: "-15%" },
            { name: "Ramp", range: "Mar 1 – 17", sensitivity: "High", bg: "#f3e5f5", border: "#ce93d8", nice: "+34%", bad: "-16%" },
            { name: "Peak", range: "Mar 17 – Apr 16", sensitivity: "Moderate", bg: "#e8f5e9", border: "#81c784", nice: "+10%", bad: "-9%" },
            { name: "Tail", range: "Apr 16 – May 10", sensitivity: "Low-Mod", bg: "#fff3e0", border: "#ffb74d", nice: "+5%", bad: "-18%" },
          ].map((phase) => {
            const isActive = currentPhase?.name === phase.name;
            return (
              <div
                key={phase.name}
                className={`phase-bucket ${isActive ? "phase-bucket-active" : ""}`}
                style={{ background: isActive ? phase.bg : "#f8f9fa", borderColor: isActive ? phase.border : "#e0e0e0" }}
              >
                <strong className="phase-bucket-name">{phase.name}</strong>
                <span className="phase-bucket-range">{phase.range}</span>
                <span className="phase-bucket-sensitivity">Weather: {phase.sensitivity}</span>
                <span className="phase-bucket-impact">
                  <span className="phase-nice">Nice {phase.nice}</span>
                  <span className="phase-bad">Bad {phase.bad}</span>
                </span>
              </div>
            );
          })}
        </div>
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
              Start Day
              <select
                value={rangeStartDay}
                onChange={(event) => handleTrendStartChange(event.target.value)}
                disabled={!seasonDayOptions.length}
              >
                {seasonDayOptions.map((dayKey) => (
                  <option key={dayKey} value={dayKey}>
                    {formatDayKeyLabel(dayKey)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              End Day
              <select
                value={rangeEndDay}
                onChange={(event) => handleTrendEndChange(event.target.value)}
                disabled={!seasonDayOptions.length}
              >
                {seasonDayOptions.map((dayKey) => (
                  <option key={dayKey} value={dayKey}>
                    {formatDayKeyLabel(dayKey)}
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
              Start Day
              <select
                value={rangeStartDay}
                onChange={(event) => handleTrendStartChange(event.target.value)}
                disabled={!seasonDayOptions.length}
              >
                {seasonDayOptions.map((dayKey) => (
                  <option key={dayKey} value={dayKey}>
                    {formatDayKeyLabel(dayKey)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              End Day
              <select
                value={rangeEndDay}
                onChange={(event) => handleTrendEndChange(event.target.value)}
                disabled={!seasonDayOptions.length}
              >
                {seasonDayOptions.map((dayKey) => (
                  <option key={dayKey} value={dayKey}>
                    {formatDayKeyLabel(dayKey)}
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
              {tablePoints.map((point) => {
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
                      <span className="weather-badge" style={{ background: badge.color, color: badge.textColor }}>
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
