"""
Seasonal x Weather Interaction Analysis
========================================
Investigates whether weather's impact on leads changes across the season:
- Does weather matter more in the early ramp-up (Feb-early Mar)?
- Does weather matter less during peak (mid-Mar to mid-Apr)?
- Does weather matter more again in the tail (late Apr-May)?
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


def load_data():
    df = pd.read_csv(os.path.join(OUTPUT_DIR, 'daily_leads_weather.csv'), parse_dates=['date'])
    df = df[df['year'].isin([2021, 2022, 2023, 2024, 2025])].copy()
    df = df.sort_values('date').reset_index(drop=True)
    return df


def define_season_phases(df):
    """Split season into early / ramp / peak / tail phases."""
    df = df.copy()
    conditions = [
        (df['day_of_season'] < 14),              # Feb 15 - Mar 1: early
        (df['day_of_season'] >= 14) & (df['day_of_season'] < 30),  # Mar 1-17: ramp
        (df['day_of_season'] >= 30) & (df['day_of_season'] < 60),  # Mar 17 - Apr 16: peak
        (df['day_of_season'] >= 60),              # Apr 16 - May 10: tail
    ]
    labels = ['Early (Feb 15-Mar 1)', 'Ramp (Mar 1-17)', 'Peak (Mar 17-Apr 16)', 'Tail (Apr 16-May 10)']
    df['season_phase'] = np.select(conditions, labels, default='Unknown')
    return df


def analyze_weather_by_phase(df):
    """Analyze weather impact within each season phase."""
    print("\n" + "="*70)
    print("WEATHER IMPACT BY SEASON PHASE")
    print("="*70)

    weekdays = df[df['dow'] < 5].copy()
    weekdays['weather_quality'] = weekdays.apply(classify_day_weather, axis=1)

    phases = ['Early (Feb 15-Mar 1)', 'Ramp (Mar 1-17)', 'Peak (Mar 17-Apr 16)', 'Tail (Apr 16-May 10)']

    print(f"\n{'Phase':<25} {'Weather':>8} {'Avg Leads':>10} {'Phase Avg':>10} {'vs Phase Avg':>13} {'n':>5}")
    print("-" * 75)

    phase_results = {}
    for phase in phases:
        phase_data = weekdays[weekdays['season_phase'] == phase]
        phase_avg = phase_data['total_leads'].mean()

        phase_results[phase] = {'phase_avg': round(phase_avg, 1), 'weather_effects': {}}

        for quality in ['nice', 'ok', 'bad']:
            subset = phase_data[phase_data['weather_quality'] == quality]
            if len(subset) >= 3:
                avg = subset['total_leads'].mean()
                pct = (avg / phase_avg - 1) * 100
                print(f"{phase:<25} {quality:>8} {avg:>9.0f} {phase_avg:>9.0f} {pct:>+12.1f}% {len(subset):>5}")
                phase_results[phase]['weather_effects'][quality] = {
                    'avg_leads': round(avg, 1),
                    'vs_phase_avg_pct': round(pct, 1),
                    'count': len(subset)
                }
            else:
                print(f"{phase:<25} {quality:>8} {'n/a':>10} {phase_avg:>9.0f} {'':>13} {len(subset):>5}")

        print()

    return phase_results


def analyze_temp_sensitivity_by_phase(df):
    """Analyze temperature sensitivity within each phase."""
    print("\n" + "="*70)
    print("TEMPERATURE SENSITIVITY BY SEASON PHASE")
    print("="*70)

    weekdays = df[df['dow'] < 5].copy()
    phases = ['Early (Feb 15-Mar 1)', 'Ramp (Mar 1-17)', 'Peak (Mar 17-Apr 16)', 'Tail (Apr 16-May 10)']

    print("\n--- Correlation: temp_max vs total_leads (weekdays only) ---")
    from scipy import stats

    phase_correlations = {}
    for phase in phases:
        phase_data = weekdays[weekdays['season_phase'] == phase].dropna(subset=['temp_max'])
        if len(phase_data) >= 10:
            r, p = stats.pearsonr(phase_data['temp_max'], phase_data['total_leads'])
            print(f"  {phase:<30} r={r:+.3f}  p={p:.4f}  {'***' if p < 0.01 else '**' if p < 0.05 else '*' if p < 0.1 else 'ns'}  (n={len(phase_data)})")
            phase_correlations[phase] = {'r': round(r, 3), 'p': round(p, 4), 'n': len(phase_data)}

    # Sunshine correlation
    print("\n--- Correlation: sunshine_hrs vs total_leads (weekdays only) ---")
    for phase in phases:
        phase_data = weekdays[weekdays['season_phase'] == phase].dropna(subset=['sunshine_hrs'])
        if len(phase_data) >= 10:
            r, p = stats.pearsonr(phase_data['sunshine_hrs'], phase_data['total_leads'])
            print(f"  {phase:<30} r={r:+.3f}  p={p:.4f}  {'***' if p < 0.01 else '**' if p < 0.05 else '*' if p < 0.1 else 'ns'}  (n={len(phase_data)})")

    return phase_correlations


def analyze_above_below_normal_temp(df):
    """Analyze 'above normal' vs 'below normal' temp days by phase."""
    print("\n" + "="*70)
    print("ABOVE vs BELOW NORMAL TEMPERATURE BY PHASE")
    print("="*70)

    weekdays = df[df['dow'] < 5].copy()

    # Calculate average temp for each day_of_season across years
    avg_temp_by_dos = weekdays.groupby('day_of_season')['temp_max'].mean().to_dict()
    weekdays['avg_temp_for_dos'] = weekdays['day_of_season'].map(avg_temp_by_dos)
    weekdays['temp_vs_normal'] = weekdays['temp_max'] - weekdays['avg_temp_for_dos']
    weekdays['temp_above_normal'] = weekdays['temp_vs_normal'] > 5  # 5°F above average
    weekdays['temp_below_normal'] = weekdays['temp_vs_normal'] < -5  # 5°F below average

    phases = ['Early (Feb 15-Mar 1)', 'Ramp (Mar 1-17)', 'Peak (Mar 17-Apr 16)', 'Tail (Apr 16-May 10)']

    print(f"\n{'Phase':<25} {'Temp Category':>15} {'Avg Leads':>10} {'vs Phase':>10} {'n':>5}")
    print("-" * 70)

    results = {}
    for phase in phases:
        phase_data = weekdays[weekdays['season_phase'] == phase]
        phase_avg = phase_data['total_leads'].mean()

        above = phase_data[phase_data['temp_above_normal']]
        below = phase_data[phase_data['temp_below_normal']]
        normal = phase_data[~phase_data['temp_above_normal'] & ~phase_data['temp_below_normal']]

        phase_result = {}
        for label, subset in [('Above (+5°F)', above), ('Normal (±5°F)', normal), ('Below (-5°F)', below)]:
            if len(subset) >= 3:
                avg = subset['total_leads'].mean()
                pct = (avg / phase_avg - 1) * 100
                print(f"{phase:<25} {label:>15} {avg:>9.0f} {pct:>+9.1f}% {len(subset):>5}")
                phase_result[label] = {'avg': round(avg, 1), 'pct': round(pct, 1), 'n': len(subset)}

        results[phase] = phase_result
        print()

    return results


def plot_phase_analysis(df, phase_results, temp_above_below):
    """Generate seasonal phase x weather charts."""
    weekdays = df[df['dow'] < 5].copy()
    weekdays['weather_quality'] = weekdays.apply(classify_day_weather, axis=1)

    fig, axes = plt.subplots(2, 2, figsize=(16, 12))

    phases = ['Early (Feb 15-Mar 1)', 'Ramp (Mar 1-17)', 'Peak (Mar 17-Apr 16)', 'Tail (Apr 16-May 10)']
    phase_short = ['Early\nFeb 15-Mar 1', 'Ramp\nMar 1-17', 'Peak\nMar 17-Apr 16', 'Tail\nApr 16-May 10']

    # 1. Weather quality impact by phase (grouped bar)
    ax = axes[0, 0]
    x = np.arange(len(phases))
    width = 0.25
    for i, (quality, color) in enumerate([('nice', '#4CAF50'), ('ok', '#FFC107'), ('bad', '#F44336')]):
        vals = []
        for phase in phases:
            effect = phase_results.get(phase, {}).get('weather_effects', {}).get(quality, {})
            vals.append(effect.get('vs_phase_avg_pct', 0))
        ax.bar(x + (i - 1) * width, vals, width, label=quality.title(), color=color, alpha=0.8)

    ax.set_xticks(x)
    ax.set_xticklabels(phase_short, fontsize=8)
    ax.set_ylabel('% vs Phase Average')
    ax.set_title('Weather Impact Varies by Season Phase', fontweight='bold')
    ax.axhline(0, color='gray', linestyle='--', alpha=0.5)
    ax.legend()
    ax.grid(axis='y', alpha=0.3)

    # 2. Temperature vs leads scatter, colored by phase
    ax = axes[0, 1]
    phase_colors = {'Early (Feb 15-Mar 1)': '#2196F3', 'Ramp (Mar 1-17)': '#9C27B0',
                    'Peak (Mar 17-Apr 16)': '#4CAF50', 'Tail (Apr 16-May 10)': '#FF9800'}
    for phase in phases:
        subset = weekdays[weekdays['season_phase'] == phase]
        ax.scatter(subset['temp_max'], subset['total_leads'], alpha=0.4, s=20,
                   color=phase_colors[phase], label=phase.split('(')[0].strip())
    ax.set_xlabel('Max Temperature (°F)')
    ax.set_ylabel('Daily Leads')
    ax.set_title('Temperature vs Leads by Season Phase', fontweight='bold')
    ax.legend(fontsize=8)
    ax.grid(True, alpha=0.3)

    # 3. Above/below normal temp impact by phase
    ax = axes[1, 0]
    categories = ['Above (+5°F)', 'Normal (±5°F)', 'Below (-5°F)']
    cat_colors = ['#4CAF50', '#FFC107', '#F44336']
    x = np.arange(len(phases))
    width = 0.25
    for i, (cat, color) in enumerate(zip(categories, cat_colors)):
        vals = []
        for phase in phases:
            info = temp_above_below.get(phase, {}).get(cat, {})
            vals.append(info.get('pct', 0))
        ax.bar(x + (i - 1) * width, vals, width, label=cat, color=color, alpha=0.8)

    ax.set_xticks(x)
    ax.set_xticklabels(phase_short, fontsize=8)
    ax.set_ylabel('% vs Phase Average')
    ax.set_title('Above/Below Normal Temp Impact by Phase', fontweight='bold')
    ax.axhline(0, color='gray', linestyle='--', alpha=0.5)
    ax.legend(fontsize=8)
    ax.grid(axis='y', alpha=0.3)

    # 4. Leads timeline with phase shading and weather overlay
    ax = axes[1, 1]
    avg_by_dos = weekdays.groupby('day_of_season').agg(
        avg_leads=('total_leads', 'mean'),
        avg_temp=('temp_max', 'mean'),
    ).reset_index()

    nice_days = weekdays[weekdays['weather_quality'] == 'nice'].groupby('day_of_season')['total_leads'].mean()
    bad_days = weekdays[weekdays['weather_quality'] == 'bad'].groupby('day_of_season')['total_leads'].mean()

    ax.plot(avg_by_dos['day_of_season'], avg_by_dos['avg_leads'], color='black', linewidth=2, label='All Days Avg')

    # Smooth the nice/bad lines
    if len(nice_days) > 5:
        nice_smooth = nice_days.rolling(5, min_periods=1, center=True).mean()
        ax.plot(nice_smooth.index, nice_smooth.values, color='#4CAF50', linewidth=1.5, linestyle='--', label='Nice Days Avg')
    if len(bad_days) > 5:
        bad_smooth = bad_days.rolling(5, min_periods=1, center=True).mean()
        ax.plot(bad_smooth.index, bad_smooth.values, color='#F44336', linewidth=1.5, linestyle='--', label='Bad Days Avg')

    # Phase shading
    phase_bounds = [(0, 14), (14, 30), (30, 60), (60, 85)]
    phase_colors_light = ['#E3F2FD', '#F3E5F5', '#E8F5E9', '#FFF3E0']
    for (start, end), color in zip(phase_bounds, phase_colors_light):
        ax.axvspan(start, end, alpha=0.3, color=color)

    ax.set_xlabel('Days Since Feb 15')
    ax.set_ylabel('Average Weekday Leads')
    ax.set_title('Nice vs Bad Weather Leads Across Season', fontweight='bold')
    ax.legend(fontsize=8)
    ax.grid(True, alpha=0.3)

    # Add phase labels
    phase_labels = ['Early', 'Ramp', 'Peak', 'Tail']
    phase_centers = [7, 22, 45, 72]
    for lbl, xc in zip(phase_labels, phase_centers):
        ax.text(xc, ax.get_ylim()[1] * 0.95, lbl, ha='center', fontsize=9, fontstyle='italic', alpha=0.6)

    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, 'seasonal_phase_weather.png'), dpi=150, bbox_inches='tight')
    plt.close()
    print("  [CHART] seasonal_phase_weather.png")


def main():
    print("="*70)
    print("SEASONAL x WEATHER INTERACTION ANALYSIS")
    print("="*70)

    df = load_data()
    df = define_season_phases(df)
    print(f"  Loaded {len(df):,} days across 5 seasons")
    print(f"  Phase distribution:")
    print(f"    {df['season_phase'].value_counts().to_dict()}")

    phase_results = analyze_weather_by_phase(df)
    phase_correlations = analyze_temp_sensitivity_by_phase(df)
    temp_above_below = analyze_above_below_normal_temp(df)

    plot_phase_analysis(df, phase_results, temp_above_below)

    # Save results
    summary = {
        'phase_weather_impact': {k: v for k, v in phase_results.items()},
        'phase_temp_correlations': phase_correlations,
        'temp_above_below_normal': temp_above_below,
    }
    with open(os.path.join(OUTPUT_DIR, 'seasonal_phase_analysis.json'), 'w') as f:
        json.dump(summary, f, indent=2, default=str)

    print("\n" + "="*70)
    print("SEASONAL PHASE ANALYSIS COMPLETE")
    print("="*70)

    return summary


if __name__ == '__main__':
    summary = main()
