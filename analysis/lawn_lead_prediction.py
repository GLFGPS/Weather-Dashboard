"""
Lawn Lead Prediction Model & Exploratory Analysis
==================================================
Analyzes historical lead data (2021-2026) with weather data to:
1. Understand seasonality, day-of-week, and weather impact on lead volume
2. Build a predictive model for daily lead forecasting
3. Quantify weather-driven uplift vs baseline
"""

import os
import sys
import json
import warnings
import datetime
import requests
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import seaborn as sns
from scipy import stats
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import cross_val_score, TimeSeriesSplit
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.preprocessing import StandardScaler
import statsmodels.api as sm
warnings.filterwarnings('ignore')

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')
os.makedirs(OUTPUT_DIR, exist_ok=True)

WEST_CHESTER_LAT = 39.9566
WEST_CHESTER_LON = -75.6058
SEASON_START_MMDD = (2, 15)
SEASON_END_MMDD = (5, 10)

# ---------------------------------------------------------------------------
# 1. DATA LOADING
# ---------------------------------------------------------------------------

def load_lead_files(workspace_root):
    """Load all lead CSV files from workspace root."""
    lead_files = {
        '2021 Leads.csv': 2021,
        '2022 Leads.csv': 2022,
        '2023 Leads.csv': 2023,
        '2024 Leads.csv': 2024,
        '2025 Leads .csv': 2025,
        '2026 Estimate Requests so far.csv': 2026,
    }

    frames = []
    for filename, year in lead_files.items():
        filepath = os.path.join(workspace_root, filename)
        if not os.path.exists(filepath):
            print(f"  [SKIP] {filename} not found")
            continue

        df = pd.read_csv(filepath)
        df.columns = [c.strip() for c in df.columns]
        df['source_year'] = year
        frames.append(df)
        print(f"  [OK] {filename}: {len(df):,} rows")

    combined = pd.concat(frames, ignore_index=True)
    combined['date'] = pd.to_datetime(combined['EstimateRequestedDate'], format='mixed', dayfirst=False)
    combined['source'] = combined['ProgramSourceDescription'].fillna('Unknown').str.strip()
    combined = combined.dropna(subset=['date'])
    print(f"\n  Total raw leads: {len(combined):,}")
    return combined


def classify_source(source):
    """Classify lead source into DM vs Organic/Digital."""
    s = source.upper()
    if s.startswith('DM') or 'DIRECT MAIL' in s:
        return 'Direct Mail'
    return 'Organic/Digital'


def filter_season(df):
    """Filter to lawn season window (Feb 15 - May 10)."""
    month = df['date'].dt.month
    day = df['date'].dt.day
    md = month * 100 + day
    mask = (md >= 215) & (md <= 510)
    filtered = df[mask].copy()
    print(f"  Season-filtered leads: {len(filtered):,} (from {len(df):,})")
    return filtered


def aggregate_daily(df):
    """Aggregate leads to daily totals with source breakdown."""
    df['source_type'] = df['source'].apply(classify_source)

    daily_total = df.groupby('date').size().reset_index(name='total_leads')
    daily_dm = df[df['source_type'] == 'Direct Mail'].groupby('date').size().reset_index(name='dm_leads')
    daily_organic = df[df['source_type'] == 'Organic/Digital'].groupby('date').size().reset_index(name='organic_leads')

    daily = daily_total.merge(daily_dm, on='date', how='left').merge(daily_organic, on='date', how='left')
    daily['dm_leads'] = daily['dm_leads'].fillna(0).astype(int)
    daily['organic_leads'] = daily['organic_leads'].fillna(0).astype(int)

    daily['year'] = daily['date'].dt.year
    daily['month'] = daily['date'].dt.month
    daily['day'] = daily['date'].dt.day
    daily['dow'] = daily['date'].dt.dayofweek  # 0=Mon, 6=Sun
    daily['dow_name'] = daily['date'].dt.day_name()
    daily['week_num'] = daily['date'].dt.isocalendar().week.astype(int)
    daily['is_weekend'] = daily['dow'].isin([5, 6])
    daily['is_saturday'] = daily['dow'] == 5
    daily['is_sunday'] = daily['dow'] == 6
    daily['day_of_season'] = (daily['date'] - pd.to_datetime(daily['year'].astype(str) + '-02-15')).dt.days

    return daily.sort_values('date').reset_index(drop=True)

# ---------------------------------------------------------------------------
# 2. WEATHER DATA
# ---------------------------------------------------------------------------

def fetch_weather_open_meteo(year):
    """Fetch daily weather from Open-Meteo Archive API for one season."""
    start_date = f"{year}-02-15"
    end_date = f"{year}-05-10"

    if year >= 2026:
        today = datetime.date.today()
        end_dt = datetime.date(year, 5, 10)
        if end_dt > today:
            end_date = today.strftime('%Y-%m-%d')
        if datetime.date(year, 2, 15) > today:
            return pd.DataFrame()

    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {
        'latitude': WEST_CHESTER_LAT,
        'longitude': WEST_CHESTER_LON,
        'start_date': start_date,
        'end_date': end_date,
        'daily': ','.join([
            'temperature_2m_max', 'temperature_2m_min', 'temperature_2m_mean',
            'precipitation_sum', 'snowfall_sum', 'snow_depth_mean',
            'sunshine_duration', 'rain_sum',
            'wind_speed_10m_max',
            'shortwave_radiation_sum',
        ]),
        'temperature_unit': 'fahrenheit',
        'wind_speed_unit': 'mph',
        'precipitation_unit': 'inch',
        'timezone': 'America/New_York',
    }

    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    daily = data.get('daily', {})
    if not daily or 'time' not in daily:
        return pd.DataFrame()

    weather_df = pd.DataFrame({
        'date': pd.to_datetime(daily['time']),
        'temp_max': daily.get('temperature_2m_max'),
        'temp_min': daily.get('temperature_2m_min'),
        'temp_mean': daily.get('temperature_2m_mean'),
        'precip_in': daily.get('precipitation_sum'),
        'snowfall_in': daily.get('snowfall_sum'),
        'snow_depth': daily.get('snow_depth_mean'),
        'sunshine_hrs': [x / 3600 if x is not None else None for x in (daily.get('sunshine_duration') or [])],
        'rain_in': daily.get('rain_sum'),
        'wind_max_mph': daily.get('wind_speed_10m_max'),
        'solar_radiation': daily.get('shortwave_radiation_sum'),
    })
    return weather_df


def fetch_all_weather():
    """Fetch weather for all seasons 2021-2026."""
    frames = []
    for year in range(2021, 2027):
        print(f"  Fetching weather for {year}...")
        try:
            wdf = fetch_weather_open_meteo(year)
            if len(wdf) > 0:
                frames.append(wdf)
                print(f"    -> {len(wdf)} days")
            else:
                print(f"    -> no data")
        except Exception as e:
            print(f"    -> ERROR: {e}")
    if frames:
        return pd.concat(frames, ignore_index=True)
    return pd.DataFrame()


def classify_weather_condition(row):
    """Classify a day's weather condition from numeric data."""
    snowfall = row.get('snowfall_in', 0) or 0
    precip = row.get('precip_in', 0) or 0
    rain = row.get('rain_in', 0) or 0
    sunshine = row.get('sunshine_hrs', 0) or 0
    temp_max = row.get('temp_max', 50) or 50

    if snowfall > 0.1 or (row.get('snow_depth', 0) or 0) > 1:
        return 'Snow'
    if rain > 0.25:
        return 'Rain'
    if rain > 0.05:
        return 'Light Rain'
    if sunshine >= 8:
        return 'Sunny'
    if sunshine >= 4:
        return 'Partly Cloudy'
    return 'Cloudy/Overcast'

# ---------------------------------------------------------------------------
# 3. EXPLORATORY DATA ANALYSIS
# ---------------------------------------------------------------------------

def run_eda(daily, weather_daily):
    """Run full exploratory data analysis and generate charts."""
    print("\n" + "="*70)
    print("EXPLORATORY DATA ANALYSIS")
    print("="*70)

    # --- 3a. Year-over-Year seasonality ---
    print("\n--- Year-over-Year Lead Volume ---")
    yearly = daily.groupby('year').agg(
        total=('total_leads', 'sum'),
        days=('total_leads', 'count'),
        daily_avg=('total_leads', 'mean'),
        dm_total=('dm_leads', 'sum'),
        organic_total=('organic_leads', 'sum'),
    ).reset_index()
    yearly['dm_pct'] = (yearly['dm_total'] / yearly['total'] * 100).round(1)
    yearly['yoy_growth'] = yearly['total'].pct_change() * 100
    print(yearly.to_string(index=False))
    yearly.to_csv(os.path.join(OUTPUT_DIR, 'yearly_summary.csv'), index=False)

    # --- 3b. Day-of-Week Analysis (Mon-Fri vs Sat vs Sun) ---
    print("\n--- Day-of-Week Analysis ---")
    full_years = daily[daily['year'].isin([2021, 2022, 2023, 2024, 2025])]
    dow_stats = full_years.groupby(['dow', 'dow_name']).agg(
        avg_total=('total_leads', 'mean'),
        avg_organic=('organic_leads', 'mean'),
        avg_dm=('dm_leads', 'mean'),
        median_total=('total_leads', 'median'),
        count=('total_leads', 'count'),
    ).reset_index()
    dow_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    dow_stats['dow_name'] = pd.Categorical(dow_stats['dow_name'], categories=dow_order, ordered=True)
    dow_stats = dow_stats.sort_values('dow_name')
    weekday_avg = full_years[full_years['dow'] < 5]['total_leads'].mean()
    dow_stats['pct_vs_weekday_avg'] = ((dow_stats['avg_total'] / weekday_avg - 1) * 100).round(1)
    print(dow_stats[['dow_name', 'avg_total', 'avg_organic', 'avg_dm', 'pct_vs_weekday_avg', 'count']].to_string(index=False))
    dow_stats.to_csv(os.path.join(OUTPUT_DIR, 'dow_analysis.csv'), index=False)

    # --- 3c. Weekly seasonality curve ---
    print("\n--- Seasonal Curve (by week of season) ---")
    weekly_curve = full_years.groupby(['year', 'week_num']).agg(
        weekly_total=('total_leads', 'sum'),
        weekly_organic=('organic_leads', 'sum'),
        weekly_dm=('dm_leads', 'sum'),
    ).reset_index()
    avg_weekly = weekly_curve.groupby('week_num').agg(
        avg_total=('weekly_total', 'mean'),
        avg_organic=('weekly_organic', 'mean'),
        avg_dm=('weekly_dm', 'mean'),
    ).reset_index()
    print(avg_weekly.to_string(index=False))

    # --- 3d. Source breakdown ---
    print("\n--- Top Lead Sources (all years) ---")
    all_sources = daily.merge(
        daily[['date']].drop_duplicates(), on='date'
    )
    # We need to go back to raw data for source breakdown
    print("  (See source_breakdown.csv for detail)")

    # --- CHARTS ---
    plot_yoy_curves(daily, full_years)
    plot_dow_chart(dow_stats)
    plot_weekly_seasonal_curve(weekly_curve, avg_weekly)

    return yearly, dow_stats, avg_weekly


def plot_yoy_curves(daily, full_years):
    """Plot year-over-year daily lead curves."""
    fig, axes = plt.subplots(2, 1, figsize=(16, 10))

    for year in sorted(full_years['year'].unique()):
        subset = full_years[full_years['year'] == year].copy()
        subset['season_day'] = subset['day_of_season']
        # 7-day rolling average for smoothing
        subset = subset.sort_values('season_day')
        subset['rolling_total'] = subset['total_leads'].rolling(7, min_periods=1, center=True).mean()
        subset['rolling_organic'] = subset['organic_leads'].rolling(7, min_periods=1, center=True).mean()
        axes[0].plot(subset['season_day'], subset['rolling_total'], label=str(year), linewidth=1.5)
        axes[1].plot(subset['season_day'], subset['rolling_organic'], label=str(year), linewidth=1.5)

    axes[0].set_title('Total Leads by Day of Season (7-day rolling avg)', fontsize=14, fontweight='bold')
    axes[0].set_xlabel('Days Since Feb 15')
    axes[0].set_ylabel('Daily Leads')
    axes[0].legend()
    axes[0].grid(True, alpha=0.3)

    axes[1].set_title('Organic/Digital Leads by Day of Season (7-day rolling avg)', fontsize=14, fontweight='bold')
    axes[1].set_xlabel('Days Since Feb 15')
    axes[1].set_ylabel('Daily Leads')
    axes[1].legend()
    axes[1].grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, 'yoy_seasonal_curves.png'), dpi=150, bbox_inches='tight')
    plt.close()
    print("  [CHART] yoy_seasonal_curves.png")


def plot_dow_chart(dow_stats):
    """Plot day-of-week lead distribution."""
    fig, ax = plt.subplots(figsize=(10, 6))
    colors = ['#2196F3'] * 5 + ['#FF9800', '#F44336']
    bars = ax.bar(dow_stats['dow_name'].astype(str), dow_stats['avg_total'], color=colors)

    for bar, pct in zip(bars, dow_stats['pct_vs_weekday_avg']):
        sign = '+' if pct > 0 else ''
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1,
                f'{sign}{pct:.0f}%', ha='center', va='bottom', fontsize=9, fontweight='bold')

    ax.set_title('Average Daily Leads by Day of Week (2021-2025)', fontsize=14, fontweight='bold')
    ax.set_ylabel('Average Daily Leads')
    ax.grid(axis='y', alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, 'dow_analysis.png'), dpi=150, bbox_inches='tight')
    plt.close()
    print("  [CHART] dow_analysis.png")


def plot_weekly_seasonal_curve(weekly_curve, avg_weekly):
    """Plot weekly seasonal curve with individual years."""
    fig, ax = plt.subplots(figsize=(14, 7))

    for year in sorted(weekly_curve['year'].unique()):
        subset = weekly_curve[weekly_curve['year'] == year]
        ax.plot(subset['week_num'], subset['weekly_total'], alpha=0.4, linewidth=1, label=str(year))

    ax.plot(avg_weekly['week_num'], avg_weekly['avg_total'], color='black', linewidth=3,
            label='5-Year Average', linestyle='--')

    ax.set_title('Weekly Lead Volume by Season Week (2021-2025)', fontsize=14, fontweight='bold')
    ax.set_xlabel('Calendar Week Number')
    ax.set_ylabel('Weekly Total Leads')
    ax.legend()
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, 'weekly_seasonal_curve.png'), dpi=150, bbox_inches='tight')
    plt.close()
    print("  [CHART] weekly_seasonal_curve.png")

# ---------------------------------------------------------------------------
# 4. WEATHER IMPACT ANALYSIS
# ---------------------------------------------------------------------------

def analyze_weather_impact(daily_weather):
    """Deep-dive into weather's effect on lead volume."""
    print("\n" + "="*70)
    print("WEATHER IMPACT ANALYSIS")
    print("="*70)

    dw = daily_weather.copy()
    dw = dw[dw['year'].isin([2021, 2022, 2023, 2024, 2025])]

    # Classify weather conditions
    dw['weather_condition'] = dw.apply(classify_weather_condition, axis=1)

    # --- Condition buckets ---
    print("\n--- Leads by Weather Condition ---")
    cond_stats = dw.groupby('weather_condition').agg(
        avg_total=('total_leads', 'mean'),
        avg_organic=('organic_leads', 'mean'),
        median_total=('total_leads', 'median'),
        count=('total_leads', 'count'),
    ).reset_index()
    overall_avg = dw['total_leads'].mean()
    cond_stats['pct_vs_baseline'] = ((cond_stats['avg_total'] / overall_avg - 1) * 100).round(1)
    cond_stats = cond_stats.sort_values('avg_total', ascending=False)
    print(cond_stats.to_string(index=False))
    cond_stats.to_csv(os.path.join(OUTPUT_DIR, 'weather_condition_impact.csv'), index=False)

    # --- Temperature buckets ---
    print("\n--- Leads by Temperature Range ---")
    dw['temp_bucket'] = pd.cut(dw['temp_max'], bins=[0, 40, 50, 60, 70, 80, 100],
                                labels=['<40°F', '40-50°F', '50-60°F', '60-70°F', '70-80°F', '80+°F'])
    temp_stats = dw.groupby('temp_bucket', observed=True).agg(
        avg_total=('total_leads', 'mean'),
        avg_organic=('organic_leads', 'mean'),
        count=('total_leads', 'count'),
    ).reset_index()
    temp_stats['pct_vs_baseline'] = ((temp_stats['avg_total'] / overall_avg - 1) * 100).round(1)
    print(temp_stats.to_string(index=False))
    temp_stats.to_csv(os.path.join(OUTPUT_DIR, 'temperature_impact.csv'), index=False)

    # --- Sunshine impact ---
    print("\n--- Leads by Sunshine Hours ---")
    dw['sunshine_bucket'] = pd.cut(dw['sunshine_hrs'], bins=[-1, 2, 5, 8, 15],
                                    labels=['<2hrs', '2-5hrs', '5-8hrs', '8+hrs'])
    sun_stats = dw.groupby('sunshine_bucket', observed=True).agg(
        avg_total=('total_leads', 'mean'),
        avg_organic=('organic_leads', 'mean'),
        count=('total_leads', 'count'),
    ).reset_index()
    sun_stats['pct_vs_baseline'] = ((sun_stats['avg_total'] / overall_avg - 1) * 100).round(1)
    print(sun_stats.to_string(index=False))

    # --- Precipitation impact ---
    print("\n--- Leads by Precipitation ---")
    dw['precip_bucket'] = pd.cut(dw['precip_in'], bins=[-0.01, 0.0, 0.1, 0.5, 5],
                                  labels=['Dry', 'Trace', 'Light Rain', 'Heavy Rain'])
    precip_stats = dw.groupby('precip_bucket', observed=True).agg(
        avg_total=('total_leads', 'mean'),
        avg_organic=('organic_leads', 'mean'),
        count=('total_leads', 'count'),
    ).reset_index()
    precip_stats['pct_vs_baseline'] = ((precip_stats['avg_total'] / overall_avg - 1) * 100).round(1)
    print(precip_stats.to_string(index=False))

    # --- Weekday vs Weekend x Weather ---
    print("\n--- Weekday vs Weekend x Weather Condition ---")
    dw['day_type'] = np.where(dw['dow'] < 5, 'Weekday', np.where(dw['dow'] == 5, 'Saturday', 'Sunday'))
    cross = dw.groupby(['day_type', 'weather_condition']).agg(
        avg_leads=('total_leads', 'mean'),
        count=('total_leads', 'count'),
    ).reset_index()
    print(cross.pivot_table(index='weather_condition', columns='day_type', values='avg_leads').round(1).to_string())

    # --- Correlation matrix ---
    print("\n--- Feature Correlations with Lead Volume ---")
    numeric_cols = ['total_leads', 'organic_leads', 'temp_max', 'temp_min', 'temp_mean',
                    'sunshine_hrs', 'precip_in', 'snowfall_in', 'wind_max_mph', 'day_of_season', 'dow']
    available_cols = [c for c in numeric_cols if c in dw.columns]
    corr = dw[available_cols].corr()['total_leads'].drop('total_leads').sort_values(ascending=False)
    print(corr.round(3).to_string())

    # Weather impact charts
    plot_weather_charts(dw, cond_stats, temp_stats, overall_avg)

    return dw, cond_stats


def plot_weather_charts(dw, cond_stats, temp_stats, overall_avg):
    """Generate weather impact visualizations."""
    fig, axes = plt.subplots(2, 2, figsize=(16, 12))

    # 1. Leads by weather condition
    ax = axes[0, 0]
    colors = {'Sunny': '#FFD700', 'Partly Cloudy': '#87CEEB', 'Cloudy/Overcast': '#808080',
              'Light Rain': '#4682B4', 'Rain': '#1E3A5F', 'Snow': '#E0E0E0'}
    bar_colors = [colors.get(c, '#999999') for c in cond_stats['weather_condition']]
    bars = ax.barh(cond_stats['weather_condition'], cond_stats['avg_total'], color=bar_colors, edgecolor='black', linewidth=0.5)
    ax.axvline(overall_avg, color='red', linestyle='--', linewidth=1.5, label=f'Baseline ({overall_avg:.0f})')
    ax.set_title('Avg Daily Leads by Weather Condition', fontweight='bold')
    ax.set_xlabel('Average Daily Leads')
    ax.legend()

    # 2. Temperature vs Leads scatter
    ax = axes[0, 1]
    weekday = dw[dw['dow'] < 5]
    weekend = dw[dw['dow'] >= 5]
    ax.scatter(weekday['temp_max'], weekday['total_leads'], alpha=0.3, s=15, label='Weekday', color='#2196F3')
    ax.scatter(weekend['temp_max'], weekend['total_leads'], alpha=0.3, s=15, label='Weekend', color='#FF9800')
    # Trend line for weekdays
    if len(weekday) > 10:
        z = np.polyfit(weekday['temp_max'].dropna(), weekday.loc[weekday['temp_max'].notna(), 'total_leads'], 2)
        p = np.poly1d(z)
        x_range = np.linspace(weekday['temp_max'].min(), weekday['temp_max'].max(), 100)
        ax.plot(x_range, p(x_range), 'r-', linewidth=2, label='Weekday Trend')
    ax.set_title('Temperature vs Lead Volume', fontweight='bold')
    ax.set_xlabel('Max Temperature (°F)')
    ax.set_ylabel('Daily Leads')
    ax.legend()

    # 3. Sunshine vs Leads
    ax = axes[1, 0]
    ax.scatter(dw['sunshine_hrs'], dw['total_leads'], alpha=0.3, s=15, c=dw['temp_max'], cmap='RdYlGn')
    ax.set_title('Sunshine Hours vs Lead Volume (color=temp)', fontweight='bold')
    ax.set_xlabel('Sunshine Hours')
    ax.set_ylabel('Daily Leads')

    # 4. Seasonal pattern with weather overlay
    ax = axes[1, 1]
    dw_sorted = dw.sort_values('day_of_season')
    for year in sorted(dw['year'].unique()):
        subset = dw_sorted[dw_sorted['year'] == year]
        roll = subset.set_index('day_of_season')['total_leads'].rolling(7, min_periods=1, center=True).mean()
        ax.plot(roll.index, roll.values, alpha=0.5, linewidth=1, label=str(year))
    # Average snowfall overlay
    ax2 = ax.twinx()
    avg_snow = dw_sorted.groupby('day_of_season')['snowfall_in'].mean()
    ax2.fill_between(avg_snow.index, avg_snow.values, alpha=0.2, color='blue', label='Avg Snowfall')
    ax2.set_ylabel('Avg Snowfall (in)', color='blue')
    ax.set_title('Lead Volume vs Snow (by day of season)', fontweight='bold')
    ax.set_xlabel('Days Since Feb 15')
    ax.set_ylabel('Daily Leads')
    ax.legend(loc='upper left')

    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, 'weather_impact_analysis.png'), dpi=150, bbox_inches='tight')
    plt.close()
    print("  [CHART] weather_impact_analysis.png")

# ---------------------------------------------------------------------------
# 5. PREDICTIVE MODEL
# ---------------------------------------------------------------------------

def build_prediction_model(daily_weather):
    """Build gradient-boosted model for lead prediction."""
    print("\n" + "="*70)
    print("PREDICTIVE MODEL")
    print("="*70)

    dw = daily_weather.copy()
    full_years = dw[dw['year'].isin([2021, 2022, 2023, 2024, 2025])].copy()

    # Feature engineering
    full_years = engineer_features(full_years)
    full_years = full_years.dropna(subset=['temp_max', 'sunshine_hrs'])

    feature_cols = [
        'dow', 'is_weekend', 'is_saturday',
        'day_of_season', 'week_num', 'month',
        'temp_max', 'temp_mean', 'sunshine_hrs',
        'precip_in', 'snowfall_in', 'wind_max_mph',
        'is_snow', 'is_rainy', 'is_sunny',
        'temp_max_3d_avg', 'sunshine_3d_avg',
        'year_trend',
    ]
    available_features = [c for c in feature_cols if c in full_years.columns]

    X = full_years[available_features].copy()
    y_total = full_years['total_leads'].copy()
    y_organic = full_years['organic_leads'].copy()

    # Handle any remaining NaN in features
    X = X.fillna(0)

    print(f"\n  Training samples: {len(X):,}")
    print(f"  Features: {len(available_features)}")
    print(f"  Feature list: {available_features}")

    # --- Model for total leads ---
    print("\n--- Total Leads Model ---")
    model_total, metrics_total = train_and_evaluate(X, y_total, "Total Leads")

    # --- Model for organic leads ---
    print("\n--- Organic/Digital Leads Model ---")
    model_organic, metrics_organic = train_and_evaluate(X, y_organic, "Organic Leads")

    # --- Feature importance ---
    print("\n--- Feature Importance (Total Leads Model) ---")
    importance = pd.DataFrame({
        'feature': available_features,
        'importance': model_total.feature_importances_,
    }).sort_values('importance', ascending=False)
    print(importance.to_string(index=False))
    importance.to_csv(os.path.join(OUTPUT_DIR, 'feature_importance.csv'), index=False)

    # --- Weather uplift quantification ---
    quantify_weather_uplift(model_total, full_years, available_features)

    # Plot model results
    plot_model_results(model_total, X, y_total, full_years, importance, available_features)

    return model_total, model_organic, available_features, metrics_total


def engineer_features(df):
    """Create features for the prediction model."""
    df = df.copy()

    df['is_snow'] = ((df['snowfall_in'].fillna(0) > 0.05) | (df['snow_depth'].fillna(0) > 0.5)).astype(int)
    df['is_rainy'] = (df['rain_in'].fillna(0) > 0.1).astype(int)
    df['is_sunny'] = (df['sunshine_hrs'].fillna(0) >= 8).astype(int)
    df['year_trend'] = df['year'] - 2021  # linear growth trend

    # Rolling weather features (3-day lookback)
    df = df.sort_values('date')
    for year in df['year'].unique():
        mask = df['year'] == year
        df.loc[mask, 'temp_max_3d_avg'] = df.loc[mask, 'temp_max'].rolling(3, min_periods=1).mean()
        df.loc[mask, 'sunshine_3d_avg'] = df.loc[mask, 'sunshine_hrs'].rolling(3, min_periods=1).mean()

    return df


def train_and_evaluate(X, y, label):
    """Train GBR model with time-series cross-validation."""
    model = GradientBoostingRegressor(
        n_estimators=300,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        min_samples_leaf=10,
        random_state=42,
    )

    tscv = TimeSeriesSplit(n_splits=5)
    cv_scores = cross_val_score(model, X, y, cv=tscv, scoring='neg_mean_absolute_error')
    print(f"  Cross-Val MAE: {-cv_scores.mean():.2f} (+/- {cv_scores.std():.2f})")

    model.fit(X, y)
    y_pred = model.predict(X)

    mae = mean_absolute_error(y, y_pred)
    rmse = np.sqrt(mean_squared_error(y, y_pred))
    r2 = r2_score(y, y_pred)
    mape = np.mean(np.abs((y - y_pred) / np.maximum(y, 1))) * 100

    metrics = {'mae': mae, 'rmse': rmse, 'r2': r2, 'mape': mape, 'cv_mae': -cv_scores.mean()}
    print(f"  In-sample MAE: {mae:.2f}")
    print(f"  RMSE: {rmse:.2f}")
    print(f"  R²: {r2:.3f}")
    print(f"  MAPE: {mape:.1f}%")

    return model, metrics


def quantify_weather_uplift(model, df, features):
    """Quantify expected lead uplift/reduction for different weather scenarios."""
    print("\n--- Weather Uplift vs Baseline ---")

    baseline = df[features].median().to_frame().T

    scenarios = {
        'Typical Weekday (baseline)': baseline.copy(),
        'Sunny & Warm (70°F, 10hrs sun)': baseline.assign(
            temp_max=70, temp_mean=60, sunshine_hrs=10, precip_in=0,
            snowfall_in=0, is_snow=0, is_rainy=0, is_sunny=1,
            is_weekend=0, is_saturday=0, dow=2,
            temp_max_3d_avg=68, sunshine_3d_avg=9
        ),
        'Cloudy & Cool (50°F, 3hrs sun)': baseline.assign(
            temp_max=50, temp_mean=42, sunshine_hrs=3, precip_in=0,
            snowfall_in=0, is_snow=0, is_rainy=0, is_sunny=0,
            is_weekend=0, is_saturday=0, dow=2,
            temp_max_3d_avg=52, sunshine_3d_avg=4
        ),
        'Rainy Day (55°F, 1hr sun)': baseline.assign(
            temp_max=55, temp_mean=48, sunshine_hrs=1, precip_in=0.5,
            snowfall_in=0, is_snow=0, is_rainy=1, is_sunny=0,
            is_weekend=0, is_saturday=0, dow=2,
            temp_max_3d_avg=55, sunshine_3d_avg=3
        ),
        'Snow Day (35°F, snow)': baseline.assign(
            temp_max=35, temp_mean=28, sunshine_hrs=2, precip_in=0.3,
            snowfall_in=2, is_snow=1, is_rainy=0, is_sunny=0,
            is_weekend=0, is_saturday=0, dow=2,
            temp_max_3d_avg=36, sunshine_3d_avg=3
        ),
        'Peak Spring (65°F, sunny, Wed)': baseline.assign(
            temp_max=65, temp_mean=55, sunshine_hrs=9, precip_in=0,
            snowfall_in=0, is_snow=0, is_rainy=0, is_sunny=1,
            is_weekend=0, is_saturday=0, dow=2,
            day_of_season=45, week_num=14,
            temp_max_3d_avg=63, sunshine_3d_avg=8
        ),
        'Saturday (same as peak spring)': baseline.assign(
            temp_max=65, temp_mean=55, sunshine_hrs=9, precip_in=0,
            snowfall_in=0, is_snow=0, is_rainy=0, is_sunny=1,
            is_weekend=1, is_saturday=1, dow=5,
            day_of_season=45, week_num=14,
            temp_max_3d_avg=63, sunshine_3d_avg=8
        ),
    }

    baseline_pred = model.predict(baseline[features])[0]
    results = []

    for name, scenario in scenarios.items():
        pred = model.predict(scenario[features])[0]
        uplift = ((pred / baseline_pred) - 1) * 100
        results.append({
            'scenario': name,
            'predicted_leads': round(pred, 1),
            'vs_baseline_pct': round(uplift, 1),
        })
        print(f"  {name}: {pred:.0f} leads ({'+' if uplift > 0 else ''}{uplift:.0f}% vs baseline)")

    results_df = pd.DataFrame(results)
    results_df.to_csv(os.path.join(OUTPUT_DIR, 'weather_uplift_scenarios.csv'), index=False)
    return results_df


def plot_model_results(model, X, y, df, importance, features):
    """Plot model performance and feature importance."""
    y_pred = model.predict(X)

    fig, axes = plt.subplots(2, 2, figsize=(16, 12))

    # 1. Actual vs Predicted
    ax = axes[0, 0]
    ax.scatter(y, y_pred, alpha=0.3, s=10, color='#2196F3')
    max_val = max(y.max(), y_pred.max())
    ax.plot([0, max_val], [0, max_val], 'r--', linewidth=1.5, label='Perfect prediction')
    ax.set_title('Actual vs Predicted Daily Leads', fontweight='bold')
    ax.set_xlabel('Actual Leads')
    ax.set_ylabel('Predicted Leads')
    ax.legend()
    ax.grid(True, alpha=0.3)

    # 2. Feature importance
    ax = axes[0, 1]
    top_features = importance.head(12)
    ax.barh(top_features['feature'], top_features['importance'], color='#4CAF50')
    ax.set_title('Top Feature Importance', fontweight='bold')
    ax.set_xlabel('Importance Score')
    ax.invert_yaxis()

    # 3. Residuals over time
    ax = axes[1, 0]
    residuals = y.values - y_pred
    ax.scatter(df['date'], residuals, alpha=0.3, s=10, c=df['year'], cmap='tab10')
    ax.axhline(0, color='red', linestyle='--', linewidth=1)
    ax.set_title('Prediction Residuals Over Time', fontweight='bold')
    ax.set_xlabel('Date')
    ax.set_ylabel('Residual (Actual - Predicted)')
    ax.grid(True, alpha=0.3)

    # 4. Prediction vs actual for most recent full year
    ax = axes[1, 1]
    recent = df[df['year'] == 2025].copy()
    if len(recent) > 0:
        recent_pred = model.predict(recent[features].fillna(0))
        recent_sorted = recent.sort_values('date')
        ax.plot(recent_sorted['date'], recent_sorted['total_leads'].rolling(7, min_periods=1, center=True).mean(),
                label='Actual (7d avg)', linewidth=2, color='#2196F3')
        ax.plot(recent_sorted['date'],
                pd.Series(recent_pred[recent_sorted.index - recent_sorted.index[0]]).rolling(7, min_periods=1, center=True).mean(),
                label='Predicted (7d avg)', linewidth=2, color='#FF5722', linestyle='--')
        ax.set_title('2025 Season: Actual vs Predicted (7-day avg)', fontweight='bold')
        ax.set_xlabel('Date')
        ax.set_ylabel('Daily Leads')
        ax.legend()
        ax.grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, 'model_performance.png'), dpi=150, bbox_inches='tight')
    plt.close()
    print("  [CHART] model_performance.png")

# ---------------------------------------------------------------------------
# 6. SEASONAL PROJECTION
# ---------------------------------------------------------------------------

def build_seasonal_projection(model, daily_weather, features):
    """Build seasonal baseline projection with confidence intervals."""
    print("\n" + "="*70)
    print("SEASONAL PROJECTION & BASELINE")
    print("="*70)

    dw = daily_weather.copy()
    full_years = dw[dw['year'].isin([2021, 2022, 2023, 2024, 2025])].copy()

    # Calculate average weather by day_of_season across all years
    avg_by_day = full_years.groupby('day_of_season').agg({
        'temp_max': 'mean',
        'temp_mean': 'mean',
        'sunshine_hrs': 'mean',
        'precip_in': 'mean',
        'snowfall_in': 'mean',
        'wind_max_mph': 'mean',
        'total_leads': ['mean', 'std', 'median'],
        'organic_leads': ['mean', 'std'],
    }).reset_index()
    avg_by_day.columns = ['day_of_season', 'avg_temp_max', 'avg_temp_mean', 'avg_sunshine',
                          'avg_precip', 'avg_snow', 'avg_wind',
                          'avg_leads', 'std_leads', 'median_leads',
                          'avg_organic', 'std_organic']

    # Generate baseline predictions for each day of week
    projection_rows = []
    for _, row in avg_by_day.iterrows():
        dos = int(row['day_of_season'])
        base_date = pd.Timestamp(f'2025-02-15') + pd.Timedelta(days=dos)
        week = base_date.isocalendar()[1]
        month_val = base_date.month

        for dow_val in range(7):
            is_wknd = 1 if dow_val >= 5 else 0
            is_sat = 1 if dow_val == 5 else 0

            feature_row = {
                'dow': dow_val,
                'is_weekend': is_wknd,
                'is_saturday': is_sat,
                'day_of_season': dos,
                'week_num': week,
                'month': month_val,
                'temp_max': row['avg_temp_max'],
                'temp_mean': row['avg_temp_mean'],
                'sunshine_hrs': row['avg_sunshine'],
                'precip_in': row['avg_precip'],
                'snowfall_in': row['avg_snow'],
                'wind_max_mph': row['avg_wind'],
                'is_snow': 1 if row['avg_snow'] > 0.05 else 0,
                'is_rainy': 1 if row['avg_precip'] > 0.1 else 0,
                'is_sunny': 1 if row['avg_sunshine'] >= 8 else 0,
                'temp_max_3d_avg': row['avg_temp_max'],
                'sunshine_3d_avg': row['avg_sunshine'],
                'year_trend': 4,  # 2025 level
            }

            available = {k: v for k, v in feature_row.items() if k in features}
            X_pred = pd.DataFrame([available])[features]
            pred = model.predict(X_pred)[0]

            projection_rows.append({
                'day_of_season': dos,
                'dow': dow_val,
                'dow_name': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dow_val],
                'predicted_leads': round(pred, 1),
                'historical_avg': round(row['avg_leads'], 1),
                'historical_std': round(row['std_leads'], 1) if not np.isnan(row['std_leads']) else 0,
            })

    projection = pd.DataFrame(projection_rows)

    # Summary: average predicted by week of season and day type
    print("\n--- Projected Daily Leads by Week of Season ---")
    projection['approx_date'] = pd.to_datetime('2025-02-15') + pd.to_timedelta(projection['day_of_season'], unit='D')
    projection['week_label'] = projection['approx_date'].dt.strftime('Week of %b %d')
    projection['cal_week'] = projection['approx_date'].dt.isocalendar().week.astype(int)

    weekday_proj = projection[projection['dow'] < 5].groupby('cal_week').agg(
        avg_weekday_pred=('predicted_leads', 'mean'),
    ).reset_index()
    sat_proj = projection[projection['dow'] == 5].groupby('cal_week').agg(
        avg_sat_pred=('predicted_leads', 'mean'),
    ).reset_index()

    weekly_proj = weekday_proj.merge(sat_proj, on='cal_week', how='left')
    print(weekly_proj.to_string(index=False))
    projection.to_csv(os.path.join(OUTPUT_DIR, 'seasonal_projection.csv'), index=False)

    # Plot seasonal projection
    plot_seasonal_projection(projection, avg_by_day)

    return projection


def plot_seasonal_projection(projection, avg_by_day):
    """Plot the seasonal baseline projection."""
    fig, axes = plt.subplots(2, 1, figsize=(16, 10))

    # Weekday projection
    weekday = projection[projection['dow'] < 5].groupby('day_of_season').agg(
        pred_mean=('predicted_leads', 'mean'),
    ).reset_index()

    ax = axes[0]
    ax.plot(avg_by_day['day_of_season'], avg_by_day['avg_leads'], color='#808080', linewidth=1, alpha=0.5, label='Historical Avg (all days)')
    ax.fill_between(avg_by_day['day_of_season'],
                     avg_by_day['avg_leads'] - avg_by_day['std_leads'],
                     avg_by_day['avg_leads'] + avg_by_day['std_leads'],
                     alpha=0.15, color='gray', label='±1 Std Dev')
    ax.plot(weekday['day_of_season'], weekday['pred_mean'], color='#4CAF50', linewidth=2.5, label='Model Weekday Prediction')

    # Mark key dates
    key_dates = {0: 'Feb 15', 14: 'Mar 1', 44: 'Apr 1', 75: 'May 1', 84: 'May 10'}
    for dos, lbl in key_dates.items():
        if dos <= avg_by_day['day_of_season'].max():
            ax.axvline(dos, color='gray', linestyle=':', alpha=0.3)
            ax.text(dos, ax.get_ylim()[1] * 0.95, lbl, ha='center', fontsize=8, alpha=0.6)

    ax.set_title('Seasonal Lead Projection: Weekday Baseline', fontsize=14, fontweight='bold')
    ax.set_xlabel('Days Since Feb 15')
    ax.set_ylabel('Predicted Daily Leads')
    ax.legend()
    ax.grid(True, alpha=0.3)

    # Day-of-week multiplier
    ax = axes[1]
    dow_proj = projection.groupby(['dow', 'dow_name']).agg(pred=('predicted_leads', 'mean')).reset_index()
    dow_order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    dow_proj['dow_name'] = pd.Categorical(dow_proj['dow_name'], categories=dow_order, ordered=True)
    dow_proj = dow_proj.sort_values('dow_name')
    weekday_mean = dow_proj[dow_proj['dow'] < 5]['pred'].mean()
    dow_proj['multiplier'] = dow_proj['pred'] / weekday_mean

    colors = ['#2196F3'] * 5 + ['#FF9800', '#F44336']
    bars = ax.bar(dow_proj['dow_name'].astype(str), dow_proj['multiplier'], color=colors)
    ax.axhline(1.0, color='red', linestyle='--', alpha=0.5, label='Weekday Avg = 1.0x')
    for bar, mult in zip(bars, dow_proj['multiplier']):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.02,
                f'{mult:.2f}x', ha='center', fontsize=10, fontweight='bold')
    ax.set_title('Day-of-Week Lead Multiplier (vs Weekday Average)', fontsize=14, fontweight='bold')
    ax.set_ylabel('Lead Multiplier')
    ax.legend()
    ax.grid(axis='y', alpha=0.3)

    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, 'seasonal_projection.png'), dpi=150, bbox_inches='tight')
    plt.close()
    print("  [CHART] seasonal_projection.png")

# ---------------------------------------------------------------------------
# 7. DM DROP TIMING ANALYSIS
# ---------------------------------------------------------------------------

def analyze_dm_timing(daily, daily_weather):
    """Analyze Direct Mail drop timing and lead response patterns."""
    print("\n" + "="*70)
    print("DIRECT MAIL DROP TIMING ANALYSIS")
    print("="*70)

    dw = daily_weather.copy()
    full_years = dw[dw['year'].isin([2021, 2022, 2023, 2024, 2025])]

    # Identify DM spike days (days where DM leads > 2x the median DM day)
    dm_days = full_years[full_years['dm_leads'] > 0].copy()
    if len(dm_days) == 0:
        print("  No DM lead data found.")
        return

    dm_median = dm_days['dm_leads'].median()
    dm_spikes = dm_days[dm_days['dm_leads'] > dm_median * 2].copy()

    print(f"\n  Total days with DM leads: {len(dm_days)}")
    print(f"  DM median daily: {dm_median:.0f}")
    print(f"  DM spike days (>2x median): {len(dm_spikes)}")

    # Weather conditions on DM spike days vs non-spike days
    print("\n--- Weather on DM Spike Days vs Normal ---")
    print(f"  Spike days avg temp: {dm_spikes['temp_max'].mean():.1f}°F")
    print(f"  Non-spike avg temp: {dm_days[~dm_days.index.isin(dm_spikes.index)]['temp_max'].mean():.1f}°F")
    print(f"  Spike days avg sunshine: {dm_spikes['sunshine_hrs'].mean():.1f}hrs")

    # By week of season
    print("\n--- DM Leads by Week of Season ---")
    dm_weekly = dm_days.groupby('week_num').agg(
        avg_dm=('dm_leads', 'mean'),
        total_dm=('dm_leads', 'sum'),
        days=('dm_leads', 'count'),
    ).reset_index()
    print(dm_weekly.to_string(index=False))

    # DM timing vs organic lead baseline
    print("\n--- DM Timing: Does Weather on Drop Day Affect Response? ---")
    if len(dm_spikes) > 10:
        dm_spikes['weather_condition'] = dm_spikes.apply(classify_weather_condition, axis=1)
        dm_cond = dm_spikes.groupby('weather_condition').agg(
            avg_total=('total_leads', 'mean'),
            avg_dm=('dm_leads', 'mean'),
            count=('dm_leads', 'count'),
        ).reset_index()
        print(dm_cond.to_string(index=False))


# ---------------------------------------------------------------------------
# 8. GENERATE SUMMARY REPORT
# ---------------------------------------------------------------------------

def generate_report(yearly, dow_stats, cond_stats, metrics, daily_weather):
    """Generate the final summary report as JSON."""
    print("\n" + "="*70)
    print("SUMMARY REPORT")
    print("="*70)

    dw = daily_weather[daily_weather['year'].isin([2021, 2022, 2023, 2024, 2025])].copy()
    overall_avg = dw['total_leads'].mean()
    weekday_data = dw[dw['dow'] < 5]
    weekend_data = dw[dw['dow'] >= 5]
    saturday_data = dw[dw['dow'] == 5]

    dw['weather_condition'] = dw.apply(classify_weather_condition, axis=1)
    sunny_avg = dw[dw['weather_condition'] == 'Sunny']['total_leads'].mean()
    snow_avg = dw[dw['weather_condition'] == 'Snow']['total_leads'].mean()
    rain_avg = dw[dw['weather_condition'].isin(['Rain', 'Light Rain'])]['total_leads'].mean()
    cloudy_avg = dw[dw['weather_condition'].isin(['Cloudy/Overcast', 'Partly Cloudy'])]['total_leads'].mean()

    report = {
        'title': 'Lawn Lead Prediction Model - Analysis Summary',
        'data_coverage': {
            'years': [2021, 2022, 2023, 2024, 2025],
            'season_window': 'Feb 15 - May 10',
            'total_leads_analyzed': int(dw['total_leads'].sum()),
            'total_days_analyzed': len(dw),
            'weather_location': 'West Chester, PA (representative market)',
        },
        'key_findings': {
            'yoy_growth': {
                'description': 'Lead volume has grown year-over-year',
                'data': yearly[['year', 'total', 'yoy_growth']].to_dict('records'),
            },
            'day_of_week': {
                'weekday_avg': round(weekday_data['total_leads'].mean(), 1),
                'saturday_avg': round(saturday_data['total_leads'].mean(), 1),
                'saturday_discount_pct': round((1 - saturday_data['total_leads'].mean() / weekday_data['total_leads'].mean()) * 100, 1),
                'sunday_avg': round(dw[dw['dow'] == 6]['total_leads'].mean(), 1) if len(dw[dw['dow'] == 6]) > 0 else 0,
                'best_weekday': dow_stats.iloc[0]['dow_name'] if len(dow_stats) > 0 else 'N/A',
            },
            'weather_impact': {
                'sunny_day_avg': round(sunny_avg, 1) if not np.isnan(sunny_avg) else None,
                'sunny_vs_baseline_pct': round((sunny_avg / overall_avg - 1) * 100, 1) if not np.isnan(sunny_avg) else None,
                'snow_day_avg': round(snow_avg, 1) if not np.isnan(snow_avg) else None,
                'snow_vs_baseline_pct': round((snow_avg / overall_avg - 1) * 100, 1) if not np.isnan(snow_avg) else None,
                'rain_day_avg': round(rain_avg, 1) if not np.isnan(rain_avg) else None,
                'rain_vs_baseline_pct': round((rain_avg / overall_avg - 1) * 100, 1) if not np.isnan(rain_avg) else None,
                'cloudy_day_avg': round(cloudy_avg, 1) if not np.isnan(cloudy_avg) else None,
                'cloudy_vs_baseline_pct': round((cloudy_avg / overall_avg - 1) * 100, 1) if not np.isnan(cloudy_avg) else None,
            },
            'seasonality': {
                'peak_period': 'Mid-March to Mid-April (typically weeks 11-15)',
                'ramp_up_starts': 'Late February / Early March',
                'wind_down': 'Late April into May',
            },
        },
        'model_performance': {
            'algorithm': 'Gradient Boosted Regression',
            'cross_val_mae': round(metrics['cv_mae'], 2),
            'r_squared': round(metrics['r2'], 3),
            'mape': round(metrics['mape'], 1),
        },
        'dashboard_integration': {
            'daily_forecast': 'Use model to predict next 7-14 days of expected leads based on weather forecast',
            'weather_adjustment': 'Show expected lead multiplier: Sunny +X%, Snow -Y%, Rain -Z% vs baseline',
            'seasonal_baseline': 'Display historical seasonal curve with current year overlay',
            'dm_timing': 'Highlight optimal DM drop windows (warm, sunny weeks ahead)',
            'api_endpoint_suggestion': '/api/leads/forecast?date=YYYY-MM-DD&temp_max=70&sunshine_hrs=9&dow=2',
        },
    }

    report_path = os.path.join(OUTPUT_DIR, 'analysis_report.json')
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2, default=str)
    print(f"  Report saved to {report_path}")

    return report

# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    workspace_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    print("="*70)
    print("LAWN LEAD PREDICTION MODEL")
    print("="*70)
    print(f"Workspace: {workspace_root}")
    print(f"Output: {OUTPUT_DIR}")

    # 1. Load lead data
    print("\n--- Loading Lead Data ---")
    leads = load_lead_files(workspace_root)
    leads_season = filter_season(leads)
    daily = aggregate_daily(leads_season)
    print(f"  Daily records: {len(daily)}")
    print(f"  Date range: {daily['date'].min().date()} to {daily['date'].max().date()}")

    # Save source breakdown
    leads_season_copy = leads_season.copy()
    leads_season_copy['source_type'] = leads_season_copy['source'].apply(classify_source)
    source_counts = leads_season_copy.groupby(['source', 'source_type']).size().reset_index(name='count')
    source_counts = source_counts.sort_values('count', ascending=False)
    source_counts.to_csv(os.path.join(OUTPUT_DIR, 'source_breakdown.csv'), index=False)

    # 2. Fetch weather data
    print("\n--- Fetching Weather Data ---")
    weather = fetch_all_weather()
    if weather.empty:
        print("  ERROR: Could not fetch weather data. Exiting.")
        sys.exit(1)

    # 3. Merge leads + weather
    print("\n--- Merging Leads + Weather ---")
    daily_weather = daily.merge(weather, on='date', how='left')
    weather_coverage = daily_weather['temp_max'].notna().sum()
    print(f"  Days with weather data: {weather_coverage}/{len(daily_weather)} ({weather_coverage/len(daily_weather)*100:.0f}%)")
    daily_weather.to_csv(os.path.join(OUTPUT_DIR, 'daily_leads_weather.csv'), index=False)

    # 4. EDA
    yearly, dow_stats, avg_weekly = run_eda(daily, daily_weather)

    # 5. Weather impact
    dw_analyzed, cond_stats = analyze_weather_impact(daily_weather)

    # 6. Build model
    model_total, model_organic, features, metrics = build_prediction_model(daily_weather)

    # 7. Seasonal projection
    projection = build_seasonal_projection(model_total, daily_weather, features)

    # 8. DM timing analysis
    analyze_dm_timing(daily, daily_weather)

    # 9. Generate report
    report = generate_report(yearly, dow_stats, cond_stats, metrics, daily_weather)

    print("\n" + "="*70)
    print("ANALYSIS COMPLETE")
    print("="*70)
    print(f"All outputs saved to: {OUTPUT_DIR}")
    print(f"Charts: {len([f for f in os.listdir(OUTPUT_DIR) if f.endswith('.png')])} PNG files")
    print(f"Data: {len([f for f in os.listdir(OUTPUT_DIR) if f.endswith('.csv')])} CSV files")
    print(f"Report: analysis_report.json")

    return report


if __name__ == '__main__':
    report = main()
