"""
Weather Momentum Analysis
=========================
Investigates:
1. One-day pop: Does a single nice day after bad weather produce a lead spike?
2. Sustained streaks: Do consecutive nice days compound the effect?
3. Regression: When weather turns bad after a good stretch, how fast do leads drop?
"""

import os
import json
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import warnings
warnings.filterwarnings('ignore')

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')

def load_data():
    df = pd.read_csv(os.path.join(OUTPUT_DIR, 'daily_leads_weather.csv'), parse_dates=['date'])
    df = df[df['year'].isin([2021, 2022, 2023, 2024, 2025])].copy()
    df = df[df['dow'] < 6].copy()  # Mon-Sat only (exclude Sunday for cleaner signal)
    df = df.sort_values('date').reset_index(drop=True)
    return df


def classify_day_weather(row):
    sunshine = row.get('sunshine_hrs', 0) or 0
    temp = row.get('temp_max', 50) or 50
    precip = row.get('precip_in', 0) or 0
    snow = row.get('snowfall_in', 0) or 0

    if snow > 0.1 or (row.get('snow_depth', 0) or 0) > 1:
        return 'bad'
    if precip > 0.2:
        return 'bad'
    if sunshine >= 7 and temp >= 55:
        return 'nice'
    if sunshine >= 5 and temp >= 50:
        return 'ok'
    if sunshine < 3 or temp < 42:
        return 'bad'
    return 'ok'


def normalize_leads(df):
    """Normalize leads relative to year+week baseline to remove seasonal/growth trends."""
    df = df.copy()
    weekday_data = df[df['dow'] < 5]
    baselines = weekday_data.groupby(['year', 'week_num'])['total_leads'].mean().reset_index()
    baselines.columns = ['year', 'week_num', 'week_baseline']
    df = df.merge(baselines, on=['year', 'week_num'], how='left')
    df['week_baseline'] = df['week_baseline'].fillna(df['total_leads'].mean())
    df['leads_vs_baseline'] = (df['total_leads'] / df['week_baseline'] - 1) * 100
    df['leads_ratio'] = df['total_leads'] / df['week_baseline']
    return df


def build_streaks(df):
    """Tag each day with its streak context."""
    df = df.copy()
    df['weather_quality'] = df.apply(classify_day_weather, axis=1)

    # Build streak counters within each year
    df['nice_streak'] = 0
    df['bad_streak'] = 0
    df['prev_day_quality'] = None
    df['prev_2day_quality'] = None

    for year in df['year'].unique():
        mask = df['year'] == year
        idx = df[mask].index
        nice_count = 0
        bad_count = 0
        qualities = []

        for i, ix in enumerate(idx):
            q = df.loc[ix, 'weather_quality']

            if q == 'nice':
                nice_count += 1
                bad_count = 0
            elif q == 'bad':
                bad_count += 1
                nice_count = 0
            else:
                nice_count = 0
                bad_count = 0

            df.loc[ix, 'nice_streak'] = nice_count
            df.loc[ix, 'bad_streak'] = bad_count

            if len(qualities) >= 1:
                df.loc[ix, 'prev_day_quality'] = qualities[-1]
            if len(qualities) >= 2:
                df.loc[ix, 'prev_2day_quality'] = qualities[-2]
            qualities.append(q)

    return df


def analyze_transitions(df):
    """Analyze what happens when weather transitions between nice/bad."""
    print("\n" + "="*70)
    print("WEATHER TRANSITION ANALYSIS")
    print("="*70)

    weekdays = df[df['dow'] < 5].copy()

    # Define transition types
    transitions = {
        'bad_to_nice': weekdays[(weekdays['prev_day_quality'] == 'bad') & (weekdays['weather_quality'] == 'nice')],
        'nice_to_bad': weekdays[(weekdays['prev_day_quality'] == 'nice') & (weekdays['weather_quality'] == 'bad')],
        'nice_to_nice': weekdays[(weekdays['prev_day_quality'] == 'nice') & (weekdays['weather_quality'] == 'nice')],
        'bad_to_bad': weekdays[(weekdays['prev_day_quality'] == 'bad') & (weekdays['weather_quality'] == 'bad')],
        'ok_to_nice': weekdays[(weekdays['prev_day_quality'] == 'ok') & (weekdays['weather_quality'] == 'nice')],
        'nice_to_ok': weekdays[(weekdays['prev_day_quality'] == 'nice') & (weekdays['weather_quality'] == 'ok')],
    }

    print("\n--- Lead Performance by Weather Transition (weekdays only) ---")
    print(f"{'Transition':<20} {'Avg Leads vs Baseline':>22} {'Avg Lead Ratio':>15} {'Count':>6}")
    print("-" * 70)

    results = []
    for name, subset in transitions.items():
        if len(subset) >= 3:
            avg_pct = subset['leads_vs_baseline'].mean()
            avg_ratio = subset['leads_ratio'].mean()
            count = len(subset)
            print(f"{name:<20} {avg_pct:>+20.1f}% {avg_ratio:>14.2f}x {count:>6}")
            results.append({'transition': name, 'avg_vs_baseline_pct': round(avg_pct, 1),
                           'avg_ratio': round(avg_ratio, 2), 'count': count})

    return results


def analyze_streaks(df):
    """Analyze how streak length affects lead volume."""
    print("\n" + "="*70)
    print("STREAK LENGTH ANALYSIS")
    print("="*70)

    weekdays = df[df['dow'] < 5].copy()

    # Nice day streaks
    print("\n--- Nice Weather Streak Impact (weekdays only) ---")
    print(f"{'Nice Streak Length':<20} {'Avg Leads':>10} {'vs Baseline':>12} {'Count':>6}")
    print("-" * 55)

    nice_results = []
    for streak_len in range(1, 6):
        if streak_len < 5:
            subset = weekdays[weekdays['nice_streak'] == streak_len]
        else:
            subset = weekdays[weekdays['nice_streak'] >= streak_len]
            streak_label = f"{streak_len}+"
        label = str(streak_len) if streak_len < 5 else f"{streak_len}+"

        if len(subset) >= 3:
            avg_leads = subset['total_leads'].mean()
            avg_pct = subset['leads_vs_baseline'].mean()
            count = len(subset)
            print(f"  {label} day(s) nice{'':<8} {avg_leads:>9.0f} {avg_pct:>+10.1f}% {count:>6}")
            nice_results.append({'streak': label, 'avg_leads': round(avg_leads, 1),
                               'vs_baseline_pct': round(avg_pct, 1), 'count': count})

    # Bad day streaks
    print(f"\n--- Bad Weather Streak Impact (weekdays only) ---")
    print(f"{'Bad Streak Length':<20} {'Avg Leads':>10} {'vs Baseline':>12} {'Count':>6}")
    print("-" * 55)

    bad_results = []
    for streak_len in range(1, 5):
        if streak_len < 4:
            subset = weekdays[weekdays['bad_streak'] == streak_len]
        else:
            subset = weekdays[weekdays['bad_streak'] >= streak_len]
        label = str(streak_len) if streak_len < 4 else f"{streak_len}+"

        if len(subset) >= 3:
            avg_leads = subset['total_leads'].mean()
            avg_pct = subset['leads_vs_baseline'].mean()
            count = len(subset)
            print(f"  {label} day(s) bad{'':<9} {avg_leads:>9.0f} {avg_pct:>+10.1f}% {count:>6}")
            bad_results.append({'streak': label, 'avg_leads': round(avg_leads, 1),
                               'vs_baseline_pct': round(avg_pct, 1), 'count': count})

    return nice_results, bad_results


def analyze_pop_and_regression(df):
    """Analyze the 'one-day pop' pattern: nice day after bad, then what happens next?"""
    print("\n" + "="*70)
    print("ONE-DAY POP & REGRESSION ANALYSIS")
    print("="*70)

    weekdays = df[df['dow'] < 5].copy().sort_values('date').reset_index(drop=True)

    # Find "pop" days: a nice day after 1+ bad days
    pop_days = weekdays[
        (weekdays['weather_quality'] == 'nice') &
        (weekdays['prev_day_quality'] == 'bad')
    ].copy()

    print(f"\n  Found {len(pop_days)} 'pop' days (nice day after bad day)")

    if len(pop_days) < 5:
        print("  Not enough data for pop analysis.")
        return {}

    # For each pop day, look at what happened the next 1-3 days
    pop_sequences = []
    for _, pop_row in pop_days.iterrows():
        pop_date = pop_row['date']
        sequence = {'pop_date': pop_date, 'pop_leads_ratio': pop_row['leads_ratio'],
                    'pop_quality': 'nice'}

        for offset in [1, 2, 3]:
            next_date = pop_date + pd.Timedelta(days=offset)
            next_row = weekdays[weekdays['date'] == next_date]
            if len(next_row) == 1:
                nr = next_row.iloc[0]
                sequence[f'day{offset}_quality'] = nr['weather_quality']
                sequence[f'day{offset}_leads_ratio'] = nr['leads_ratio']
                sequence[f'day{offset}_vs_baseline'] = nr['leads_vs_baseline']
            else:
                sequence[f'day{offset}_quality'] = None
                sequence[f'day{offset}_leads_ratio'] = None
                sequence[f'day{offset}_vs_baseline'] = None

        pop_sequences.append(sequence)

    pop_df = pd.DataFrame(pop_sequences)

    # Group by what happened next
    print("\n--- After a One-Day Pop, What Happens Next Day? ---")
    next_nice = pop_df[pop_df['day1_quality'] == 'nice']
    next_bad = pop_df[pop_df['day1_quality'] == 'bad']
    next_ok = pop_df[pop_df['day1_quality'] == 'ok']

    pop_avg = pop_df['pop_leads_ratio'].mean()
    print(f"  Pop day itself: {pop_avg:.2f}x baseline ({len(pop_df)} days)")

    results = {}
    if len(next_nice) >= 2:
        ratio = next_nice['day1_leads_ratio'].mean()
        print(f"  Next day NICE:  {ratio:.2f}x baseline ({len(next_nice)} days) -- {'HELD' if ratio >= pop_avg * 0.9 else 'FADED'}")
        results['pop_then_nice'] = round(ratio, 2)
    if len(next_ok) >= 2:
        ratio = next_ok['day1_leads_ratio'].mean()
        print(f"  Next day OK:    {ratio:.2f}x baseline ({len(next_ok)} days) -- {'HELD' if ratio >= pop_avg * 0.9 else 'FADED'}")
        results['pop_then_ok'] = round(ratio, 2)
    if len(next_bad) >= 2:
        ratio = next_bad['day1_leads_ratio'].mean()
        print(f"  Next day BAD:   {ratio:.2f}x baseline ({len(next_bad)} days) -- {'HELD' if ratio >= pop_avg * 0.9 else 'REGRESSED'}")
        results['pop_then_bad'] = round(ratio, 2)

    # Multi-day follow-through
    print("\n--- 3-Day Sequence After Pop: Does Nice Weather Sustain the Pop? ---")

    sustained = pop_df[
        (pop_df['day1_quality'] == 'nice') &
        (pop_df['day2_quality'].isin(['nice', 'ok']))
    ]
    regressed = pop_df[
        (pop_df['day1_quality'] == 'bad') |
        ((pop_df['day1_quality'] == 'ok') & (pop_df['day2_quality'] == 'bad'))
    ]

    if len(sustained) >= 2:
        d0 = sustained['pop_leads_ratio'].mean()
        d1 = sustained['day1_leads_ratio'].mean()
        d2 = sustained['day2_leads_ratio'].dropna().mean()
        print(f"  SUSTAINED (nice→nice/ok): Day0={d0:.2f}x → Day1={d1:.2f}x → Day2={d2:.2f}x  ({len(sustained)} sequences)")
        results['sustained_d0'] = round(d0, 2)
        results['sustained_d1'] = round(d1, 2)
        results['sustained_d2'] = round(d2, 2)

    if len(regressed) >= 2:
        d0 = regressed['pop_leads_ratio'].mean()
        d1 = regressed['day1_leads_ratio'].mean()
        d2 = regressed['day2_leads_ratio'].dropna().mean()
        print(f"  REGRESSED (→bad):         Day0={d0:.2f}x → Day1={d1:.2f}x → Day2={d2:.2f}x  ({len(regressed)} sequences)")
        results['regressed_d0'] = round(d0, 2)
        results['regressed_d1'] = round(d1, 2)
        results['regressed_d2'] = round(d2, 2)

    return results


def analyze_saturday_momentum(df):
    """Analyze if a good weather weekday streak affects Saturday volume."""
    print("\n" + "="*70)
    print("WEEKDAY WEATHER → SATURDAY IMPACT")
    print("="*70)

    saturdays = df[df['dow'] == 5].copy()
    if len(saturdays) < 10:
        print("  Not enough Saturday data.")
        return

    # For each Saturday, count nice weekdays in the preceding Mon-Fri
    sat_context = []
    for _, sat_row in saturdays.iterrows():
        sat_date = sat_row['date']
        preceding_week = df[
            (df['date'] >= sat_date - pd.Timedelta(days=5)) &
            (df['date'] < sat_date) &
            (df['dow'] < 5)
        ]
        if len(preceding_week) == 0:
            continue

        nice_days = (preceding_week['weather_quality'] == 'nice').sum()
        avg_temp = preceding_week['temp_max'].mean()
        avg_sun = preceding_week['sunshine_hrs'].mean()

        sat_context.append({
            'date': sat_date,
            'sat_leads': sat_row['total_leads'],
            'sat_leads_ratio': sat_row['leads_ratio'],
            'sat_quality': sat_row['weather_quality'],
            'nice_weekdays_prior': nice_days,
            'avg_weekday_temp': avg_temp,
            'avg_weekday_sun': avg_sun,
        })

    sat_df = pd.DataFrame(sat_context)

    print(f"\n--- Saturday Leads by # Nice Weekdays in Preceding Week ---")
    print(f"{'Nice Weekdays Prior':<22} {'Avg Sat Leads':>14} {'Count':>6}")
    print("-" * 45)

    for n in range(6):
        if n < 5:
            subset = sat_df[sat_df['nice_weekdays_prior'] == n]
        else:
            subset = sat_df[sat_df['nice_weekdays_prior'] >= n]
        label = str(n) if n < 5 else f"{n}+"
        if len(subset) >= 2:
            avg = subset['sat_leads'].mean()
            print(f"  {label:<20} {avg:>13.0f} {len(subset):>6}")


def rebuild_model_with_momentum(df):
    """Rebuild the predictive model with momentum/streak features added."""
    print("\n" + "="*70)
    print("ENHANCED MODEL WITH MOMENTUM FEATURES")
    print("="*70)

    from sklearn.ensemble import GradientBoostingRegressor
    from sklearn.model_selection import TimeSeriesSplit, cross_val_score
    from sklearn.metrics import mean_absolute_error, r2_score

    dw = df.copy()
    dw = dw.dropna(subset=['temp_max', 'sunshine_hrs'])

    # Engineer all features including momentum
    dw['is_snow'] = ((dw['snowfall_in'].fillna(0) > 0.05) | (dw['snow_depth'].fillna(0) > 0.5)).astype(int)
    dw['is_rainy'] = (dw['rain_in'].fillna(0) > 0.1).astype(int)
    dw['is_sunny'] = (dw['sunshine_hrs'].fillna(0) >= 8).astype(int)
    dw['year_trend'] = dw['year'] - 2021

    # Rolling features
    for year in dw['year'].unique():
        mask = dw['year'] == year
        dw.loc[mask, 'temp_max_3d_avg'] = dw.loc[mask, 'temp_max'].rolling(3, min_periods=1).mean()
        dw.loc[mask, 'sunshine_3d_avg'] = dw.loc[mask, 'sunshine_hrs'].rolling(3, min_periods=1).mean()
        dw.loc[mask, 'temp_max_prev'] = dw.loc[mask, 'temp_max'].shift(1)
        dw.loc[mask, 'sunshine_prev'] = dw.loc[mask, 'sunshine_hrs'].shift(1)

    # Momentum features
    dw['temp_change_1d'] = dw['temp_max'] - dw['temp_max_prev'].fillna(dw['temp_max'])
    dw['sunshine_change_1d'] = dw['sunshine_hrs'] - dw['sunshine_prev'].fillna(dw['sunshine_hrs'])
    dw['nice_streak'] = dw['nice_streak'].fillna(0)
    dw['bad_streak'] = dw['bad_streak'].fillna(0)

    # Weather quality as numeric
    quality_map = {'nice': 2, 'ok': 1, 'bad': 0}
    dw['weather_quality_num'] = dw['weather_quality'].map(quality_map).fillna(1)

    # Previous day quality
    dw['prev_quality_num'] = dw['prev_day_quality'].map(quality_map).fillna(1)

    # Transition flag: nice after bad = potential pop
    dw['is_pop_day'] = ((dw['weather_quality'] == 'nice') & (dw['prev_day_quality'] == 'bad')).astype(int)

    # --- Original model features ---
    original_features = [
        'dow', 'is_weekend', 'is_saturday',
        'day_of_season', 'week_num', 'month',
        'temp_max', 'temp_mean', 'sunshine_hrs',
        'precip_in', 'snowfall_in', 'wind_max_mph',
        'is_snow', 'is_rainy', 'is_sunny',
        'temp_max_3d_avg', 'sunshine_3d_avg',
        'year_trend',
    ]

    # --- Enhanced model features (adds momentum) ---
    momentum_features = original_features + [
        'nice_streak', 'bad_streak',
        'temp_change_1d', 'sunshine_change_1d',
        'weather_quality_num', 'prev_quality_num',
        'is_pop_day',
    ]

    available_original = [c for c in original_features if c in dw.columns]
    available_momentum = [c for c in momentum_features if c in dw.columns]

    X_orig = dw[available_original].fillna(0)
    X_momentum = dw[available_momentum].fillna(0)
    y = dw['total_leads']

    tscv = TimeSeriesSplit(n_splits=5)

    # Original model
    model_orig = GradientBoostingRegressor(
        n_estimators=300, max_depth=4, learning_rate=0.05,
        subsample=0.8, min_samples_leaf=10, random_state=42,
    )
    cv_orig = cross_val_score(model_orig, X_orig, y, cv=tscv, scoring='neg_mean_absolute_error')
    model_orig.fit(X_orig, y)
    pred_orig = model_orig.predict(X_orig)
    r2_orig = r2_score(y, pred_orig)

    # Enhanced model
    model_enhanced = GradientBoostingRegressor(
        n_estimators=300, max_depth=4, learning_rate=0.05,
        subsample=0.8, min_samples_leaf=10, random_state=42,
    )
    cv_enhanced = cross_val_score(model_enhanced, X_momentum, y, cv=tscv, scoring='neg_mean_absolute_error')
    model_enhanced.fit(X_momentum, y)
    pred_enhanced = model_enhanced.predict(X_momentum)
    r2_enhanced = r2_score(y, pred_enhanced)

    print(f"\n--- Model Comparison ---")
    print(f"{'Metric':<25} {'Original':>12} {'+ Momentum':>12} {'Improvement':>12}")
    print("-" * 65)
    print(f"{'Cross-Val MAE':<25} {-cv_orig.mean():>11.2f} {-cv_enhanced.mean():>11.2f} {(-cv_enhanced.mean()) - (-cv_orig.mean()):>+11.2f}")
    print(f"{'R²':<25} {r2_orig:>11.3f} {r2_enhanced:>11.3f} {r2_enhanced - r2_orig:>+11.4f}")

    # Feature importance for enhanced model
    print(f"\n--- Enhanced Model Feature Importance ---")
    importance = pd.DataFrame({
        'feature': available_momentum,
        'importance': model_enhanced.feature_importances_,
    }).sort_values('importance', ascending=False)
    print(importance.to_string(index=False))
    importance.to_csv(os.path.join(OUTPUT_DIR, 'enhanced_feature_importance.csv'), index=False)

    # Momentum-specific features contribution
    momentum_only = ['nice_streak', 'bad_streak', 'temp_change_1d', 'sunshine_change_1d',
                     'weather_quality_num', 'prev_quality_num', 'is_pop_day']
    momentum_importance = importance[importance['feature'].isin(momentum_only)]['importance'].sum()
    print(f"\n  Total momentum feature importance: {momentum_importance:.3f} ({momentum_importance*100:.1f}%)")

    # Export enhanced model coefficients
    export_momentum_coefficients(dw, model_enhanced, available_momentum)

    return model_enhanced, available_momentum, {
        'original_cv_mae': round(-cv_orig.mean(), 2),
        'enhanced_cv_mae': round(-cv_enhanced.mean(), 2),
        'original_r2': round(r2_orig, 3),
        'enhanced_r2': round(r2_enhanced, 3),
        'momentum_importance_pct': round(momentum_importance * 100, 1),
    }


def export_momentum_coefficients(df, model, features):
    """Export momentum-aware lookup values for the dashboard."""
    weekdays = df[df['dow'] < 5]

    streak_multipliers = {}
    for streak_len in range(0, 6):
        label = str(streak_len) if streak_len < 5 else "5+"
        if streak_len < 5:
            subset = weekdays[weekdays['nice_streak'] == streak_len]
        else:
            subset = weekdays[weekdays['nice_streak'] >= streak_len]
        if len(subset) >= 3:
            baseline = weekdays['total_leads'].mean()
            avg = subset['total_leads'].mean()
            streak_multipliers[label] = round(avg / baseline, 2)

    bad_streak_multipliers = {}
    for streak_len in range(0, 5):
        label = str(streak_len) if streak_len < 4 else "4+"
        if streak_len < 4:
            subset = weekdays[weekdays['bad_streak'] == streak_len]
        else:
            subset = weekdays[weekdays['bad_streak'] >= streak_len]
        if len(subset) >= 3:
            baseline = weekdays['total_leads'].mean()
            avg = subset['total_leads'].mean()
            bad_streak_multipliers[label] = round(avg / baseline, 2)

    coeffs = {
        'nice_streak_multipliers': streak_multipliers,
        'bad_streak_multipliers': bad_streak_multipliers,
        '_note': 'Apply on top of base forecast. nice_streak=0 means no streak (baseline). Values are ratios vs weekday avg.',
    }

    with open(os.path.join(OUTPUT_DIR, 'momentum_coefficients.json'), 'w') as f:
        json.dump(coeffs, f, indent=2)
    print(f"  Momentum coefficients saved to momentum_coefficients.json")


def plot_momentum_charts(df, transition_results, nice_results, bad_results, pop_results):
    """Generate momentum analysis visualizations."""
    fig, axes = plt.subplots(2, 2, figsize=(16, 12))

    weekdays = df[df['dow'] < 5].copy()

    # 1. Nice streak impact
    ax = axes[0, 0]
    if nice_results:
        streaks = [r['streak'] for r in nice_results]
        vals = [r['vs_baseline_pct'] for r in nice_results]
        colors = ['#4CAF50' if v > 0 else '#F44336' for v in vals]
        bars = ax.bar(streaks, vals, color=colors)
        for bar, v in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5,
                    f'{v:+.0f}%', ha='center', fontsize=10, fontweight='bold')
        ax.set_title('Lead Impact by Nice Weather Streak Length', fontweight='bold')
        ax.set_xlabel('Consecutive Nice Days')
        ax.set_ylabel('vs Week Baseline (%)')
        ax.axhline(0, color='gray', linestyle='--', alpha=0.5)
        ax.grid(axis='y', alpha=0.3)

    # 2. Bad streak impact
    ax = axes[0, 1]
    if bad_results:
        streaks = [r['streak'] for r in bad_results]
        vals = [r['vs_baseline_pct'] for r in bad_results]
        colors = ['#4CAF50' if v > 0 else '#F44336' for v in vals]
        bars = ax.bar(streaks, vals, color=colors)
        for bar, v in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width()/2,
                    bar.get_height() + 0.5 if v > 0 else bar.get_height() - 2,
                    f'{v:+.0f}%', ha='center', fontsize=10, fontweight='bold')
        ax.set_title('Lead Impact by Bad Weather Streak Length', fontweight='bold')
        ax.set_xlabel('Consecutive Bad Days')
        ax.set_ylabel('vs Week Baseline (%)')
        ax.axhline(0, color='gray', linestyle='--', alpha=0.5)
        ax.grid(axis='y', alpha=0.3)

    # 3. Pop day: sustained vs regressed
    ax = axes[1, 0]
    if pop_results and 'sustained_d0' in pop_results and 'regressed_d0' in pop_results:
        days = ['Pop Day\n(Day 0)', 'Day 1', 'Day 2']
        sustained = [pop_results.get('sustained_d0', 0), pop_results.get('sustained_d1', 0), pop_results.get('sustained_d2', 0)]
        regressed = [pop_results.get('regressed_d0', 0), pop_results.get('regressed_d1', 0), pop_results.get('regressed_d2', 0)]

        x = np.arange(len(days))
        w = 0.35
        ax.bar(x - w/2, sustained, w, label='Nice weather continues', color='#4CAF50', alpha=0.8)
        ax.bar(x + w/2, regressed, w, label='Weather turns bad', color='#F44336', alpha=0.8)
        ax.set_xticks(x)
        ax.set_xticklabels(days)
        ax.set_ylabel('Leads Ratio (vs week baseline)')
        ax.set_title('One-Day Pop: Does It Hold or Regress?', fontweight='bold')
        ax.axhline(1.0, color='gray', linestyle='--', alpha=0.5, label='Baseline')
        ax.legend()
        ax.grid(axis='y', alpha=0.3)
    else:
        ax.text(0.5, 0.5, 'Insufficient data\nfor pop analysis', ha='center', va='center', fontsize=12)
        ax.set_title('One-Day Pop: Does It Hold or Regress?', fontweight='bold')

    # 4. Weather transition heatmap
    ax = axes[1, 1]
    transition_data = weekdays.copy()
    transition_data = transition_data.dropna(subset=['prev_day_quality'])
    pivot = transition_data.pivot_table(
        values='leads_vs_baseline',
        index='prev_day_quality',
        columns='weather_quality',
        aggfunc='mean'
    )
    order = ['bad', 'ok', 'nice']
    pivot = pivot.reindex(index=[o for o in order if o in pivot.index],
                          columns=[o for o in order if o in pivot.columns])
    pivot.index = [f'Yesterday: {x.title()}' for x in pivot.index]
    pivot.columns = [f'Today: {x.title()}' for x in pivot.columns]

    import matplotlib.colors as mcolors
    norm = mcolors.TwoSlopeNorm(vmin=pivot.min().min(), vcenter=0, vmax=pivot.max().max())
    im = ax.imshow(pivot.values, cmap='RdYlGn', norm=norm, aspect='auto')
    ax.set_xticks(range(len(pivot.columns)))
    ax.set_xticklabels(pivot.columns, fontsize=9)
    ax.set_yticks(range(len(pivot.index)))
    ax.set_yticklabels(pivot.index, fontsize=9)
    for i in range(len(pivot.index)):
        for j in range(len(pivot.columns)):
            val = pivot.values[i, j]
            ax.text(j, i, f'{val:+.0f}%', ha='center', va='center', fontsize=11, fontweight='bold')
    ax.set_title('Leads vs Baseline by Weather Transition', fontweight='bold')
    plt.colorbar(im, ax=ax, label='% vs Baseline')

    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, 'weather_momentum.png'), dpi=150, bbox_inches='tight')
    plt.close()
    print("  [CHART] weather_momentum.png")


def main():
    print("="*70)
    print("WEATHER MOMENTUM & STREAK ANALYSIS")
    print("="*70)

    df = load_data()
    print(f"  Loaded {len(df):,} days (Mon-Sat, 2021-2025)")

    df = normalize_leads(df)
    df = build_streaks(df)

    # Quality distribution
    print(f"\n  Weather quality distribution:")
    print(f"    {df['weather_quality'].value_counts().to_dict()}")

    # Run analyses
    transition_results = analyze_transitions(df)
    nice_results, bad_results = analyze_streaks(df)
    pop_results = analyze_pop_and_regression(df)
    analyze_saturday_momentum(df)

    # Rebuild model with momentum features
    model, features, model_comparison = rebuild_model_with_momentum(df)

    # Generate charts
    plot_momentum_charts(df, transition_results, nice_results, bad_results, pop_results)

    # Save summary
    summary = {
        'transitions': transition_results,
        'nice_streaks': nice_results,
        'bad_streaks': bad_results,
        'pop_analysis': pop_results,
        'model_comparison': model_comparison,
    }
    with open(os.path.join(OUTPUT_DIR, 'momentum_analysis.json'), 'w') as f:
        json.dump(summary, f, indent=2)

    print("\n" + "="*70)
    print("MOMENTUM ANALYSIS COMPLETE")
    print("="*70)

    return summary


if __name__ == '__main__':
    summary = main()
