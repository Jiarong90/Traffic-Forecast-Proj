#!/usr/bin/env python3
"""
Routing compute CLI and public route-planning entry points.

The heavy implementation is split by responsibility:
- graph.py: road graph construction and route metrics
- astar.py: A* search
- avoidance.py: avoidance-point rerouting
- route_events.py: route event filtering/scoring
- incidents.py / cameras.py: incident normalization and camera matching
"""

import argparse
import json
import sys
from typing import List

try:
    from .astar import a_star
except ImportError:  # direct CLI execution
    from astar import a_star
try:
    from .avoidance import edge_avoidance_penalty, normalize_avoid_points, recalculate_route
except ImportError:  # direct CLI execution
    from avoidance import edge_avoidance_penalty, normalize_avoid_points, recalculate_route
try:
    from .cameras import enrich_incidents_with_cameras
except ImportError:  # direct CLI execution
    from cameras import enrich_incidents_with_cameras
try:
    from .geo import to_float
except ImportError:  # direct CLI execution
    from geo import to_float
try:
    from .graph import build_graph, calc_path_distance, count_lights_by_degree, count_lights_by_signals, edge_key, get_route_coords, nearest_node
except ImportError:  # direct CLI execution
    from graph import build_graph, calc_path_distance, count_lights_by_degree, count_lights_by_signals, edge_key, get_route_coords, nearest_node
try:
    from .incident_prediction import incident_predict
except ImportError:  # direct CLI execution
    from incident_prediction import incident_predict
try:
    from .incidents import normalize_incidents
except ImportError:  # direct CLI execution
    from incidents import normalize_incidents
try:
    from .route_events import analyze_events_for_route, evaluate_route_events
except ImportError:  # direct CLI execution
    from route_events import analyze_events_for_route, evaluate_route_events


def plan_routes(payload):
    """
    路线规划主函数。

    输入：
    - roads: Overpass 道路数据
    - start/end: 起终点坐标
    - signalPoints: 真实信号点位

    输出：
    - routes: 3 条策略路线（若可达）

    路线策略说明：
    - fastest：主要最小化基础时间
    - fewerLights：提高路口惩罚权重，尽量减少信号灯干预
    - balanced：在时间与路口惩罚之间取中间权重

    去重策略说明：
    - 对每条路径生成边签名（signature）
    - 签名重复的候选会被丢弃，避免 3 条路线只是颜色不同
    """
    roads = payload.get("roads") or {}
    start = payload.get("start") or {}
    end = payload.get("end") or {}
    signal_points = payload.get("signalPoints") or []
    avoid_points = normalize_avoid_points(payload)

    start_lat = to_float(start.get("lat"))
    start_lon = to_float(start.get("lon"))
    end_lat = to_float(end.get("lat"))
    end_lon = to_float(end.get("lon"))
    if None in (start_lat, start_lon, end_lat, end_lon):
        return {"routes": []}

    start = {"lat": start_lat, "lon": start_lon}
    end = {"lat": end_lat, "lon": end_lon}

    nodes = build_graph(roads)
    if not nodes:
        return {"routes": []}

    start_key = nearest_node(nodes, start_lat, start_lon)
    end_key = nearest_node(nodes, end_lat, end_lon)
    if not start_key or not end_key:
        return {"routes": []}

    # 三个策略与前端旧版逻辑保持一致
    modes = [
        {"id": "fastest", "label": "FASTEST", "color": "#2563eb", "desc": "Prioritize total time"},
        {"id": "fewerLights", "label": "FEWER LIGHTS", "color": "#16a34a", "desc": "Reduce intersection waiting"},
        {"id": "balanced", "label": "BALANCED", "color": "#ea580c", "desc": "Near-fastest with fewer lights"},
    ]

    plans = []
    used_edge_sets: List[set] = []

    for mode in modes:

        # 不同策略使用不同代价函数，但都基于同一张图和同一 A*
        def cost_fn(edge, from_node, to_node):
            base = edge["weight"]
            intersection_cost = (15 / 3600.0) if (to_node.get("degree") or 0) >= 3 else 0.0
            avoid_penalty = edge_avoidance_penalty(base, from_node, to_node, avoid_points)

            # 若该边已被前一条路线使用，增加少量复用惩罚，提高路线差异性
            ep = edge_key(from_node["key"], to_node["key"])
            reuse_penalty = 0.025 if any(ep in s for s in used_edge_sets) else 0.0

            if mode["id"] == "fastest":
                return base + avoid_penalty + reuse_penalty
            if mode["id"] == "fewerLights":
                return base + avoid_penalty + intersection_cost * 1.8 + reuse_penalty
            return base + avoid_penalty + intersection_cost * 0.9 + reuse_penalty

        path_keys = a_star(nodes, start_key, end_key, cost_fn)
        if len(path_keys) < 2:
            continue

        # 生成签名，去掉完全重复的路线
        edge_set = set()
        for i in range(len(path_keys) - 1):
            edge_set.add(edge_key(path_keys[i], path_keys[i + 1]))
        signature = ",".join(sorted(edge_set))
        if any(p.get("signature") == signature for p in plans):
            continue

        total_dist = calc_path_distance(path_keys, nodes, start, end)
        est_minutes = (total_dist / 1000.0 / 40.0) * 60.0
        coords = get_route_coords(path_keys, nodes, start, end)

        # 优先用真实信号点统计红绿灯；这里采用更保守的“窄命中 + 大去重”
        # 以减少一个大型路口被拆成多个信号组导致的高估问题。
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

    # 返回前按基础 ETA 升序
    plans.sort(key=lambda x: x.get("estMinutes", float("inf")))
    return {"routes": plans}


# -------------------- CLI 入口 --------------------
def main():
    """
    命令行入口。

    执行流程：
    1) 读取 --op
    2) 从 stdin 读取 JSON payload
    3) 分发到对应 op
    4) 将结果 JSON 序列化输出到 stdout
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--op", required=True)
    args = parser.parse_args()

    raw = sys.stdin.read() or "{}"
    payload = json.loads(raw)

    if args.op == "enrich_incidents_with_cameras":
        result = enrich_incidents_with_cameras(payload)
    elif args.op == "normalize_incidents":
        result = normalize_incidents(payload)
    elif args.op == "analyze_events_for_route":
        result = analyze_events_for_route(payload)
    elif args.op == "evaluate_route_events":
        result = evaluate_route_events(payload)
    elif args.op == "plan_routes":
        result = plan_routes(payload)
    elif args.op == "recalculate_route":
        result = recalculate_route(payload)
    elif args.op == "incident_predict":
        result = incident_predict(payload)
    else:
        raise RuntimeError(f"Unsupported op: {args.op}")

    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stderr.write(str(exc))
        sys.exit(1)
