"""
incident_features.py
--------------------
Shared feature extraction for incident ML model.
Used by both train_incident_model.py (training) and server.py (serving)
to eliminate train/serve feature skew.
"""

import re
import pandas as pd

# Expressway keywords (lowercase)
EXPRESSWAY_KEYWORDS = ["pie", "cte", "aye", "bke", "kje", "tpe", "sle", "mce", "ecp"]

# Feature order contract — must match training and serving
INCIDENT_FEATURE_NAMES = [
    "type_enc", "hour", "day_of_week", "is_peak",
    "is_expressway", "num_lanes_blocked", "has_road_block",
    "has_injury", "has_fire", "has_overturned",
    "vehicle_count", "message_severity_score", "message_len",
]


def extract_message_features(message: str) -> dict:
    """
    Parse a raw incident message string into 9 numeric features.

    Returns a dict with keys:
        is_expressway, num_lanes_blocked, has_road_block,
        has_injury, has_fire, has_overturned,
        vehicle_count, message_severity_score, message_len
    """
    msg = message.lower() if message else ""

    # ── Boolean flags ─────────────────────────────────────────────────────────
    is_expressway = int(any(kw in msg for kw in EXPRESSWAY_KEYWORDS))

    has_road_block = int(
        "road block" in msg or "full closure" in msg or "closed to traffic" in msg
    )
    has_injury = int(
        any(kw in msg for kw in ["injur", "hospital", "casualt", "ambulance"])
    )
    has_fire = int(any(kw in msg for kw in ["fire", "burn", "flame"]))
    has_overturned = int(any(kw in msg for kw in ["overturn", "flip", "topple"]))

    # ── Lanes blocked ─────────────────────────────────────────────────────────
    lane_match = re.search(r"(\d+)\s*lane", msg)
    if lane_match:
        num_lanes_blocked = int(lane_match.group(1))
    elif has_road_block:
        num_lanes_blocked = 3
    else:
        num_lanes_blocked = 0

    # ── Vehicle count ─────────────────────────────────────────────────────────
    # Needs caller to pass incident type for default fallback — handled below
    vehicle_match = re.search(
        r"(\d+)\s*(vehicle|car|truck|lorry|bus|motorcycle|van)", msg
    )
    if vehicle_match:
        vehicle_count = min(int(vehicle_match.group(1)), 5)
    else:
        vehicle_count = 0  # caller may override for Accident/Breakdown

    # ── Severity score ────────────────────────────────────────────────────────
    message_severity_score = round(
        has_fire       * 0.30
        + has_injury     * 0.25
        + has_overturned * 0.20
        + has_road_block * 0.15
        + is_expressway  * 0.10,
        4,
    )

    # ── Raw length ────────────────────────────────────────────────────────────
    message_len = len(message)

    return {
        "is_expressway":         is_expressway,
        "num_lanes_blocked":     num_lanes_blocked,
        "has_road_block":        has_road_block,
        "has_injury":            has_injury,
        "has_fire":              has_fire,
        "has_overturned":        has_overturned,
        "vehicle_count":         vehicle_count,
        "message_severity_score": message_severity_score,
        "message_len":           message_len,
    }


def _default_vehicle_count(features: dict, parquet_type: str) -> dict:
    """
    Apply the vehicle_count default: 1 for Accident/Breakdown when no number found.
    Modifies the dict in place and returns it.
    """
    if features["vehicle_count"] == 0 and parquet_type in ("Accident", "Vehicle breakdown"):
        features["vehicle_count"] = 1
    return features


def extract_message_features_df(df: pd.DataFrame, message_col: str = "message") -> pd.DataFrame:
    """
    Apply extract_message_features row-wise to a DataFrame.
    Appends the 9 new feature columns and returns the modified DataFrame.
    The 'type' column (parquet type names) is used for vehicle_count default.
    """
    raw_features = df[message_col].fillna("").apply(extract_message_features)
    feat_df = pd.DataFrame(raw_features.tolist(), index=df.index)

    # Apply vehicle_count default using parquet type column
    if "type" in df.columns:
        mask_no_vehicle = feat_df["vehicle_count"] == 0
        mask_accident = df["type"].isin(["Accident", "Vehicle breakdown"])
        feat_df.loc[mask_no_vehicle & mask_accident, "vehicle_count"] = 1

    for col in feat_df.columns:
        df[col] = feat_df[col]

    return df
