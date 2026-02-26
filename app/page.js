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
  const selectedSeries =
    chartSeries.find((series) => series.year === selectedYear) || chartSeries[0] || null;
  const maxDailyLead = Math.max(...(selectedSeries?.points || []).map((row) => row.filteredLeads), 0);

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
        if (compareYears.length) params.set("compareYears", compareYears.join(","));
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
  }, [selectedYear, sourceFilter, compareYears]);

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
  }, [analysisDate, showAllLocations]);

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

  useEffect(() => {
    if (!selectedYear) return;
    setCompareYears((prev) => {
      if (prev.includes(selectedYear)) return prev;
      return [...prev, selectedYear].sort((a, b) => a - b);
    });
  }, [selectedYear]);

  function toggleCompareYear(year) {
    setCompareYears((prev) => {
      if (prev.includes(year)) {
        if (year === selectedYear) return prev;
        const next = prev.filter((value) => value !== year);
        return next.length ? next : [selectedYear];
      }
      return [...prev, year].sort((a, b) => a - b);
    });
  }

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

  const overlayData = useMemo(() => {
    const map = new Map();
    for (const series of chartSeries) {
      for (const point of series.points || []) {
        const row = map.get(point.dayKey) || { dayKey: point.dayKey };
        row[`leads_${series.year}`] = point.filteredLeads;
        row[`temp_${series.year}`] = point.weather?.avgTempMax ?? null;
        map.set(point.dayKey, row);
      }
    }
    return [...map.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  }, [chartSeries]);

  const selectedRadarMarket =
    (marketWeather?.markets || []).find((market) => market.name === selectedMarket) || null;
  const yoyCards = selectedRadarMarket?.yoy || marketWeather?.overview?.yoyCards || {};
  const metricCard4 = yoyCards[fourthMetric.key] || null;
  const toggleSeries =
    chartSeries.find((series) => series.year === Number(toggleYear)) || chartSeries[0] || null;

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
          </div>

          <div className="filter-actions">
            <button type="button" onClick={() => setShowAllLocations((value) => !value)}>
              {showAllLocations ? "Show Key Locations" : "View All Locations"}
            </button>
            <p className="subtle">
              Market radar values are rolling 7-day averages ending on selected date.
            </p>
          </div>

          <div className="compare-years">
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

            {chartMode === "toggle" && (
              <label>
                Display Year
                <select
                  value={toggleYear || selectedYear || ""}
                  onChange={(event) => setToggleYear(Number(event.target.value))}
                >
                  {(compareYears.length ? compareYears : availableYears).map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
                <YAxis yAxisId="leads" />
                <YAxis yAxisId="temp" orientation="right" />
                <Tooltip />
                <Legend />
                {chartSeries.map((series, index) => (
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
                {chartSeries.map((series, index) => (
                  <Line
                    key={`temp-${series.year}`}
                    yAxisId="temp"
                    type="monotone"
                    dataKey={`temp_${series.year}`}
                    name={`${series.year} Avg Temp Max`}
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
            {chartSeries
              .filter((series) => compareYears.includes(series.year))
              .map((series, index) => (
                <article key={series.year} className="mini-chart-card">
                  <h3>{series.year}</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <ComposedChart data={series.points}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="dayKey" />
                      <YAxis yAxisId="leads" />
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
                        dataKey="weather.avgTempMax"
                        name="Avg Temp Max"
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
                <YAxis yAxisId="leads" />
                <YAxis yAxisId="temp" orientation="right" />
                <Tooltip />
                <Legend />
                <Bar yAxisId="leads" dataKey="filteredLeads" name="Leads" fill="#118257" />
                <Line
                  yAxisId="temp"
                  type="monotone"
                  dataKey="weather.avgTempMax"
                  name="Avg Temp Max"
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
        <h2>Leads by Date vs Weather</h2>
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
              {(selectedSeries?.points || []).map((point) => (
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
