"""
train_model.py
--------------
Trains a Random Forest classifier to predict future speedband from weather + traffic + time features, and saves
the trained model artefacts under models/. (Can remove placeholder traffic data)

Usage:
    python train_model.py
"""

import os
import sys
from pathlib import Path
import numpy as np
import pandas as pd
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score

if __package__:
    from .ml_config import MLConfig
else:
    CURRENT_DIR = Path(__file__).resolve().parent
    if str(CURRENT_DIR) not in sys.path:
        sys.path.insert(0, str(CURRENT_DIR))
    from ml_config import MLConfig

cfg = MLConfig()
cfg.validate()

ROAD_SEGMENTS = [
    ("Pan Island Expressway",           "Y", 80),
    ("Central Expressway",              "Y", 75),
    ("Ayer Rajah Expressway",           "Y", 78),
    ("East Coast Parkway",              "Y", 82),
    ("Tampines Expressway",             "Y", 80),
    ("Seletar Expressway",              "Y", 77),
    ("Kallang Paya Lebar Expressway",   "Y", 76),
    ("Bukit Timah Expressway",          "Y", 75),
    ("Orchard Road",                    "B", 45),
    ("Upper Thomson Road",              "B", 50),
    ("Clementi Avenue 3",               "C", 40),
    ("Tampines Avenue 10",              "B", 48),
    ("Nicoll Highway",                  "B", 55),
    ("Bedok North Avenue 3",            "C", 38),
    ("Woodlands Avenue 12",             "B", 45),
]

WEATHER_CONDITIONS = [
    ("Clear",         0.00),
    ("Clouds",        0.03),
    ("Drizzle",       0.15),
    ("Rain",          0.28),
    ("Thunderstorm",  0.45),
    ("Mist",          0.12),
    ("Haze",          0.08),
]

def speed_to_band(speed: float) -> int:
    if speed < 10:  return 1
    if speed < 20:  return 2
    if speed < 30:  return 3
    if speed < 40:  return 4
    if speed < 50:  return 5
    if speed < 60:  return 6
    if speed < 70:  return 7
    return 8

def is_peak_hour(hour: int, dow: int) -> int:
    """Returns 1 for peak hours on weekdays."""
    if dow >= 5:        
        return 0
    return 1 if (7 <= hour <= 9) or (17 <= hour <= 20) else 0

def generate_dataset(n_samples: int = 3000, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []

    for _ in range(n_samples):
        road_name, road_cat, base_speed = ROAD_SEGMENTS[rng.integers(len(ROAD_SEGMENTS))]
        weather_cond, weather_penalty = WEATHER_CONDITIONS[rng.integers(len(WEATHER_CONDITIONS))]
        dow   = int(rng.integers(0, 7))     
        hour  = int(rng.integers(0, 24))
        peak  = is_peak_hour(hour, dow)

        peak_penalty    = rng.uniform(0.25, 0.45) if peak else rng.uniform(0.0, 0.08)
        noise           = rng.uniform(-0.05, 0.05)
        speed_factor    = max(0.05, 1.0 - peak_penalty - weather_penalty + noise)

        current_speed   = round(base_speed * speed_factor + rng.normal(0, 2), 1)
        current_speed   = max(2.0, min(current_speed, base_speed))

        avg_15 = max(2.0, current_speed + rng.normal(0, 3))
        avg_30 = max(2.0, current_speed + rng.normal(0, 5))

        trend           = rng.normal(0, 4)
        future_speed    = max(2.0, min(current_speed + trend, base_speed))
        future_band     = speed_to_band(future_speed)

        rows.append({
            "road_segment":         road_name,
            "road_category":        road_cat,
            "day_of_week":          dow,
            "hour_of_day":          hour,
            "current_speed":        round(current_speed, 1),
            "avg_speed_last_15min": round(avg_15, 1),
            "avg_speed_last_30min": round(avg_30, 1),
            "weather_condition":    weather_cond,
            "is_peak_hour":         peak,
            "future_speedband":     future_band,
        })

    return pd.DataFrame(rows)


def train(cfg: MLConfig):
    os.makedirs(os.path.dirname(cfg.dataset_path), exist_ok=True)
    os.makedirs(os.path.dirname(cfg.model_output_path), exist_ok=True)

    csv_path = cfg.dataset_path
    if not os.path.exists(csv_path):
        print(f"[train] Generating synthetic dataset → {csv_path}")
        df = generate_dataset(n_samples=3000, seed=cfg.random_state)
        df.to_csv(csv_path, index=False)
        print(f"[train] Saved {len(df)} rows.")
    else:
        df = pd.read_csv(csv_path)
        print(f"[train] Loaded {len(df)} rows from {csv_path}.")

    le_road    = LabelEncoder()
    le_weather = LabelEncoder()
    df["road_segment_enc"]    = le_road.fit_transform(df["road_segment"])
    df["weather_condition_enc"] = le_weather.fit_transform(df["weather_condition"])

    feature_cols = [
        "road_segment_enc",
        "day_of_week",
        "hour_of_day",
        "current_speed",
        "avg_speed_last_15min",
        "avg_speed_last_30min",
        "weather_condition_enc",
        "is_peak_hour",
    ]

    X = df[feature_cols].values
    y = df[cfg.target_column].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=cfg.test_size, random_state=cfg.random_state, stratify=y
    )

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s  = scaler.transform(X_test)

    print(f"[train] Training RandomForestClassifier (n_estimators={cfg.n_estimators}) …")
    model = RandomForestClassifier(
        n_estimators  = cfg.n_estimators,
        max_depth     = cfg.max_depth,
        min_samples_split = cfg.min_samples_split,
        min_samples_leaf  = cfg.min_samples_leaf,
        random_state  = cfg.random_state,
        n_jobs        = -1,
    )
    model.fit(X_train_s, y_train)

    y_pred = model.predict(X_test_s)
    acc    = accuracy_score(y_test, y_pred)
    print(f"[train] Test accuracy: {acc:.4f}")
    print("\n── Classification report ──")
    print(classification_report(y_test, y_pred,
          target_names=[f"Band {b}" for b in sorted(set(y))]))

    joblib.dump(model,     cfg.model_output_path)
    joblib.dump(scaler,    cfg.scaler_output_path)
    joblib.dump({
        "road":    le_road,
        "weather": le_weather,
    }, cfg.label_encoder_output_path)

    print(f"\n[train] Saved model   → {cfg.model_output_path}")
    print(f"[train] Saved scaler  → {cfg.scaler_output_path}")
    print(f"[train] Saved encoders→ {cfg.label_encoder_output_path}")
    print("[train] Done.")

    return model, scaler, le_road, le_weather


if __name__ == "__main__":
    train(cfg)
