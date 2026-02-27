"""
Model Validation: Holdout Test
==============================
Train on 2021-2024 only, predict 2025 blind, compare to actuals.
Also generates a forward-looking verification framework for 2026.
"""

import os
import json
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score
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


def engineer_features(df):
    df = df.copy()
    df['is_snow'] = ((df['snowfall_in'].fillna(0) > 0.05) | (df['snow_depth'].fillna(0) > 0.5)).astype(int)
    df['is_rainy'] = (df['rain_in'].fillna(0) > 0.1).astype(int)
    df['is_sunny'] = (df['sunshine_hrs'].fillna(0) >= 8).astype(int)
    df['year_trend'] = df['year'] - 2021

    df = df.sort_values('date')
    for year in df['year'].unique():
        mask = df['year'] == year
        df.loc[mask, 'temp_max_3d_avg'] = df.loc[mask, 'temp_max'].rolling(3, min_periods=1).mean()
        df.loc[mask, 'sunshine_3d_avg'] = df.loc[mask, 'sunshine_hrs'].rolling(3, min_periods=1).mean()

    return df


def run_holdout_validation():
    """Train on 2021-2024, predict 2025 blind."""
    print("=" * 70)
    print("HOLDOUT VALIDATION: Train 2021-2024 → Predict 2025")
    print("=" * 70)

    df = pd.read_csv(os.path.join(OUTPUT_DIR, 'daily_leads_weather.csv'), parse_dates=['date'])
    df = df[df['year'].isin([2021, 2022, 2023, 2024, 2025])].copy()
    df = df.dropna(subset=['temp_max', 'sunshine_hrs'])
    df = engineer_features(df)

    feature_cols = [
        'dow', 'is_weekend', 'is_saturday',
        'day_of_season', 'week_num', 'month',
        'temp_max', 'temp_mean', 'sunshine_hrs',
        'precip_in', 'snowfall_in', 'wind_max_mph',
        'is_snow', 'is_rainy', 'is_sunny',
        'temp_max_3d_avg', 'sunshine_3d_avg',
        'year_trend',
    ]

    train = df[df['year'].isin([2021, 2022, 2023, 2024])].copy()
    test = df[df['year'] == 2025].copy()

    X_train = train[feature_cols].fillna(0)
    y_train = train['total_leads']
    X_test = test[feature_cols].fillna(0)
    y_test = test['total_leads']

    print(f"\n  Train set: {len(train)} days (2021-2024)")
    print(f"  Test set:  {len(test)} days (2025)")

    model = GradientBoostingRegressor(
        n_estimators=300, max_depth=4, learning_rate=0.05,
        subsample=0.8, min_samples_leaf=10, random_state=42,
    )
    model.fit(X_train, y_train)
    y_pred = model.predict(X_test)

    mae = mean_absolute_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)
    mape = np.mean(np.abs((y_test.values - y_pred) / np.maximum(y_test.values, 1))) * 100
    total_actual = y_test.sum()
    total_predicted = y_pred.sum()
    total_error_pct = (total_predicted / total_actual - 1) * 100

    print(f"\n--- Holdout Test Results (2025 season, never seen by model) ---")
    print(f"  MAE:                 {mae:.1f} leads/day")
    print(f"  R²:                  {r2:.3f}")
    print(f"  MAPE:                {mape:.1f}%")
    print(f"  Total actual leads:  {total_actual:,.0f}")
    print(f"  Total predicted:     {total_predicted:,.0f}")
    print(f"  Season total error:  {total_error_pct:+.1f}%")

    # Weekly accuracy
    test_with_pred = test.copy()
    test_with_pred['predicted'] = y_pred
    test_with_pred['error'] = y_pred - y_test.values
    test_with_pred['abs_error'] = np.abs(test_with_pred['error'])

    weekly = test_with_pred.groupby('week_num').agg(
        actual_total=('total_leads', 'sum'),
        predicted_total=('predicted', 'sum'),
        daily_mae=('abs_error', 'mean'),
        days=('total_leads', 'count'),
    ).reset_index()
    weekly['weekly_error_pct'] = ((weekly['predicted_total'] / weekly['actual_total']) - 1) * 100

    print(f"\n--- Weekly Accuracy (2025 holdout) ---")
    print(f"{'Week':>5} {'Actual':>8} {'Predicted':>10} {'Error %':>9} {'Daily MAE':>10}")
    print("-" * 48)
    for _, row in weekly.iterrows():
        print(f"{int(row['week_num']):>5} {row['actual_total']:>8.0f} {row['predicted_total']:>10.0f} {row['weekly_error_pct']:>+8.1f}% {row['daily_mae']:>9.1f}")

    # Day-of-week accuracy
    print(f"\n--- Day-of-Week Accuracy (2025 holdout) ---")
    dow_names = {0: 'Mon', 1: 'Tue', 2: 'Wed', 3: 'Thu', 4: 'Fri', 5: 'Sat', 6: 'Sun'}
    dow_acc = test_with_pred.groupby('dow').agg(
        avg_actual=('total_leads', 'mean'),
        avg_predicted=('predicted', 'mean'),
        mae=('abs_error', 'mean'),
    ).reset_index()
    dow_acc['dow_name'] = dow_acc['dow'].map(dow_names)
    dow_acc['error_pct'] = ((dow_acc['avg_predicted'] / dow_acc['avg_actual']) - 1) * 100

    print(f"{'Day':>5} {'Avg Actual':>11} {'Avg Pred':>10} {'Error %':>9} {'MAE':>6}")
    print("-" * 45)
    for _, row in dow_acc.iterrows():
        print(f"{row['dow_name']:>5} {row['avg_actual']:>10.0f} {row['avg_predicted']:>9.0f} {row['error_pct']:>+8.1f}% {row['mae']:>5.0f}")

    # Weather condition accuracy
    print(f"\n--- Weather Condition Accuracy (2025 holdout) ---")
    test_with_pred['weather_quality'] = test_with_pred.apply(classify_day_weather, axis=1)
    cond_acc = test_with_pred.groupby('weather_quality').agg(
        avg_actual=('total_leads', 'mean'),
        avg_predicted=('predicted', 'mean'),
        mae=('abs_error', 'mean'),
        count=('total_leads', 'count'),
    ).reset_index()
    cond_acc['error_pct'] = ((cond_acc['avg_predicted'] / cond_acc['avg_actual']) - 1) * 100

    print(f"{'Condition':>10} {'Avg Actual':>11} {'Avg Pred':>10} {'Error %':>9} {'MAE':>6} {'n':>4}")
    print("-" * 55)
    for _, row in cond_acc.iterrows():
        print(f"{row['weather_quality']:>10} {row['avg_actual']:>10.0f} {row['avg_predicted']:>9.0f} {row['error_pct']:>+8.1f}% {row['mae']:>5.0f} {row['count']:>4}")

    # Verify 2026 early season
    print(f"\n\n{'='*70}")
    print("2026 EARLY SEASON CHECK")
    print("="*70)
    df_2026 = pd.read_csv(os.path.join(OUTPUT_DIR, 'daily_leads_weather.csv'), parse_dates=['date'])
    df_2026 = df_2026[df_2026['year'] == 2026].copy()
    if len(df_2026) > 0:
        df_2026 = df_2026.dropna(subset=['temp_max', 'sunshine_hrs'])
        df_2026 = engineer_features(df_2026)
        if len(df_2026) > 0:
            X_2026 = df_2026[feature_cols].fillna(0)
            pred_2026 = model.predict(X_2026)
            actual_2026 = df_2026['total_leads'].values

            print(f"  Days with data: {len(df_2026)}")
            print(f"  Date range: {df_2026['date'].min().date()} to {df_2026['date'].max().date()}")
            print(f"  Total actual:    {actual_2026.sum():.0f}")
            print(f"  Total predicted: {pred_2026.sum():.0f}")
            print(f"  Error:           {(pred_2026.sum()/actual_2026.sum() - 1)*100:+.1f}%")
            print(f"  Daily MAE:       {mean_absolute_error(actual_2026, pred_2026):.1f}")

            print(f"\n  Day-by-day 2026:")
            print(f"  {'Date':>12} {'DOW':>5} {'Actual':>7} {'Pred':>7} {'Diff':>6} {'Temp':>5} {'Sun':>5}")
            print("  " + "-" * 55)
            for i, (_, row) in enumerate(df_2026.iterrows()):
                dow_name = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][int(row['dow'])]
                print(f"  {str(row['date'].date()):>12} {dow_name:>5} {row['total_leads']:>6.0f} {pred_2026[i]:>6.0f} {pred_2026[i]-row['total_leads']:>+5.0f} {row['temp_max']:>5.1f} {row['sunshine_hrs']:>5.1f}")

    # Generate validation chart
    plot_holdout_results(test_with_pred, weekly)

    # Save validation results
    validation = {
        'holdout_test': {
            'train_years': [2021, 2022, 2023, 2024],
            'test_year': 2025,
            'mae': round(mae, 1),
            'r2': round(r2, 3),
            'mape': round(mape, 1),
            'total_actual': int(total_actual),
            'total_predicted': int(round(total_predicted)),
            'season_total_error_pct': round(total_error_pct, 1),
        },
        'weekly_accuracy': weekly[['week_num', 'actual_total', 'predicted_total', 'weekly_error_pct']].to_dict('records'),
    }
    with open(os.path.join(OUTPUT_DIR, 'validation_results.json'), 'w') as f:
        json.dump(validation, f, indent=2, default=str)

    return validation


def plot_holdout_results(test_df, weekly):
    fig, axes = plt.subplots(2, 2, figsize=(16, 12))

    test_sorted = test_df.sort_values('date')

    # 1. Daily actual vs predicted (raw)
    ax = axes[0, 0]
    ax.bar(test_sorted['date'], test_sorted['total_leads'], alpha=0.5, color='#2196F3', label='Actual', width=0.8)
    ax.plot(test_sorted['date'], test_sorted['predicted'], color='#FF5722', linewidth=1.5, label='Predicted', alpha=0.8)
    ax.set_title('2025 Holdout: Daily Actual vs Predicted', fontweight='bold')
    ax.set_xlabel('Date')
    ax.set_ylabel('Daily Leads')
    ax.legend()
    ax.grid(axis='y', alpha=0.3)
    ax.tick_params(axis='x', rotation=45)

    # 2. 7-day rolling average comparison
    ax = axes[0, 1]
    actual_7d = test_sorted['total_leads'].rolling(7, min_periods=1, center=True).mean()
    pred_7d = test_sorted['predicted'].rolling(7, min_periods=1, center=True).mean()
    ax.plot(test_sorted['date'], actual_7d, color='#2196F3', linewidth=2.5, label='Actual (7d avg)')
    ax.plot(test_sorted['date'], pred_7d, color='#FF5722', linewidth=2.5, linestyle='--', label='Predicted (7d avg)')
    ax.fill_between(test_sorted['date'], actual_7d, pred_7d, alpha=0.15, color='gray')
    ax.set_title('2025 Holdout: 7-Day Rolling Average', fontweight='bold')
    ax.set_xlabel('Date')
    ax.set_ylabel('Leads (7d avg)')
    ax.legend()
    ax.grid(True, alpha=0.3)
    ax.tick_params(axis='x', rotation=45)

    # 3. Weekly totals
    ax = axes[1, 0]
    x = np.arange(len(weekly))
    w = 0.35
    ax.bar(x - w/2, weekly['actual_total'], w, label='Actual', color='#2196F3', alpha=0.8)
    ax.bar(x + w/2, weekly['predicted_total'], w, label='Predicted', color='#FF5722', alpha=0.8)
    for i, row in weekly.iterrows():
        ax.text(x[i], max(row['actual_total'], row['predicted_total']) + 10,
                f"{row['weekly_error_pct']:+.0f}%", ha='center', fontsize=8, fontweight='bold')
    ax.set_xticks(x)
    ax.set_xticklabels([f"Wk {int(w)}" for w in weekly['week_num']], fontsize=8)
    ax.set_title('2025 Holdout: Weekly Totals', fontweight='bold')
    ax.set_ylabel('Weekly Leads')
    ax.legend()
    ax.grid(axis='y', alpha=0.3)

    # 4. Error distribution
    ax = axes[1, 1]
    errors = test_sorted['error']
    ax.hist(errors, bins=30, color='#9C27B0', alpha=0.7, edgecolor='black', linewidth=0.5)
    ax.axvline(0, color='red', linestyle='--', linewidth=1.5)
    ax.axvline(errors.mean(), color='blue', linestyle='--', linewidth=1, label=f'Mean error: {errors.mean():+.1f}')
    ax.set_title('2025 Holdout: Prediction Error Distribution', fontweight='bold')
    ax.set_xlabel('Error (Predicted - Actual)')
    ax.set_ylabel('Frequency')
    ax.legend()
    ax.grid(axis='y', alpha=0.3)

    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, 'holdout_validation.png'), dpi=150, bbox_inches='tight')
    plt.close()
    print("  [CHART] holdout_validation.png")


if __name__ == '__main__':
    results = run_holdout_validation()
