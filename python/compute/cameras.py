"""Incident-to-camera matching helpers."""

import math

try:
    from .geo import haversine, to_float
except ImportError:  # direct CLI execution
    from geo import haversine, to_float
try:
    from .incidents import build_impact_meta, derive_incident_area
except ImportError:  # direct CLI execution
    from incidents import build_impact_meta, derive_incident_area


def enrich_incidents_with_cameras(payload):
    """
    输入 incidents + cameras，输出匹配后的事故列表。

    关键规则（与前端展示直接相关）：
    - 每条事故找最近实时摄像头
    - 最近距离 超过两公里 视为无可用摄像头
    - 为每条事故补齐 area / spread / duration 等字段

    说明：
    - 这里的“最近”是直线距离（haversine），不是道路网络距离。
    - 2km 阈值是“证据有效性”保守边界，避免误把过远摄像头当作证据。
    """
    incidents = payload.get("incidents") or []
    cameras = payload.get("cameras") or []
    output = []

    for inc in incidents:
        inc_lat = to_float(inc.get("lat"))
        inc_lon = to_float(inc.get("lon"))

        nearest = None
        best_dist = float("inf")

        # 仅在事故坐标有效时进行最近点搜索
        if inc_lat is not None and inc_lon is not None:
            for cam in cameras:
                c_lat = to_float(cam.get("Latitude"))
                c_lon = to_float(cam.get("Longitude"))
                if c_lat is None or c_lon is None:
                    continue
                d = haversine(inc_lat, inc_lon, c_lat, c_lon)
                if d < best_dist:
                    best_dist = d
                    nearest = cam

        # 超过阈值则视为无摄像头证据
        if best_dist > 2000:
            nearest = None

        impact = build_impact_meta(inc)

        output.append({
            "id": inc.get("id"),
            "type": inc.get("type"),
            "message": inc.get("message"),
            "area": derive_incident_area(inc.get("message"), inc_lat, inc_lon),
            "lat": inc_lat,
            "lon": inc_lon,
            "createdAt": inc.get("createdAt"),
            "spreadRadiusKm": inc.get("spreadRadiusKm") if inc.get("spreadRadiusKm") is not None else impact["spreadRadiusKm"],
            "estimatedDurationMin": inc.get("estimatedDurationMin") if inc.get("estimatedDurationMin") is not None else impact["estimatedDurationMin"],
            "estimatedDurationMax": inc.get("estimatedDurationMax") if inc.get("estimatedDurationMax") is not None else impact["estimatedDurationMax"],
            "imageLink": nearest.get("ImageLink") if nearest else None,
            "cameraName": nearest.get("Name") if nearest else None,
            "cameraDistanceMeters": int(round(best_dist)) if nearest and math.isfinite(best_dist) else None,
        })

    return {"value": output}


__all__ = ["enrich_incidents_with_cameras"]
