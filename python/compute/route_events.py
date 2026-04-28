"""Route event filtering and scoring helpers."""

import math

try:
    from .geo import distance_to_route, haversine, nearest_coord_index, to_float
except ImportError:  # direct CLI execution
    from geo import distance_to_route, haversine, nearest_coord_index, to_float


def analyze_events_for_route(payload):
    """
    事件相关性筛选（与前端原逻辑对齐）：
    - 用户1.2km内 或
    - 路线前方区间内
    """
    events = payload.get("events") or []
    route_coords = payload.get("routeCoords") or []
    user_loc = payload.get("userLoc")
    if not isinstance(route_coords, list) or len(route_coords) < 2:
        return {"value": []}

    user_lat = to_float((user_loc or {}).get("lat"))
    user_lon = to_float((user_loc or {}).get("lon"))
    has_user = user_lat is not None and user_lon is not None

    progress_idx = nearest_coord_index(route_coords, user_lat, user_lon) if has_user else 0
    ahead_max = min(len(route_coords) - 1, progress_idx + int(len(route_coords) * 0.55))
    out = []
    for evt in events:
        lat = to_float(evt.get("lat"))
        lon = to_float(evt.get("lon"))
        if lat is None or lon is None:
            continue
        near_user_m = haversine(user_lat, user_lon, lat, lon) if has_user else float("inf")
        event_idx = nearest_coord_index(route_coords, lat, lon)
        is_near_user = near_user_m <= 1200 if has_user else False
        is_ahead = event_idx >= progress_idx and event_idx <= ahead_max
        if is_near_user or is_ahead:
            item = dict(evt)
            item["nearUserMeters"] = near_user_m if math.isfinite(near_user_m) else None
            item["isNearUser"] = bool(is_near_user)
            item["isAhead"] = bool(is_ahead)
            item["isRelevant"] = True
            out.append(item)
    return {"value": out}


def evaluate_route_events(payload):
    """
    路线事件评分/拥堵评估（迁移自前端）。

    输入：
    - routes: [{id, estMinutes, coords}]
    - events: [{lat, lon, delayMin, ...}]

    输出：
    - recommendedRouteId
    - evaluations: [{routeId, hitCount, eventDelayMin, score, hits}]
    - currentFastestId

    评分模型说明（与 UI 排序一致）：
    - score = estMinutes + delaySum * 0.7 + hitCount * 2
    - recommendedRouteId 基于 score 最小
    - currentFastestId 基于 (estMinutes + delaySum*0.7) 最小
    这样可同时满足“综合推荐”与“当前最快”两个视角。
    """
    routes = payload.get("routes") or []
    events = payload.get("events") or []
    if not isinstance(routes, list) or not routes:
        return {"recommendedRouteId": None, "evaluations": [], "currentFastestId": None}

    evaluations = []
    recommended_route_id = None
    best_score = float("inf")
    current_fastest_id = None
    best_total = float("inf")

    for route in routes:
        route_id = route.get("id")
        coords = route.get("coords") or []
        est_minutes = to_float(route.get("estMinutes"))
        if not route_id or est_minutes is None or not isinstance(coords, list) or len(coords) < 2:
            continue

        hits = []
        delay_sum = 0.0
        for evt in events:
            e_lat = to_float(evt.get("lat"))
            e_lon = to_float(evt.get("lon"))
            if e_lat is None or e_lon is None:
                continue
            d = distance_to_route(coords, e_lat, e_lon)
            if d <= 350:
                hits.append(evt)
                delay_sum += to_float(evt.get("delayMin")) or 0.0

        score = est_minutes + delay_sum * 0.7 + len(hits) * 2
        total_minutes = est_minutes + delay_sum * 0.7
        evaluations.append({
            "routeId": route_id,
            "hitCount": len(hits),
            "eventDelayMin": delay_sum,
            "score": score,
            "hits": hits
        })

        if score < best_score:
            best_score = score
            recommended_route_id = route_id
        if total_minutes < best_total:
            best_total = total_minutes
            current_fastest_id = route_id

    return {
        "recommendedRouteId": recommended_route_id,
        "evaluations": evaluations,
        "currentFastestId": current_fastest_id
    }


__all__ = ["analyze_events_for_route", "evaluate_route_events"]
