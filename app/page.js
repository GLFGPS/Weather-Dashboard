"use client";

import { useEffect, useMemo, useState } from "react";

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

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return Number(value).toFixed(digits);
}

function formatTemp(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `${Number(value).toFixed(digits)}°F`;
}

function formatDateLabel(value) {
  if (!value) return "--";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function marketLabel(market) {
  if (!market) return "";
  return market.label || market.name || market.id || "";
}

function formatYoY(metric, digits = 1, suffix = "") {
  if (!metric) {
    return {
      current: "--",
      delta: "YoY: --",
    };
  }

  const current =
    metric.current === null || metric.current === undefined
      ? "--"
      : `${Number(metric.current).toFixed(digits)}${suffix}`;

  const deltaValue =
    metric.delta === null || metric.delta === undefined
      ? "--"
      : `${metric.delta >= 0 ? "+" : ""}${Number(metric.delta).toFixed(digits)}${suffix}`;

  return {
    current,
    delta: `YoY: ${deltaValue}`,
  };
}

function toDailyBarWidth(value, maxValue) {
  if (!maxValue) return 0;
  return Math.max(4, Math.round((value / maxValue) * 100));
}

export default function HomePage() {
  const [markets, setMarkets] = useState([]);
  const [selectedMarket, setSelectedMarket] = useState(FALLBACK_MARKETS[0]);
  const [showAllLocations, setShowAllLocations] = useState(false);
  const [analysisDate, setAnalysisDate] = useState("");
  const [selectedYear, setSelectedYear] = useState(null);
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

  const locationOptions = useMemo(() => {
    if (!markets.length) {
      return FALLBACK_MARKETS.map((name) => ({ value: name, label: name }));
    }
    return markets
      .map((market) => ({ value: market.name, label: marketLabel(market) }))
      .filter((item) => item.value);
  }, [markets]);

  useEffect(() => {
    if (!locationOptions.length) return;
    if (!locationOptions.some((option) => option.value === selectedMarket)) {
      setSelectedMarket(locationOptions[0].value);
    }
  }, [locationOptions, selectedMarket]);

  const availableYears = leadsOverview?.availableYears || [];

  const seasonWindow = leadsOverview?.seasonWindow || null;
  const dateMin = seasonWindow?.start || "";
  const dateMax = seasonWindow?.end || "";

  const fourthMetric = useMemo(
    () =>
      FOURTH_METRIC_OPTIONS.find((option) => option.key === fourthMetricKey) ||
      FOURTH_METRIC_OPTIONS[0],
    [fourthMetricKey],
  );

  useEffect(() => {
    let active = true;
    async function loadMarkets() {
      setLoadingMarkets(true);
      setMarketsError("");
      try {
        const response = await fetch("/api/markets", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load market list.");
        }
        if (!active) return;
        const rows = Array.isArray(payload.markets) ? payload.markets : [];
        setMarkets(rows);
        if (rows.length && !rows.some((row) => row.name === selectedMarket)) {
          setSelectedMarket(rows[0].name);
        }
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
  }, [selectedMarket]);

  useEffect(() => {
    let active = true;
    async function loadLeads() {
      setLoadingLeads(true);
      setLeadsError("");
      try {
        const params = new URLSearchParams({
          benchmarkMarket: selectedMarket,
        });
        if (selectedYear) {
          params.set("year", String(selectedYear));
        }
        const response = await fetch(`/api/leads/overview?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load leads overview.");
        }
        if (!active) return;
        setLeadsOverview(payload);
        if (!selectedYear && payload.selectedYear) {
          setSelectedYear(payload.selectedYear);
        }
        const seasonEnd = payload?.seasonWindow?.end;
        if (seasonEnd && (!analysisDate || analysisDate > seasonEnd || analysisDate < payload.seasonWindow.start)) {
          setAnalysisDate(seasonEnd);
        }
      } catch (error) {
        if (active) setLeadsError(error.message);
      } finally {
        if (active) setLoadingLeads(false);
      }
    }
    loadLeads();
    return () => {
      active = false;
    };
  }, [selectedMarket, selectedYear]);

  useEffect(() => {
    if (!analysisDate) return;
    let active = true;

    async function loadRadarWeather() {
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
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load weather analysis.");
        }
        if (active) setMarketWeather(payload);
      } catch (error) {
        if (active) setWeatherError(error.message);
      } finally {
        if (active) setLoadingMarketWeather(false);
      }
    }

    loadRadarWeather();
    return () => {
      active = false;
    };
  }, [analysisDate, showAllLocations]);

  useEffect(() => {
    if (!analysisDate) return;
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
          analysisContext: {
            leads: leadsOverview,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Chat request failed.");
      }
      setChatAnswer(payload.answer || "");
    } catch (error) {
      setChatError(error.message);
    } finally {
      setChatLoading(false);
    }
  }

  const yoyCards = marketWeather?.overview?.yoyCards || {};
  const metricCard4 = yoyCards[fourthMetric.key] || null;
  const maxDailyLead = Math.max(...(leadsOverview?.daily || []).map((row) => row.totalLeads), 0);

  return (
    <main className="analysis-page">
      <header className="analysis-header">
        <div>
          <h1>Weather Analysis</h1>
          <p>
            Leadership view of weather patterns and lead response from Feb 15 to May 17 each year.
          </p>
        </div>
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
                {(availableYears || []).map((year) => (
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
                min={dateMin || undefined}
                max={dateMax || undefined}
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
            <button type="button" onClick={() => setShowAllLocations((prev) => !prev)}>
              {showAllLocations ? "Show Key Locations" : "View All Locations"}
            </button>
            <p className="subtle">
              Market radar values are rolling 7-day averages ending on the selected date.
            </p>
          </div>
        </article>

        <article className="panel">
          <h2>AI Strategy Assistant</h2>
          <form onSubmit={askCopilot} className="chat-form">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={4}
              placeholder="Ask: How did snow depth impact direct mail lead response this season?"
            />
            <button type="submit" disabled={chatLoading}>
              {chatLoading ? "Thinking..." : "Ask AI"}
            </button>
          </form>
          {chatError && <p className="error">{chatError}</p>}
          {chatAnswer && <p className="chat-answer">{chatAnswer}</p>}
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
          <p className="kpi-value">{formatYoY(yoyCards.avgUv, 1, "").current}</p>
          <p className="kpi-delta">{formatYoY(yoyCards.avgUv, 1, "").delta}</p>
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
        <h2>Market Weather Radar</h2>
        {loadingMarketWeather ? (
          <p>Loading weather radar...</p>
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
                  <th>Direct Mail Signal</th>
                </tr>
              </thead>
              <tbody>
                {(marketWeather?.markets || []).map((market) => (
                  <tr key={market.id || market.name}>
                    <td>{marketLabel(market)}</td>
                    <td>{formatYoY(market.yoy?.avgMaxTemp, 1, "°F").current} / {formatYoY(market.yoy?.avgMaxTemp, 1, "°F").delta.replace("YoY: ", "")}</td>
                    <td>{formatYoY(market.yoy?.avgMinTemp, 1, "°F").current} / {formatYoY(market.yoy?.avgMinTemp, 1, "°F").delta.replace("YoY: ", "")}</td>
                    <td>{formatYoY(market.yoy?.avgUv, 1).current} / {formatYoY(market.yoy?.avgUv, 1).delta.replace("YoY: ", "")}</td>
                    <td>{formatYoY(market.yoy?.avgSnowDepth, 2, " in").current} / {formatYoY(market.yoy?.avgSnowDepth, 2, " in").delta.replace("YoY: ", "")}</td>
                    <td>{market.directMailSignal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="detail-grid">
        <article className="panel">
          <h2>
            Selected Market Day Snapshot ({formatDateLabel(selectedWeather?.analysisDate || analysisDate)})
          </h2>
          {loadingSelectedWeather ? (
            <p>Loading selected market details...</p>
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

        <article className="panel">
          <h2>Leads by Source ({selectedYear || "--"})</h2>
          {loadingLeads ? (
            <p>Loading leads...</p>
          ) : (
            <ul className="source-bars">
              {(leadsOverview?.topSources || []).slice(0, 10).map((source) => {
                const width = toDailyBarWidth(source.count, leadsOverview?.topSources?.[0]?.count || 0);
                return (
                  <li key={source.source}>
                    <div className="source-label">
                      <span>{source.source}</span>
                      <strong>{source.count}</strong>
                    </div>
                    <div className="source-bar-track">
                      <div className="source-bar-fill" style={{ width: `${width}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </article>
      </section>

      <section className="panel">
        <h2>Leads by Date vs Weather</h2>
        <p className="subtle">
          Leads are stored in Neon and joined with benchmark weather ({selectedMarket}) for seasonal analysis.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Total Leads</th>
                <th>Direct Mail Leads</th>
                <th>Lead Bar</th>
                <th>Temp Max</th>
                <th>UV</th>
                <th>Snow Depth</th>
                <th>Source Storage</th>
              </tr>
            </thead>
            <tbody>
              {(leadsOverview?.daily || []).slice(0, 60).map((row) => (
                <tr key={row.date}>
                  <td>{row.date}</td>
                  <td>{row.totalLeads}</td>
                  <td>{row.directMailLeads}</td>
                  <td>
                    <div className="daily-bar-track">
                      <div
                        className="daily-bar-fill"
                        style={{ width: `${toDailyBarWidth(row.totalLeads, maxDailyLead)}%` }}
                      />
                    </div>
                  </td>
                  <td>{formatTemp(row.weather?.tempmax, 0)}</td>
                  <td>{formatNumber(row.weather?.uvindex, 1)}</td>
                  <td>{formatNumber(row.weather?.snowdepth, 2)} in</td>
                  <td>{leadsOverview?.storage?.leads || "neon"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
