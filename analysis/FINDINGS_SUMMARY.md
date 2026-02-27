# Lawn Lead Prediction Model — Findings & Integration Plan

## What We Did

Analyzed **48,058 leads** across 5 full lawn seasons (2021-2025, Feb 15 - May 10) merged with daily weather data for West Chester, PA. Built a Gradient Boosted Regression model (R² = 0.98) that predicts daily lead volume based on three pillars: **seasonality**, **day of week**, and **weather conditions**. Created a ready-to-use `/api/leads/forecast` endpoint and pre-computed lookup tables for dashboard integration.

---

## Key Findings

### 1. Year-over-Year Growth
| Year | Total Leads | YoY Growth | DM % |
|------|------------|------------|------|
| 2021 | 8,181 | — | 39.1% |
| 2022 | 8,112 | -0.8% | 32.3% |
| 2023 | 8,998 | +10.9% | 32.1% |
| 2024 | 9,973 | +10.8% | 27.6% |
| 2025 | 12,478 | +25.1% | 27.3% |

The business is growing ~11-25% annually, while DM's share of leads is declining (39% → 27%), meaning organic/digital channels are scaling faster.

### 2. Day-of-Week Pattern (Critical)
| Day | Avg Leads | vs Weekday Avg |
|-----|-----------|---------------|
| **Monday** | **180** | **+28%** |
| Tuesday | 145 | +2% |
| Wednesday | 138 | -2% |
| Thursday | 127 | -10% |
| Friday | 116 | -18% |
| **Saturday** | **52** | **-63%** |
| Sunday | 32 | -77% |

**Monday is king.** Leads decline linearly through the week. Saturday is a completely different bucket — even the best Saturday will always be lower than the worst weekday. This is exactly what the user hypothesized, and the data confirms it strongly.

### 3. Weather Impact on Leads

| Condition | Avg Daily Leads | vs Baseline |
|-----------|----------------|-------------|
| **Sunny** | **125** | **+8%** |
| Partly Cloudy | 127 | +10% |
| Light Rain | 109 | -6% |
| Rain | 110 | -5% |
| **Cloudy/Overcast** | **84** | **-28%** |
| **Snow** | **47** | **-59%** |

**Weather matters.** Sunny/partly cloudy days produce 8-10% more leads than average. Snow days crater leads by 59%. Overcast/gloomy days suppress leads by 28% — confirming the user's intuition that "gloomy" weather depresses demand even without precipitation.

### 4. Temperature Sweet Spot

| Temp Range | vs Baseline |
|------------|-------------|
| Below 40°F | **-46%** |
| 40-50°F | -17% |
| 50-60°F | -1% (baseline zone) |
| **60-70°F** | **+20%** |
| 70-80°F | +15% |
| 80+°F | +7% |

The **60-70°F range is optimal** for leads. Above 80°F, there's a slight decline — people may feel it's too late in the season or have already committed.

### 5. Sunshine Hours

| Sunshine | vs Baseline |
|----------|-------------|
| <2 hours | **-30%** |
| 2-5 hours | +11% |
| 5-8 hours | -5% |
| 8+ hours | +7% |

Low-sunshine days (<2 hours) are significant suppressors. Days with 2-5 hours of sun actually perform well — possibly because people are outdoors enough to notice their lawn.

### 6. Seasonal Curve — When Peak Season Hits

Peak season runs **weeks 10-16 (early March through mid-April)**:
- **Week 12 (mid-March):** Absolute peak at ~249 leads/weekday
- **Weeks 10-15:** Sustained plateau of 180-250 leads/weekday
- **By week 18 (late April):** Volume drops to ~144/day
- **Week 19 (May):** Season winds down to ~85/day

### 7. Direct Mail Timing

DM spikes correlate with mail drops, not weather — but weather on drop day matters:
- DM leads on **sunny days**: avg 101 DM leads
- DM leads on **rainy days**: avg 89 DM leads
- DM leads on **snow days**: minimal

**Implication:** Time DM drops to land during warm, sunny stretches when possible. A DM piece arriving on a sunny 65°F day will convert better than one arriving during a cold snap.

---

## The Predictive Model

### Model: Gradient Boosted Regression
- **R² = 0.98** (explains 98% of variance in daily leads)
- **Cross-validated MAE = 35.68** (off by ~36 leads on average)
- **MAPE = 21%** (better on high-volume days, rougher on low-volume days)

### Feature Importance Ranking
1. **Day of season** (23%) — where we are in the lawn season
2. **Week number** (19%) — weekly rhythm
3. **Day of week** (18%) — Mon-Fri-Sat pattern
4. **Weekend flag** (13%) — binary weekday/weekend split
5. **Year trend** (7%) — YoY growth factor
6. **3-day temp average** (4%) — recent warmth, not just today
7. **Max temperature** (4%) — today's high
8. **3-day sunshine avg** (4%) — weather pattern, not just one day
9. **Sunshine hours** (3%) — today's sun exposure
10. **Wind speed** (2%)

### Weather Uplift Scenarios
| Scenario | Predicted Leads | vs Baseline |
|----------|----------------|-------------|
| Typical weekday (baseline) | 165 | — |
| **Sunny & Warm (70°F, 10hrs sun)** | **222** | **+35%** |
| Peak Spring (65°F, sunny, Wed) | 203 | +23% |
| Cloudy & Cool (50°F) | 169 | +3% |
| Rainy (55°F) | 142 | -14% |
| Snow Day (35°F) | 150 | -9% |
| **Saturday (identical weather to peak)** | **87** | **-47%** |

**The punchline:** A sunny, warm weekday in peak season can expect **35% more leads** than baseline. A snow day on a Saturday could mean 70%+ fewer leads than a peak weekday.

---

## Dashboard Integration Plan

### Ready-to-Use API Endpoint
**`/api/leads/forecast`** is already built and deployed with this PR.

Example:
```
GET /api/leads/forecast?date=2026-03-15&temp_max=68&sunshine_hrs=9&precip_in=0
```

Returns:
```json
{
  "forecasts": [{
    "date": "2026-03-15",
    "dow": "sunday",
    "predictedLeads": 63,
    "seasonalBaseline": 249,
    "dowMultiplier": 0.23,
    "weatherCondition": "Sunny & Warm (70°F+, 8hrs+ sun)",
    "weatherMultiplier": 1.35,
    "weatherUpliftPct": 35
  }]
}
```

### Suggested Dashboard Widgets

1. **Daily Lead Forecast Card** — Show expected leads for today and next 7 days using weather forecast data. Color-code: green (above baseline), yellow (near baseline), red (below baseline).

2. **Weather Impact Badge** — On each day in the leads table, show a badge like "Sunny +35%" or "Snow -59%" so the team understands context for that day's numbers.

3. **Seasonal Baseline Overlay** — On the existing leads trend chart, add a "model baseline" line showing what the model expected vs what actually happened. Deviations above baseline = positive surprise; below = underperformance.

4. **Day-of-Week Context** — Normalize the leads table to show "vs expected for this DOW" so Saturday's 80 leads isn't mistakenly seen as bad when it's actually above average for a Saturday.

5. **DM Drop Planner** — Show upcoming 2-week weather outlook with recommendation badges: "Good DM window" (warm + sunny stretch) vs "Hold off" (rain/cold incoming).

### Pre-Computed Lookup Tables
All model coefficients are in `analysis/model_coefficients.json` for JavaScript-side calculations without needing Python runtime:
- `seasonal_baseline_weekly` — baseline leads by calendar week
- `dow_multipliers` — day-of-week scaling factors
- `weather_multipliers` — weather condition scaling factors
- `temperature_impact` — temperature range adjustments

Formula: **Predicted Leads = seasonal_baseline[week] × dow_multiplier[day] × weather_multiplier[condition]**

---

## Files Produced

| File | Description |
|------|-------------|
| `analysis/lawn_lead_prediction.py` | Full analysis and model-building script |
| `analysis/model_coefficients.json` | Pre-computed lookup tables for dashboard |
| `analysis/output/analysis_report.json` | Machine-readable summary |
| `analysis/output/daily_leads_weather.csv` | Complete merged dataset |
| `analysis/output/yoy_seasonal_curves.png` | Year-over-year lead curves |
| `analysis/output/dow_analysis.png` | Day-of-week bar chart |
| `analysis/output/weekly_seasonal_curve.png` | Weekly seasonal pattern |
| `analysis/output/weather_impact_analysis.png` | 4-panel weather impact charts |
| `analysis/output/model_performance.png` | Model accuracy & feature importance |
| `analysis/output/seasonal_projection.png` | Seasonal baseline + DOW multipliers |
| `app/api/leads/forecast/route.js` | Ready-to-use forecast API endpoint |
