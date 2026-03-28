#!/usr/bin/env python3
"""
天气驱动的交通影响 ML 预测脚本

用途：
1) 由 Node.js 后端通过子进程调用
2) 输入当前天气 + 未来短时预报
3) 输出交通影响分数、等级、预计清除时间和主要因子

说明：
- 优先加载已训练好的 RandomForest 模型
- 若模型文件缺失，则自动调用 train_model.py 重新训练
- 输入输出都使用 JSON，便于和现有 server.js 对接
"""

import json
import math
import os
import sys
from datetime import datetime
from pathlib import Path

try:
    import joblib
except Exception as exc:  # pragma: no cover
    print(json.dumps({"error": f"joblib import failed: {exc}"}))
    sys.exit(1)

if __package__:
    from .ml_config import MLConfig
    from .train_model import train
else:
    CURRENT_DIR = Path(__file__).resolve().parent
    if str(CURRENT_DIR) not in sys.path:
        sys.path.insert(0, str(CURRENT_DIR))
    from ml_config import MLConfig
    from train_model import train


cfg = MLConfig()
cfg.validate()

MODEL = None
SCALER = None
ENCODERS = None

BAND_TO_IMPACT = {
    1: {"class": 3, "label": "Severe Impact", "css": "impact-severe"},
    2: {"class": 3, "label": "Severe Impact", "css": "impact-severe"},
    3: {"class": 2, "label": "High Impact", "css": "impact-high"},
    4: {"class": 2, "label": "High Impact", "css": "impact-high"},
    5: {"class": 1, "label": "Moderate Impact", "css": "impact-moderate"},
    6: {"class": 1, "label": "Moderate Impact", "css": "impact-moderate"},
    7: {"class": 0, "label": "Low Impact", "css": "impact-low"},
    8: {"class": 0, "label": "Low Impact", "css": "impact-low"},
}

BAND_TO_SCORE = {1: 9.5, 2: 8.5, 3: 7.5, 4: 6.0, 5: 4.5, 6: 3.0, 7: 1.5, 8: 0.5}

IMPACT_SUMMARIES = {
    3: "Hazardous weather conditions detected. Severe traffic disruption is likely across major routes.",
    2: "Adverse weather is significantly affecting road conditions. Expect slower speeds and heavier congestion.",
    1: "Moderate weather conditions may cause minor slowdowns in some areas. Allow extra travel time.",
    0: "Weather conditions are clear and are unlikely to affect normal traffic flow.",
}

WEATHER_CONDITION_MAP = {
    "clear sky": "Clear",
    "few clouds": "Clouds",
    "scattered clouds": "Clouds",
    "broken clouds": "Clouds",
    "overcast clouds": "Clouds",
    "light rain": "Drizzle",
    "moderate rain": "Rain",
    "heavy intensity rain": "Rain",
    "very heavy rain": "Rain",
    "extreme rain": "Rain",
    "freezing rain": "Rain",
    "light intensity shower rain": "Drizzle",
    "shower rain": "Rain",
    "thunderstorm": "Thunderstorm",
    "thunderstorm with light rain": "Thunderstorm",
    "thunderstorm with rain": "Thunderstorm",
    "thunderstorm with heavy rain": "Thunderstorm",
    "mist": "Mist",
    "haze": "Haze",
    "fog": "Mist",
    "drizzle": "Drizzle",
}

REPRESENTATIVE_ROAD = "Pan Island Expressway"
REPRESENTATIVE_BASE_SPEED = 80.0


def load_or_train():
    global MODEL, SCALER, ENCODERS
    artefacts_exist = all(
        os.path.exists(path)
        for path in [cfg.model_output_path, cfg.scaler_output_path, cfg.label_encoder_output_path]
    )
    if not artefacts_exist:
        train(cfg)
    MODEL = joblib.load(cfg.model_output_path)
    SCALER = joblib.load(cfg.scaler_output_path)
    ENCODERS = joblib.load(cfg.label_encoder_output_path)


def normalise_weather_cond(desc):
    desc_lower = str(desc or "").lower().strip()
    for key, value in WEATHER_CONDITION_MAP.items():
        if key in desc_lower:
            return value
    if "rain" in desc_lower:
        return "Rain"
    if "thunder" in desc_lower:
        return "Thunderstorm"
    if "cloud" in desc_lower:
        return "Clouds"
    if "drizzle" in desc_lower:
        return "Drizzle"
    if "mist" in desc_lower or "fog" in desc_lower:
        return "Mist"
    if "haze" in desc_lower:
        return "Haze"
    return "Clear"


def is_peak_hour(hour, dow):
    if dow >= 5:
        return 0
    return 1 if (7 <= hour <= 9) or (17 <= hour <= 20) else 0


def estimate_current_speed(hour, dow, weather_cond):
    peak_factor = 0.35 if is_peak_hour(hour, dow) else 0.05
    weather_factor = {
        "Clear": 0.00,
        "Clouds": 0.03,
        "Drizzle": 0.15,
        "Rain": 0.28,
        "Thunderstorm": 0.45,
        "Mist": 0.12,
        "Haze": 0.08,
    }.get(weather_cond, 0.00)
    factor = max(0.10, 1.0 - peak_factor - weather_factor)
    return round(REPRESENTATIVE_BASE_SPEED * factor, 1)


def build_feature_vector(data):
    now = datetime.now()
    hour = int(data.get("hour", now.hour))
    dow = int(data.get("day_of_week", now.weekday()))
    desc = str(data.get("desc", ""))
    peak = is_peak_hour(hour, dow)
    weather_cond = normalise_weather_cond(desc)
    current_speed = estimate_current_speed(hour, dow, weather_cond)
    road_enc = ENCODERS["road"].transform([REPRESENTATIVE_ROAD])[0]
    weather_enc = ENCODERS["weather"].transform([weather_cond])[0]
    return [[
        road_enc,
        dow,
        hour,
        current_speed,
        current_speed,
        current_speed,
        weather_enc,
        peak,
    ]]


def band_to_clearing_time(band):
    mapping = {
        1: "90+ min",
        2: "60-90 min",
        3: "45-60 min",
        4: "30-45 min",
        5: "20-30 min",
        6: "10-20 min",
        7: "5-10 min",
        8: "< 5 min",
    }
    return mapping.get(int(band), "--")


def compute_factor_importances(data):
    rain_pop = float(data.get("rain_pop", 0)) / 100.0
    rain_amount = min(float(data.get("rain_amount", 0)) / 20.0, 1.0)
    wind = min(float(data.get("wind", 0)) / 20.0, 1.0)
    vis = float(data.get("visibility", 10))
    vis_impact = max(0.0, 1.0 - vis / 10.0)
    temp = float(data.get("temp", 28))
    heat_stress = (
        1.0 if temp > 38 else
        0.8 if temp > 35 else
        0.5 if temp > 32 else
        0.25 if temp > 28 else
        0.0
    )
    return {
        "rainPop": max(0.0, min(1.0, rain_pop)),
        "rainAmt": max(0.0, min(1.0, rain_amount)),
        "wind": max(0.0, min(1.0, wind)),
        "visImpact": max(0.0, min(1.0, vis_impact)),
        "tempStress": max(0.0, min(1.0, heat_stress)),
    }


def predict(payload):
    features = build_feature_vector(payload)
    scaled = SCALER.transform(features)
    band = int(MODEL.predict(scaled)[0])
    probabilities = MODEL.predict_proba(scaled)[0]
    confidence = round(float(max(probabilities)) * 100)
    impact = BAND_TO_IMPACT.get(band, BAND_TO_IMPACT[5])
    score = BAND_TO_SCORE.get(band, 5.0)
    factors = compute_factor_importances(payload)
    return {
      "score": score,
      "level": impact["label"],
      "levelClass": impact["css"],
      "summary": IMPACT_SUMMARIES.get(impact["class"], ""),
      "clearingTime": band_to_clearing_time(band),
      "confidence": confidence,
      "speedband": band,
      "speedbandLabel": f"SpeedBand {band}",
      "features": factors,
      "source": "python-ml",
      "model": "RandomForest",
      "nEstimators": cfg.n_estimators,
    }


def main():
    try:
        load_or_train()
        payload = json.load(sys.stdin)
        result = predict(payload if isinstance(payload, dict) else {})
        sys.stdout.write(json.dumps(result))
    except Exception as exc:
        sys.stderr.write(str(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
