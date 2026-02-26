"use client";

import { useEffect, useMemo, useState } from "react";

const FALLBACK_LOCATIONS = [
  "West Chester,PA",
  "Philadelphia,PA",
  "Lancaster,PA",
  "Allentown,PA",
  "Trenton,NJ",
];

const LOOKBACK_OPTIONS = [7, 14, 30, 60, 90];

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

function marketOptionLabel(market) {
  if (!market) return "";
  return market.label || market.name || market.id || "";
}

export default function HomePage() {
  const [markets, setMarkets] = useState([]);
  const [marketsUpdatedAt, setMarketsUpdatedAt] = useState("");
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketsError, setMarketsError] = useState("");

  const [selectedLocation, setSelectedLocation] = useState(FALLBACK_LOCATIONS[0]);
  const [customLocation, setCustomLocation] = useState("");
  const [lookbackDays, setLookbackDays] = useState(30);

  const [weather, setWeather] = useState(null);
  const [analysis2022, setAnalysis2022] = useState(null);
  const [uploadedAnalysis, setUploadedAnalysis] = useState(null);

  const [loadingWeather, setLoadingWeather] = useState(true);
  const [loading2022, setLoading2022] = useState(true);

  const [weatherError, setWeatherError] = useState("");
  const [analysisError, setAnalysisError] = useState("");
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
        label: marketOptionLabel(market) || market.name,
      }))
      .filter((option) => option.value);
  }, [markets]);

  const location = useMemo(() => {
    if (selectedLocation === "__custom") {
      const trimmed = customLocation.trim();
      return trimmed || locationOptions[0]?.value || FALLBACK_LOCATIONS[0];
    }

    return selectedLocation;
  }, [selectedLocation, customLocation, locationOptions]);

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
    const validValues = new Set(locationOptions.map((option) => option.value));
    if (selectedLocation !== "__custom" && !validValues.has(selectedLocation)) {
      setSelectedLocation(locationOptions[0]?.value || FALLBACK_LOCATIONS[0]);
    }
  }, [locationOptions, selectedLocation]);

  useEffect(() => {
    let active = true;

    async function loadWeather() {
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
          throw new Error(payload.error || "Unable to load weather data.");
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

    loadWeather();
    return () => {
      active = false;
    };
  }, [location, lookbackDays]);

  useEffect(() => {
    let active = true;

    async function load2022Analysis() {
      setLoading2022(true);
      setAnalysisError("");

      try {
        const response = await fetch("/api/analysis/seed-2022", {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load 2022 analysis.");
        }

        if (active) {
          setAnalysis2022(payload);
        }
      } catch (error) {
        if (active) {
          setAnalysisError(error.message);
          setAnalysis2022(null);
        }
      } finally {
        if (active) {
          setLoading2022(false);
        }
      }
    }

    load2022Analysis();
    return () => {
      active = false;
    };
  }, []);

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
          weatherContext: weather,
          analysisContext: {
            seed2022: analysis2022,
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

  return (
    <main className="container">
      <header className="header">
        <h1>Internal Weather + Lead Dashboard</h1>
        <p>
          Fast weather lookbacks, lead strategy context, and OpenAI-assisted
          interpretation for market planning.
        </p>
      </header>

      <section className="panel controls">
        <div className="control-group">
          <label htmlFor="location">Location</label>
          <select
            id="location"
            value={selectedLocation}
            onChange={(event) => setSelectedLocation(event.target.value)}
          >
            {locationOptions.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
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

        <div className="control-note">
          <strong>Security:</strong> API keys stay server-side in Vercel
          environment variables.{" "}
          {marketsLoading
            ? "Loading market config..."
            : `${locationOptions.length} configured market(s) from GitHub-backed markets.json.`}
          {marketsUpdatedAt ? ` Updated: ${marketsUpdatedAt}.` : ""}
        </div>
      </section>

      {marketsError && <p className="error">{marketsError}</p>}
      {weatherError && <p className="error">{weatherError}</p>}
      {analysisError && <p className="error">{analysisError}</p>}
      {uploadError && <p className="error">{uploadError}</p>}

      <section className="grid">
        <article className="panel">
          <h2>Current Conditions ({weather?.location || location})</h2>
          {loadingWeather ? (
            <p>Loading weather...</p>
          ) : (
            <>
              <p className="big">{formatTemp(weather?.today?.temp)}</p>
              <p>{weather?.today?.conditions || "--"}</p>
              <ul>
                <li>High: {formatTemp(weather?.today?.tempmax)}</li>
                <li>Low: {formatTemp(weather?.today?.tempmin)}</li>
                <li>Humidity: {formatPercent(weather?.today?.humidity)}</li>
                <li>Precip Prob: {formatPercent(weather?.today?.precipprob)}</li>
              </ul>
            </>
          )}
        </article>

        <article className="panel">
          <h2>Same Day Last Year</h2>
          {loadingWeather ? (
            <p>Loading comparison...</p>
          ) : (
            <>
              <p className="big">
                {formatDateLabel(weather?.sameDayLastYear?.datetime)}
              </p>
              <ul>
                <li>High: {formatTemp(weather?.sameDayLastYear?.tempmax)}</li>
                <li>Low: {formatTemp(weather?.sameDayLastYear?.tempmin)}</li>
                <li>Snow: {formatNumber(weather?.sameDayLastYear?.snow, 2)} in</li>
                <li>
                  Snow Depth:{" "}
                  {formatNumber(weather?.sameDayLastYear?.snowdepth, 2)} in
                </li>
              </ul>
            </>
          )}
        </article>

        <article className="panel">
          <h2>5-Year Same-Day Rank</h2>
          {loadingWeather ? (
            <p>Loading rank...</p>
          ) : (
            <>
              <ul>
                <li>{weather?.sameDayFiveYear?.highRankText || "--"}</li>
                <li>{weather?.sameDayFiveYear?.lowRankText || "--"}</li>
                <li>{weather?.sameDayFiveYear?.humidityRankText || "--"}</li>
              </ul>
              <p>
                Avg High: {formatTemp(weather?.sameDayFiveYear?.avgHigh, 1)} /
                Avg Low: {formatTemp(weather?.sameDayFiveYear?.avgLow, 1)}
              </p>
            </>
          )}
        </article>

        <article className="panel">
          <h2>Lookback Summary ({lookbackDays} days)</h2>
          {loadingWeather ? (
            <p>Loading summary...</p>
          ) : (
            <ul>
              <li>Avg High: {formatTemp(weather?.lookback?.avgHigh, 1)}</li>
              <li>Avg Low: {formatTemp(weather?.lookback?.avgLow, 1)}</li>
              <li>Snow Days: {formatNumber(weather?.lookback?.snowDays)}</li>
              <li>Total Snow: {formatNumber(weather?.lookback?.totalSnow, 2)} in</li>
              <li>
                Max Snow Depth: {formatNumber(weather?.lookback?.maxSnowDepth, 2)} in
              </li>
              <li>
                Precip Days: {formatNumber(weather?.lookback?.precipDays)}
              </li>
            </ul>
          )}
        </article>
      </section>

      <section className="panel">
        <h2>3-Day Forecast</h2>
        {loadingWeather ? (
          <p>Loading forecast...</p>
        ) : (
          <div className="forecast-grid">
            {(weather?.forecast || []).map((day) => (
              <div className="forecast-card" key={day.datetime}>
                <h3>{formatDateLabel(day.datetime)}</h3>
                <p>{day.conditions || "--"}</p>
                <p>High: {formatTemp(day.tempmax)}</p>
                <p>Low: {formatTemp(day.tempmin)}</p>
                <p>Precip: {formatPercent(day.precipprob)}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Manual Lead Upload (CSV/XLSX)</h2>
        <p className="subtle">
          Upload historical lead exports and join them to weather by market/day.
          This powers direct-mail timing insights before scheduled imports are
          added.
        </p>

        <form className="upload-form" onSubmit={handleUpload}>
          <div className="upload-grid">
            <div className="control-group">
              <label htmlFor="lead-file">Lead file</label>
              <input
                id="lead-file"
                type="file"
                accept=".csv,.xlsx,.xlsm,.xls"
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
                placeholder="market, city, or branch column"
              />
            </div>
          </div>

          <div className="upload-actions">
            <p className="subtle">
              If no market column exists, fallback market is <strong>{location}</strong>.
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
              Total leads: {formatNumber(uploadedAnalysis?.totals?.totalLeads)} |
              Direct mail: {formatNumber(uploadedAnalysis?.totals?.directMailLeads)} (
              {formatPercent(uploadedAnalysis?.totals?.directMailPct, 2)})
            </p>

            {(uploadedAnalysis.warnings || []).length > 0 && (
              <ul>
                {(uploadedAnalysis.warnings || []).map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            )}

            <div className="two-col">
              <div>
                <h3>Top Channels</h3>
                <ul>
                  {(uploadedAnalysis.topChannels || []).map((item) => (
                    <li key={item.channel}>
                      {item.channel}: {item.count}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Market Timing Signals</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Market</th>
                        <th>Leads</th>
                        <th>DM %</th>
                        <th>Signal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(uploadedAnalysis.markets || []).map((item) => (
                        <tr key={item.market}>
                          <td>{item.market}</td>
                          <td>{item.totalLeads}</td>
                          <td>{formatPercent(item.directMailPct, 1)}</td>
                          <td>{item.timingSignal}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <h3>Recent Daily Market Rows (joined with weather)</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Market</th>
                    <th>Leads</th>
                    <th>DM Leads</th>
                    <th>Snow</th>
                    <th>Snow Depth</th>
                    <th>Temp Max</th>
                    <th>Conditions</th>
                  </tr>
                </thead>
                <tbody>
                  {(uploadedAnalysis.daily || []).slice(0, 30).map((row) => (
                    <tr key={`${row.market}-${row.date}`}>
                      <td>{row.date}</td>
                      <td>{row.market}</td>
                      <td>{row.totalLeads}</td>
                      <td>{row.directMailLeads}</td>
                      <td>{formatNumber(row.weather?.snow, 2)}</td>
                      <td>{formatNumber(row.weather?.snowdepth, 2)}</td>
                      <td>{formatTemp(row.weather?.tempmax, 0)}</td>
                      <td>{row.weather?.conditions || "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>2022 Seed Analysis (Local Workbook)</h2>
        {loading2022 ? (
          <p>Loading workbook summary...</p>
        ) : analysis2022 ? (
          <>
            <p>
              Leads: {formatNumber(analysis2022?.leads?.total)} | Direct Mail:{" "}
              {formatNumber(analysis2022?.leads?.directMail?.total)} (
              {formatPercent(analysis2022?.leads?.directMail?.pctOfTotal, 2)})
            </p>
            <p>
              Lead Date Range: {analysis2022?.leads?.dateRange?.start || "--"} to{" "}
              {analysis2022?.leads?.dateRange?.end || "--"}
            </p>
            <p>
              Avg leads on snow days:{" "}
              {formatNumber(analysis2022?.weatherImpact?.avgLeadsOnSnowDays, 2)} | on
              non-snow days:{" "}
              {formatNumber(analysis2022?.weatherImpact?.avgLeadsOnNonSnowDays, 2)}
            </p>
            <div className="two-col">
              <div>
                <h3>Top Lead Sources</h3>
                <ul>
                  {(analysis2022?.leads?.topSources || []).slice(0, 8).map((item) => (
                    <li key={item.source}>
                      {item.source}: {item.count}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Direct Mail Channels</h3>
                <ul>
                  {(analysis2022?.leads?.directMail?.channels || []).map((item) => (
                    <li key={item.source}>
                      {item.source}: {item.count}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        ) : (
          <p>No analysis data found.</p>
        )}
      </section>

      <section className="panel">
        <h2>Ask OpenAI About Weather + Leads</h2>
        <form onSubmit={askCopilot} className="chat-form">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Example: Based on uploaded market results, where should we reduce direct-mail volume if snow depth exceeds 0.5in this week?"
            rows={4}
          />
          <button type="submit" disabled={chatLoading}>
            {chatLoading ? "Thinking..." : "Ask"}
          </button>
        </form>
        {chatError && <p className="error">{chatError}</p>}
        {chatAnswer && <p className="chat-answer">{chatAnswer}</p>}
      </section>
    </main>
  );
}
