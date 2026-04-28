"""CLI fallback for incident impact prediction when the ML service is unavailable."""

import re

try:
    from .geo import to_float
except ImportError:  # direct CLI execution
    from geo import to_float


def incident_predict(payload):
    """
    Lightweight CLI fallback for incident ML prediction.

    The main prediction endpoint is served by FastAPI. This fallback prevents
    Node's runPythonCompute('incident_predict') path from failing when FastAPI
    is unavailable.
    """
    incident_type = str(payload.get("type") or "Accident")
    message = str(payload.get("message") or "")
    text = f"{incident_type} {message}".lower()
    hour = to_float(payload.get("hour"))
    dow = to_float(payload.get("day_of_week"))

    duration = 35.0
    if re.search(r"(accident|collision|crash|fatal)", text):
        duration = 75.0
    elif re.search(r"(roadwork|road works|construction)", text):
        duration = 70.0
    elif re.search(r"(breakdown|stalled)", text):
        duration = 40.0
    elif re.search(r"(heavy traffic|congestion|jam)", text):
        duration = 30.0
    if dow is not None and hour is not None and dow < 5 and ((7 <= hour <= 9) or (17 <= hour <= 20)):
        duration *= 1.2
    if re.search(r"(lane|blocked|closure)", text):
        duration *= 1.15

    if duration < 15:
        impact_class = 0
    elif duration < 45:
        impact_class = 1
    elif duration < 90:
        impact_class = 2
    else:
        impact_class = 3

    impact_meta = {
        0: {"label": "Low Impact", "css": "impact-low", "clearing": "< 15 min", "summary": "Minor incident with limited traffic impact."},
        1: {"label": "Moderate Impact", "css": "impact-moderate", "clearing": "15-45 min", "summary": "Moderate disruption is expected near the affected area."},
        2: {"label": "High Impact", "css": "impact-high", "clearing": "45-90 min", "summary": "Significant disruption is likely. Consider alternate routes."},
        3: {"label": "Severe Impact", "css": "impact-severe", "clearing": "90+ min", "summary": "Major disruption is likely. Avoid the area if possible."},
    }[impact_class]
    t15_sb = 3 if impact_class >= 2 else (4 if impact_class == 1 else 6)

    return {
        "impact_class": impact_meta["label"],
        "impact_css": impact_meta["css"],
        "score": round(min(duration / 180.0, 1.0) * 9.5 + 0.5, 1),
        "clearing_time": impact_meta["clearing"],
        "clearing_time_ml": f"~{int(round(duration))} min (fallback estimate)",
        "confidence": 55,
        "summary": impact_meta["summary"],
        "signals": [
            {"name": "Incident Type", "active": True, "pct": 35},
            {"name": "Peak Hour", "active": bool(dow is not None and hour is not None and dow < 5 and ((7 <= hour <= 9) or (17 <= hour <= 20))), "pct": 25},
            {"name": "Lane Mention", "active": bool(re.search(r"(lane|blocked|closure)", text)), "pct": 20},
            {"name": "Expressway Mention", "active": bool(re.search(r"(pie|cte|aye|bke|kpe|tpe|sle|ecp|mce|kje)", text)), "pct": 20},
        ],
        "predicted_duration_min": round(duration, 1),
        "current_sb": min(8, t15_sb + 1),
        "t15_sb": t15_sb,
        "flow_status": "Slowing" if t15_sb < 4 else "Stable",
        "impact_segments": [],
    }


__all__ = ["incident_predict"]
