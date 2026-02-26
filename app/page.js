"use client";

import { useEffect, useMemo, useState } from "react";

const FALLBACK_LOCATIONS = [
  "West Chester,PA",
  "Philadelphia,PA",
  "Lancaster,PA",
  "Allentown,PA",
  "Trenton,NJ",
];

const LOOKBACK_OPTIONS = [7, 14, 21, 30, 45, 60, 90];

const MARKET_SORT_OPTIONS = [
  { value: "headwind", label: "Headwind Severity" },
  { value: "snowdepth", label: "Snow Depth (Today)" },
  { value: "snowdays", label: "Snow Days (Lookback)" },
  { value: "temperature", label: "Current Temperature" },
  { value: "name", label: "Market Name" },
];

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }

  return Number(value).toFixed(digits);
}

function formatTemp(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }

  return `${Number(value).toFixed(digits)}°F`;
}

function formatPercent(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }

  return `${Number(value).toFixed(digits)}%`;
}

function formatDateLabel(value) {
  if (!value) return "--";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function marketLabel(market) {
  if (!market) return "";
  return market.label || market.name || market.id || "";
}

function headwindWeight(level) {
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

function headwindBadgeClass(level) {
  if (level === "high") return "badge badge-high";
  if (level === "medium") return "badge badge-medium";
  return "badge badge-low";
}

function sortMarkets(markets, mode) {
  const rows = [...markets];

  rows.sort((a, b) => {
    if (mode === "name") {
      return marketLabel(a).localeCompare(marketLabel(b));
    }

    if (mode === "snowdepth") {
      return (b.today?.snowdepth ?? 0) - (a.today?.snowdepth ?? 0);
    }

    if (mode === "snowdays") {
      return (b.lookback?.snowDays ?? 0) - (a.lookback?.snowDays ?? 0);
    }

    if (mode === "temperature") {
      return (b.today?.temp ?? -999) - (a.today?.temp ?? -999);
    }

    const severityDelta = headwindWeight(b.headwindLevel) - headwindWeight(a.headwindLevel);
    if (severityDelta !== 0) return severityDelta;

    return (b.headwindScore ?? 0) - (a.headwindScore ?? 0);
  });

  return rows;
}

export default function HomePage() {
  const [markets, setMarkets] = useState([]);
  const [marketsSource, setMarketsSource] = useState("");
  const [marketsUpdatedAt, setMarketsUpdatedAt] = useState("");
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketsError, setMarketsError] = useState("");

  const [selectedLocation, setSelectedLocation] = useState(FALLBACK_LOCATIONS[0]);
  const [customLocation, setCustomLocation] = useState("");
  const [lookbackDays, setLookbackDays] = useState(21);
  const [marketSortMode, setMarketSortMode] = useState("headwind");

  const [weather, setWeather] = useState(null);
  const [marketWeather, setMarketWeather] = useState(null);
  const [uploadedAnalysis, setUploadedAnalysis] = useState(null);

  const [loadingWeather, setLoadingWeather] = useState(true);
  const [loadingMarketWeather, setLoadingMarketWeather] = useState(true);

  const [weatherError, setWeatherError] = useState("");
  const [marketWeatherError, setMarketWeatherError] = useState("");
  const [uploadError, setUploadError] = useState("");

  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dateColumnInput, setDateColumnInput] = useState("EstimateRequestedDate");
  const [channelColumnInput, setChannelColumnInput] = useState(
    "ProgramSourceDescription",
  );
  const [marketColumnInput, setMarketColumnInput] = useState("");

  const [question, setQuestion] = useState("");
  const [chatAnswer, setChatAnswer] = useState("");
  const [chatError, setChatError] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const locationOptions = useMemo(() => {
    if (!markets.length) {
      return FALLBACK_LOCATIONS.map((name) => ({ value: name, label: name }));
    }

    return markets
      .map((market) => ({
        value: market.name,
        label: marketLabel(market),
      }))
      .filter((entry) => entry.value);
  }, [markets]);

  const location = useMemo(() => {
    if (selectedLocation === "__custom") {
      const trimmed = customLocation.trim();
      return trimmed || locationOptions[0]?.value || FALLBACK_LOCATIONS[0];
    }

    return selectedLocation;
  }, [selectedLocation, customLocation, locationOptions]);

  const sortedMarketWeather = useMemo(() => {
    return sortMarkets(marketWeather?.markets || [], marketSortMode);
  }, [marketWeather, marketSortMode]);

  useEffect(() => {
    let active = true;

    async function loadMarkets() {
      setMarketsLoading(true);
      setMarketsError("");

      try {
        const response = await fetch("/api/markets", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load markets.");
        }

        if (active) {
          setMarkets(Array.isArray(payload.markets) ? payload.markets : []);
          setMarketsSource(payload.source || "");
          setMarketsUpdatedAt(payload.updatedAt || "");
        }
      } catch (error) {
        if (active) {
          setMarkets([]);
          setMarketsError(error.message);
        }
      } finally {
        if (active) {
          setMarketsLoading(false);
        }
      }
    }

    loadMarkets();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const valid = new Set(locationOptions.map((entry) => entry.value));
    if (selectedLocation !== "__custom" && !valid.has(selectedLocation)) {
      setSelectedLocation(locationOptions[0]?.value || FALLBACK_LOCATIONS[0]);
    }
  }, [locationOptions, selectedLocation]);

  useEffect(() => {
    let active = true;

    async function loadSelectedWeather() {
      setLoadingWeather(true);
      setWeatherError("");

      try {
        const params = new URLSearchParams({
          location,
          lookbackDays: String(lookbackDays),
        });
        const response = await fetch(`/api/weather?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load selected market weather.");
        }

        if (active) {
          setWeather(payload);
        }
      } catch (error) {
        if (active) {
          setWeather(null);
          setWeatherError(error.message);
        }
      } finally {
        if (active) {
          setLoadingWeather(false);
        }
      }
    }

    loadSelectedWeather();
    return () => {
      active = false;
    };
  }, [location, lookbackDays]);

  useEffect(() => {
    let active = true;

    async function loadAllMarketWeather() {
      setLoadingMarketWeather(true);
      setMarketWeatherError("");

      try {
        const params = new URLSearchParams({
          lookbackDays: String(lookbackDays),
        });
        const response = await fetch(`/api/weather/markets?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load market weather radar.");
        }

        if (active) {
          setMarketWeather(payload);
        }
      } catch (error) {
        if (active) {
          setMarketWeather(null);
          setMarketWeatherError(error.message);
        }
      } finally {
        if (active) {
          setLoadingMarketWeather(false);
        }
      }
    }

    loadAllMarketWeather();
    return () => {
      active = false;
    };
  }, [lookbackDays]);

  async function handleUpload(event) {
    event.preventDefault();
    if (!uploadFile) {
      setUploadError("Choose a file before running analysis.");
      return;
    }

    setUploading(true);
    setUploadError("");

    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("fallbackMarket", location);
      formData.append("dateColumn", dateColumnInput.trim());
      formData.append("channelColumn", channelColumnInput.trim());
      formData.append("marketColumn", marketColumnInput.trim());

      const response = await fetch("/api/analysis/upload", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Upload analysis failed.");
      }

      setUploadedAnalysis(payload);
    } catch (error) {
      setUploadedAnalysis(null);
      setUploadError(error.message);
    } finally {
      setUploading(false);
    }
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: trimmed,
          weatherContext: {
            selectedMarket: weather,
            marketRadar: marketWeather,
          },
          analysisContext: {
            uploaded: uploadedAnalysis,
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

  const overview = marketWeather?.overview || null;

  return (
    <main className="container">
      <section className="hero-panel">
        <div>
          <h1>Weather + Lead Timing Command Center</h1>
          <p>
            Multi-market weather radar for direct-mail timing, lead headwinds, and
            operational planning.
          </p>
          <p className="subtle">
            Markets source:{" "}
            <strong>
              {marketsSource || (marketsLoading ? "Loading..." : "Fallback list")}
            </strong>
            {marketsUpdatedAt ? ` | Updated: ${marketsUpdatedAt}` : ""}
          </p>
        </div>
        <div className="hero-stats">
          <div className="stat-chip">
            <span>Markets</span>
            <strong>{formatNumber(overview?.totalMarkets || locationOptions.length)}</strong>
          </div>
          <div className="stat-chip">
            <span>High Headwind</span>
            <strong>{formatNumber(overview?.highHeadwinds || 0)}</strong>
          </div>
          <div className="stat-chip">
            <span>Avg Temp</span>
            <strong>{formatTemp(overview?.avgTodayTemp, 0)}</strong>
          </div>
          <div className="stat-chip">
            <span>Avg Snow Depth</span>
            <strong>{formatNumber(overview?.avgSnowDepth, 2)} in</strong>
          </div>
        </div>
      </section>

      <section className="panel controls modern-controls">
        <div className="control-group">
          <label htmlFor="location">Selected Market Deep Dive</label>
          <select
            id="location"
            value={selectedLocation}
            onChange={(event) => setSelectedLocation(event.target.value)}
          >
            {locationOptions.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
            <option value="__custom">Custom...</option>
          </select>
          {selectedLocation === "__custom" && (
            <input
              value={customLocation}
              onChange={(event) => setCustomLocation(event.target.value)}
              placeholder="Example: Wilmington,DE"
            />
          )}
        </div>

        <div className="control-group">
          <label htmlFor="lookback">Lookback Window</label>
          <select
            id="lookback"
            value={lookbackDays}
            onChange={(event) => setLookbackDays(Number(event.target.value))}
          >
            {LOOKBACK_OPTIONS.map((days) => (
              <option value={days} key={days}>
                Last {days} days
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label htmlFor="sort-mode">Market Sort</label>
          <select
            id="sort-mode"
            value={marketSortMode}
            onChange={(event) => setMarketSortMode(event.target.value)}
          >
            {MARKET_SORT_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="control-note">
          <strong>Security:</strong> all API keys remain server-side in Vercel
          environment variables.
        </div>
      </section>

      {marketsError && <p className="error">{marketsError}</p>}
      {weatherError && <p className="error">{weatherError}</p>}
      {marketWeatherError && <p className="error">{marketWeatherError}</p>}
      {uploadError && <p className="error">{uploadError}</p>}

      <section className="panel">
        <div className="panel-title-row">
          <h2>Market Weather Radar</h2>
          <span className="subtle">
            Cross-market snapshot for direct-mail timing decisions.
          </span>
        </div>

        {loadingMarketWeather ? (
          <p>Loading all market weather...</p>
        ) : (
          <>
            {(marketWeather?.errors || []).length > 0 && (
              <ul>
                {marketWeather.errors.map((entry) => (
                  <li key={`${entry.market}-${entry.error}`}>
                    {entry.market}: {entry.error}
                  </li>
                ))}
              </ul>
            )}

            <div className="market-grid">
              {sortedMarketWeather.map((market) => (
                <article className="market-card" key={market.id || market.name}>
                  <div className="market-card-top">
                    <h3>{marketLabel(market)}</h3>
                    <span className={headwindBadgeClass(market.headwindLevel)}>
                      {(market.headwindLevel || "low").toUpperCase()}
                    </span>
                  </div>
                  <p className="market-condition">{market.today?.conditions || "--"}</p>
                  <div className="metric-grid">
                    <div>
                      <span>Current</span>
                      <strong>{formatTemp(market.today?.temp, 0)}</strong>
                    </div>
                    <div>
                      <span>Snow Depth</span>
                      <strong>{formatNumber(market.today?.snowdepth, 2)} in</strong>
                    </div>
                    <div>
                      <span>Snow Days</span>
                      <strong>{formatNumber(market.lookback?.snowDays)}</strong>
                    </div>
                    <div>
                      <span>Avg High</span>
                      <strong>{formatTemp(market.lookback?.avgHigh, 1)}</strong>
                    </div>
                  </div>
                  <p className="signal-line">{market.directMailSignal}</p>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="grid two-panel">
        <article className="panel">
          <h2>Selected Market: {weather?.location || location}</h2>
          {loadingWeather ? (
            <p>Loading selected market weather...</p>
          ) : (
            <>
              <p className="big">{formatTemp(weather?.today?.temp, 0)}</p>
              <p>{weather?.today?.conditions || "--"}</p>
              <ul>
                <li>High: {formatTemp(weather?.today?.tempmax, 0)}</li>
                <li>Low: {formatTemp(weather?.today?.tempmin, 0)}</li>
                <li>Humidity: {formatPercent(weather?.today?.humidity, 0)}</li>
                <li>Precip Prob: {formatPercent(weather?.today?.precipprob, 0)}</li>
                <li>Snow: {formatNumber(weather?.today?.snow, 2)} in</li>
                <li>Snow Depth: {formatNumber(weather?.today?.snowdepth, 2)} in</li>
              </ul>
            </>
          )}
        </article>

        <article className="panel">
          <h2>3-Day Outlook</h2>
          {loadingWeather ? (
            <p>Loading forecast...</p>
          ) : (
            <div className="forecast-grid">
              {(weather?.forecast || []).map((day) => (
                <div className="forecast-card" key={day.datetime}>
                  <h3>{formatDateLabel(day.datetime)}</h3>
                  <p>{day.conditions || "--"}</p>
                  <p>High: {formatTemp(day.tempmax, 0)}</p>
                  <p>Low: {formatTemp(day.tempmin, 0)}</p>
                  <p>Precip: {formatPercent(day.precipprob, 0)}</p>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="panel">
        <h2>Manual Lead Upload (CSV/XLSX)</h2>
        <p className="subtle">
          Upload historical lead exports, aggregate by market/day, and join to
          weather to evaluate direct-mail timing pressure.
        </p>

        <form className="upload-form" onSubmit={handleUpload}>
          <div className="upload-grid">
            <div className="control-group">
              <label htmlFor="lead-file">Lead file</label>
              <input
                id="lead-file"
                type="file"
                accept=".csv,.xlsx,.xlsm"
                onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
              />
            </div>
            <div className="control-group">
              <label htmlFor="date-column">Date column</label>
              <input
                id="date-column"
                value={dateColumnInput}
                onChange={(event) => setDateColumnInput(event.target.value)}
                placeholder="EstimateRequestedDate"
              />
            </div>
            <div className="control-group">
              <label htmlFor="channel-column">Channel column</label>
              <input
                id="channel-column"
                value={channelColumnInput}
                onChange={(event) => setChannelColumnInput(event.target.value)}
                placeholder="ProgramSourceDescription"
              />
            </div>
            <div className="control-group">
              <label htmlFor="market-column">Market column (optional)</label>
              <input
                id="market-column"
                value={marketColumnInput}
                onChange={(event) => setMarketColumnInput(event.target.value)}
                placeholder="market, city, or branch"
              />
            </div>
          </div>

          <div className="upload-actions">
            <p className="subtle">
              If market column is missing, fallback market is <strong>{location}</strong>.
            </p>
            <button type="submit" disabled={uploading}>
              {uploading ? "Analyzing..." : "Upload & Analyze"}
            </button>
          </div>
        </form>

        {uploadedAnalysis && (
          <div className="analysis-block">
            <p>
              File: <strong>{uploadedAnalysis.uploadedFile}</strong> | Parsed rows:{" "}
              {formatNumber(uploadedAnalysis.rowsParsed)} | Valid rows:{" "}
              {formatNumber(uploadedAnalysis.validRows)} | Dropped rows:{" "}
              {formatNumber(uploadedAnalysis.droppedRows)}
            </p>
            <p>
              Date Range: {uploadedAnalysis?.dateRange?.start || "--"} to{" "}
              {uploadedAnalysis?.dateRange?.end || "--"}
            </p>
            <p>
              Total leads: {formatNumber(uploadedAnalysis?.totals?.totalLeads)} | Direct
              mail: {formatNumber(uploadedAnalysis?.totals?.directMailLeads)} (
              {formatPercent(uploadedAnalysis?.totals?.directMailPct, 2)})
            </p>
          </div>
        )}
      </section>

      <section className="grid two-panel">
        <article className="panel">
          <h2>Ask OpenAI (Strategy Copilot)</h2>
          <form onSubmit={askCopilot} className="chat-form">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Example: Which markets should hold direct-mail drops this week based on current snow depth and recent weather?"
              rows={4}
            />
            <button type="submit" disabled={chatLoading}>
              {chatLoading ? "Thinking..." : "Ask"}
            </button>
          </form>
          {chatError && <p className="error">{chatError}</p>}
          {chatAnswer && <p className="chat-answer">{chatAnswer}</p>}
        </article>
      </section>
    </main>
  );
}
