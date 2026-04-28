"""Avoidance-point routing and reroute helpers."""

from typing import List

try:
    from .astar import a_star
except ImportError:  # direct CLI execution
    from astar import a_star
try:
    from .geo import haversine, to_float
except ImportError:  # direct CLI execution
    from geo import haversine, to_float
try:
    from .graph import build_graph_recalc, calc_path_distance, count_lights_by_degree, count_lights_by_signals, edge_key, get_route_coords_recalc, nearest_node
except ImportError:  # direct CLI execution
    from graph import build_graph_recalc, calc_path_distance, count_lights_by_degree, count_lights_by_signals, edge_key, get_route_coords_recalc, nearest_node


def normalize_avoid_points(payload):
    """标准化路线避让点。避让点用于事故/拥堵绕行，但仍复用 plan_routes 主流程。"""
    raw_points = payload.get("avoidPoints") or payload.get("avoid_points") or []
    if not isinstance(raw_points, list):
        return []

    default_radius = to_float(payload.get("avoidRadiusMeters") or payload.get("avoid_radius_meters"))
    if default_radius is None:
        default_radius = 320.0
    default_radius = max(80.0, min(800.0, default_radius))

    default_multiplier = to_float(payload.get("avoidPenaltyMultiplier") or payload.get("avoid_penalty_multiplier"))
    if default_multiplier is None:
        default_multiplier = 20.0
    default_multiplier = max(4.0, min(60.0, default_multiplier))

    points = []
    for item in raw_points[:80]:
        if not isinstance(item, dict):
            continue
        lat = to_float(item.get("lat"))
        lon = to_float(item.get("lon"))
        if lat is None or lon is None:
            continue
        radius = to_float(item.get("radiusMeters") or item.get("radius_meters"))
        if radius is None:
            radius = default_radius
        multiplier = to_float(item.get("penaltyMultiplier") or item.get("penalty_multiplier"))
        if multiplier is None:
            multiplier = default_multiplier
        points.append({
            "lat": lat,
            "lon": lon,
            "radiusMeters": max(80.0, min(800.0, radius)),
            "penaltyMultiplier": max(4.0, min(60.0, multiplier)),
        })
    return points


def edge_avoidance_penalty(base_weight, from_node, to_node, avoid_points):
    """对靠近事故/拥堵避让点的边增加软惩罚，避免无路可走时完全断图。"""
    if not avoid_points:
        return 0.0

    mid_lat = (from_node["lat"] + to_node["lat"]) / 2.0
    mid_lon = (from_node["lon"] + to_node["lon"]) / 2.0
    penalty = 0.0
    for point in avoid_points:
        radius = point["radiusMeters"]
        distances = [
            haversine(from_node["lat"], from_node["lon"], point["lat"], point["lon"]),
            haversine(to_node["lat"], to_node["lon"], point["lat"], point["lon"]),
            haversine(mid_lat, mid_lon, point["lat"], point["lon"]),
        ]
        best = min(distances)
        if best > radius:
            continue
        closeness = 1.0 + ((radius - best) / radius)
        multiplier = point["penaltyMultiplier"]
        # 乘法惩罚用于正常边权，固定惩罚确保极短边也能被有效避让。
        penalty += (base_weight * multiplier * closeness) + (0.015 * closeness)
    return penalty



# Added by JR - to test for recalculate alternate route to avoid jam 
def recalculate_route(payload):

    # Get jammed/blocked links from payload
    blocked_edges = set(payload.get("blocked_edges") or [])

    roads = payload.get("roads") or {}
    start = payload.get("start") or {}
    end = payload.get("end") or {}
    signal_points = payload.get("signalPoints") or []

    start_lat = to_float(start.get("lat"))
    start_lon = to_float(start.get("lon"))
    end_lat = to_float(end.get("lat"))
    end_lon = to_float(end.get("lon"))
    if None in (start_lat, start_lon, end_lat, end_lon):
        return {"routes": []}

    start = {"lat": start_lat, "lon": start_lon}
    end = {"lat": end_lat, "lon": end_lon}


    road_meta = payload.get("road_meta") or {}

    nodes = build_graph_recalc(roads, road_meta)



    if not nodes:
        return {"routes": []}

    start_key = nearest_node(nodes, start_lat, start_lon)
    end_key = nearest_node(nodes, end_lat, end_lon)

    if not start_key or not end_key:
        return {"routes": []}

    # For recalculate route, maybe use only 1 option. Possibly put it in user settings
    preference = payload.get("preference", "fastest")
    modes = [
        {"id": "fastest", "label": "FASTEST", "color": "#2563eb", "desc": "Prioritize total time"},
        # {"id": "fewerLights", "label": "FEWER LIGHTS", "color": "#16a34a", "desc": "Reduce intersection waiting"},
        # {"id": "balanced", "label": "BALANCED", "color": "#ea580c", "desc": "Near-fastest with fewer lights"},
        # {"id": "fastest2", "label": "ALTERNATE A", "color": "#8b5cf6", "desc": "Diversified"},
        # {"id": "fastest3", "label": "ALTERNATE B", "color": "#06b6d4", "desc": "Diversified"},
    ]

    # Get the 'user's preference' from settings. Default fastest for now
    active_modes = [m for m in modes if m["id"] == preference]

    plans = []
    used_edge_sets: List[set] = []

    for mode in modes:

    
        def cost_fn(edge, from_node, to_node):

            ep = edge_key(from_node["key"], to_node["key"])

            

            # Load road_meta from passed parameters to map to LTA road link
            # road_meta = payload.get("road_meta") or {}
            base = edge["weight"]

            # Get the T+15 Speedbands cache to perform calculations using T+15 as heuristic
            BAND_TO_KMH = {1: 7, 2: 15, 3: 25, 4: 35, 5: 45, 6: 55, 7: 65, 8: 85}
            speed_kmh = 40.0
            t15_cache = payload.get("t15_cache", {})

            link_id = edge.get("link_id")
            # link_id = find_link_id_from_meta(to_node["lat"], to_node["lon"], road_meta)
            if link_id:
                link_id_int = int(link_id)
                if link_id_int in t15_cache:
                    pred_data = t15_cache[link_id_int]
                    predicted_sb = pred_data.get("predicted_val", 5)
                    speed_kmh = BAND_TO_KMH.get(predicted_sb, 40.0)

            if link_id and link_id in blocked_edges:
                return base * 10

            # Calculate Cost
            dist_km = edge["weight"] * 40.0
            base = dist_km / speed_kmh

            intersection_cost = (45 / 3600.0) if (to_node.get("degree") or 0) >= 3 else 0.0

            reuse_penalty = 10.0 if any(ep in s for s in used_edge_sets) else 0.0

            if mode["id"] == "fastest":
                return base + reuse_penalty
            if mode["id"] == "fewerLights":
                return base + intersection_cost * 1.8 + reuse_penalty
            return base + intersection_cost * 0.9 + reuse_penalty

        path_keys = a_star(nodes, start_key, end_key, cost_fn)
        if len(path_keys) < 2:
            continue


        edge_set = set()
        for i in range(len(path_keys) - 1):
            edge_set.add(edge_key(path_keys[i], path_keys[i + 1]))
        signature = ",".join(sorted(edge_set))
        if any(p.get("signature") == signature for p in plans):
            continue

        total_dist = calc_path_distance(path_keys, nodes, start, end)

        # Change to estimated time
        est_minutes = (total_dist / 1000.0 / 40.0) * 60.0
        coords = get_route_coords_recalc(path_keys, nodes, start, end)


        signal_lights = count_lights_by_signals(coords, signal_points, 30, 110)
        traffic_lights = signal_lights if signal_lights > 0 else count_lights_by_degree(path_keys, nodes)

        plans.append({
            "id": mode["id"],
            "label": mode["label"],
            "color": mode["color"],
            "desc": mode["desc"],
            "totalDist": total_dist,
            "estMinutes": est_minutes,
            "trafficLights": traffic_lights,
            "coords": coords,
            "signature": signature,
        })

        used_edge_sets.append(edge_set)

    plans.sort(key=lambda x: x.get("estMinutes", float("inf")))
    return {"routes": plans}


__all__ = [
    "normalize_avoid_points",
    "edge_avoidance_penalty",
    "recalculate_route",
]
