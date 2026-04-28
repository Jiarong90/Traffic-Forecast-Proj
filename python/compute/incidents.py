"""Incident normalization and impact estimation helpers."""

import re

try:
    from .geo import to_float
except ImportError:  # direct CLI execution
    from geo import to_float


def infer_impact_by_type(type_text, message=""):
    """
    根据事故类型/文案关键词给出经验估算。

    返回字段：
    - spreadRadiusKm：预计影响扩散半径（公里）
    - minMin/maxMin：预计持续时间区间（分钟）
    """
    t = f"{type_text or ''} {message or ''}".lower()
    if re.search(r"(accident|collision|crash|fire|fatal)", t):
        return {"spreadRadiusKm": 2.2, "minMin": 50, "maxMin": 110}
    if re.search(r"(roadwork|construction|road works|works)", t):
        return {"spreadRadiusKm": 1.5, "minMin": 45, "maxMin": 95}
    if re.search(r"(breakdown|stalled|vehicle breakdown)", t):
        return {"spreadRadiusKm": 1.2, "minMin": 25, "maxMin": 60}
    if re.search(r"(heavy traffic|congestion|jam)", t):
        return {"spreadRadiusKm": 1.0, "minMin": 20, "maxMin": 45}
    return {"spreadRadiusKm": 0.9, "minMin": 15, "maxMin": 35}


def build_impact_meta(raw):
    """
    合并“上游已给值”和“经验估算值”。

    优先级：
    - 若事故自身带 estimatedDurationMin/Max、spreadRadiusKm，则优先用它
    - 否则使用 infer_impact_by_type 的经验值
    """
    inferred = infer_impact_by_type(raw.get("type"), raw.get("message", ""))
    lta_min = to_float(raw.get("estimatedDurationMin"))
    lta_max = to_float(raw.get("estimatedDurationMax"))
    radius = to_float(raw.get("spreadRadiusKm"))

    min_min = lta_min if lta_min is not None else inferred["minMin"]
    max_min = lta_max if lta_max is not None else inferred["maxMin"]
    if max_min < min_min:
        min_min, max_min = max_min, min_min

    return {
        "spreadRadiusKm": round(radius if radius is not None else inferred["spreadRadiusKm"], 1),
        "estimatedDurationMin": max(1, int(round(min_min))),
        "estimatedDurationMax": max(int(round(min_min)), int(round(max_min))),
    }


def derive_incident_area(message, lat, lon):
    """
    尝试从事故描述中提取区域名。

    例如：
    - "PIE - accident near ..." -> 提取 "PIE"
    提取失败时回退为坐标字符串。
    """
    msg = str(message or "").strip()
    if msg:
        parts = [x.strip() for x in re.split(r"\s-\s|,|;", msg) if x.strip()]
        if parts:
            return parts[0]
    if lat is None or lon is None:
        return "(unknown)"
    return f"({lat:.4f}, {lon:.4f})"


def normalize_incidents(payload):
    """
    将 LTA/data.gov/mock 的事故字段统一为同一结构，并补齐影响估算。

    输入：
    - payload.list: 原始事故数组
    - payload.prefix: ID 前缀（如 lta / dgov）
    - payload.defaultCreatedAt: 默认时间（可选）

    输出：
    - value: [{id, message, type, lat, lon, createdAt, estimatedDurationMin, estimatedDurationMax, spreadRadiusKm}]

    说明：
    - 该函数不做外部网络请求，仅处理输入数据本身。
    - 若源数据缺少影响字段，会回退到 infer_impact_by_type 的规则估算。
    - 该 op 是“事故数据进入系统后的第一层清洗标准化”。
    """
    items = payload.get("list") or []
    prefix = str(payload.get("prefix") or "incident")
    default_created_at = payload.get("defaultCreatedAt")
    out = []

    for idx, x in enumerate(items):
        if not isinstance(x, dict):
            continue

        message = x.get("Message") or x.get("message") or x.get("Description") or x.get("Type") or ""
        lat = to_float(x.get("Latitude", x.get("latitude", x.get("Lat"))))
        lon = to_float(x.get("Longitude", x.get("longitude", x.get("Lon"))))
        if lat is None or lon is None:
            continue

        impact = build_impact_meta({
            "type": x.get("Type") or x.get("type"),
            "message": message,
            "estimatedDurationMin": x.get("estimatedDurationMin", x.get("estimated_impact_min", x.get("EstimatedImpactMin"))),
            "estimatedDurationMax": x.get("estimatedDurationMax", x.get("estimated_impact_max", x.get("EstimatedImpactMax"))),
            "spreadRadiusKm": x.get("spreadRadiusKm", x.get("spread_radius_km", x.get("SpreadRadiusKm"))),
        })

        out.append({
            "id": x.get("IncidentID") or x.get("id") or f"{prefix}-incident-{idx + 1}",
            "message": message,
            "type": x.get("Type") or x.get("type") or "Incident",
            "lat": lat,
            "lon": lon,
            "createdAt": x.get("CreatedAt") or x.get("Created") or x.get("updated_at") or default_created_at,
            "estimatedDurationMin": impact["estimatedDurationMin"],
            "estimatedDurationMax": impact["estimatedDurationMax"],
            "spreadRadiusKm": impact["spreadRadiusKm"],
        })

    return {"value": out}


__all__ = [
    "infer_impact_by_type",
    "build_impact_meta",
    "derive_incident_area",
    "normalize_incidents",
]
