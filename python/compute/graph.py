"""Road graph construction and route metric helpers."""

from typing import Dict

try:
    from .geo import distance_to_route, haversine, nearest_coord_index, to_float
except ImportError:  # direct CLI execution
    from geo import distance_to_route, haversine, nearest_coord_index, to_float


def node_key(lat, lon):
    """节点归一化 key：保留 4 位小数，约 10m 级别合并。"""
    return f"{round(lat, 4)},{round(lon, 4)}"


def build_graph(roads):
    """
    从 Overpass 返回的 roads.elements 构建图结构。

    图结构说明：
    - 节点：{key, lat, lon, edges, degree}
    - 边：{to, weight}，其中 weight 为“小时”
    """
    nodes: Dict[str, Dict] = {}

    def ensure(lat, lon):
        k = node_key(lat, lon)
        if k not in nodes:
            nodes[k] = {"key": k, "lat": lat, "lon": lon, "edges": [], "degree": 0}
        return nodes[k]

    for el in (roads or {}).get("elements", []):
        if el.get("type") != "way":
            continue
        geom = el.get("geometry") or []
        if len(geom) < 2:
            continue

        for i in range(len(geom) - 1):
            a = geom[i]
            b = geom[i + 1]
            a_lat = to_float(a.get("lat"))
            a_lon = to_float(a.get("lon"))
            b_lat = to_float(b.get("lat"))
            b_lon = to_float(b.get("lon"))
            if None in (a_lat, a_lon, b_lat, b_lon):
                continue

            n1 = ensure(a_lat, a_lon)
            n2 = ensure(b_lat, b_lon)

            dist_m = haversine(a_lat, a_lon, b_lat, b_lon)
            if dist_m < 2:
                continue

            # 假设平均速度 40km/h，权重单位为“小时”
            base_hours = (dist_m / 1000.0) / 40.0

            # 双向建边
            n1["edges"].append({"to": n2["key"], "weight": base_hours})
            n2["edges"].append({"to": n1["key"], "weight": base_hours})

            # 度数用于路口判断（度数>=3 通常视为路口）
            n1["degree"] += 1
            n2["degree"] += 1

    return nodes


def nearest_node(nodes, lat, lon):
    """在图中找距离给定坐标最近的节点，限制 600 米内。"""
    best_key = None
    best_dist = float("inf")
    for k, n in nodes.items():
        d = haversine(lat, lon, n["lat"], n["lon"])
        if d < best_dist and d < 600:
            best_dist = d
            best_key = k
    return best_key


def edge_key(a, b):
    """无向边标准化 key，用于去重与复用惩罚计算。"""
    return f"{a}|{b}" if a < b else f"{b}|{a}"


def count_lights_by_signals(route_coords, signal_points, match_radius_m=30, dedupe_radius_m=110):
    """
    用真实信号点位统计红绿灯数量，并按“路口中心”去重。

    核心思路：
    1) 先筛出离路线足够近的信号点
    2) 为每个信号点找到其在路线上的最近位置
    3) 同时基于“空间距离”和“沿路线距离”聚成一个路口中心
    4) 每个路口中心只计 1 次

    这样可以减少一个大型路口被多个信号灯杆重复计数的问题。
    """
    if len(route_coords) < 2 or not signal_points:
        return 0

    cumulative = [0.0]
    for i in range(1, len(route_coords)):
        prev = route_coords[i - 1]
        cur = route_coords[i]
        cumulative.append(cumulative[-1] + haversine(prev[0], prev[1], cur[0], cur[1]))

    hits = []
    for sig in signal_points:
        s_lat = to_float(sig.get("lat"))
        s_lon = to_float(sig.get("lon"))
        if s_lat is None or s_lon is None:
            continue
        if distance_to_route(route_coords, s_lat, s_lon) > match_radius_m:
            continue
        idx = nearest_coord_index(route_coords, s_lat, s_lon)
        hits.append({
            "lat": s_lat,
            "lon": s_lon,
            "route_index": idx,
            "route_distance": cumulative[idx]
        })

    if not hits:
        return 0

    hits.sort(key=lambda x: x["route_distance"])
    clusters = []
    along_route_merge_m = 140

    for sig in hits:
        merged = False
        for c in clusters:
            spatial_close = haversine(sig["lat"], sig["lon"], c["lat"], c["lon"]) <= dedupe_radius_m
            route_close = abs(sig["route_distance"] - c["route_distance"]) <= along_route_merge_m
            if spatial_close or route_close:
                count = c["count"] + 1
                c["lat"] = (c["lat"] * c["count"] + sig["lat"]) / count
                c["lon"] = (c["lon"] * c["count"] + sig["lon"]) / count
                c["route_distance"] = (c["route_distance"] * c["count"] + sig["route_distance"]) / count
                c["count"] = count
                merged = True
                break
        if not merged:
            clusters.append({
                "lat": sig["lat"],
                "lon": sig["lon"],
                "route_distance": sig["route_distance"],
                "count": 1
            })

    return len(clusters)


def count_lights_by_degree(path_keys, nodes):
    """当真实信号点不足时，用“节点度数>=3”估算红绿灯。"""
    if len(path_keys) < 3:
        return 0
    cnt = 0
    for i in range(1, len(path_keys) - 1):
        if (nodes[path_keys[i]].get("degree") or 0) >= 3:
            cnt += 1
    return cnt


def calc_path_distance(path_keys, nodes, start, end):
    """计算完整路径总长度（米），包含起点接入与终点接出。"""
    total = 0.0
    prev_lat = start["lat"]
    prev_lon = start["lon"]
    for k in path_keys:
        n = nodes[k]
        total += haversine(prev_lat, prev_lon, n["lat"], n["lon"])
        prev_lat = n["lat"]
        prev_lon = n["lon"]
    total += haversine(prev_lat, prev_lon, end["lat"], end["lon"])
    return total


def get_route_coords(path_keys, nodes, start, end):
    """把路径节点序列转为前端可直接绘制的坐标数组。"""
    coords = [[start["lat"], start["lon"]]]
    for k in path_keys:
        n = nodes[k]
        coords.append([n["lat"], n["lon"]])
    coords.append([end["lat"], end["lon"]])
    return coords


def get_route_coords_recalc(path_keys, nodes, start, end):
    coords = [{"lat": start["lat"], "lon": start["lon"], "degree": 0}]
    for k in path_keys:
        n = nodes[k]
        degree = n.get("degree", 0)
        coords.append({
            "lat": n["lat"],
            "lon": n["lon"],
            "degree": degree,
            "is_exit": degree > 2
        })
    coords.append({"lat": end["lat"], "lon": end["lon"], "degree": 0})
    return coords

def find_link_id_from_meta(lat, lon, road_meta):
    best_id = None
    min_dist = float('inf')

    for lid, data in road_meta.items():
        d = (lat - data['mid_lat'])**2 + (lon - data['mid_lon'])**2
        if d < min_dist:
            min_dist = d
            best_id = lid

    return str(best_id) if best_id else None


def build_graph_recalc(roads, road_meta):
    nodes: Dict[str, Dict] = {}

    def ensure(lat, lon):
        k = node_key(lat, lon)
        if k not in nodes:
            nodes[k] = {"key": k, "lat": lat, "lon": lon, "edges": [], "degree": 0}
        return nodes[k]

    for el in (roads or {}).get("elements", []):
        if el.get("type") != "way":
            continue

        # if el.get("type") == "way":
        #     tags = el.get("tags") or {}
        #     hw = tags.get("highway")
        #     ow = tags.get("oneway")
        #     if hw in ("motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link"):
        #         print("WAY", el.get("id"), "highway=", hw, "oneway=", ow, flush=True)

        tags = el.get("tags") or {}
        oneway = str(tags.get("oneway", "")).strip().lower()

        geom = el.get("geometry") or []
        if len(geom) < 2:
            continue

        for i in range(len(geom) - 1):
            a, b = geom[i], geom[i + 1]
            a_lat, a_lon = to_float(a.get("lat")), to_float(a.get("lon"))
            b_lat, b_lon = to_float(b.get("lat")), to_float(b.get("lon"))

            if None in (a_lat, a_lon, b_lat, b_lon):
                continue

            n1, n2 = ensure(a_lat, a_lon), ensure(b_lat, b_lon)
            dist_m = haversine(a_lat, a_lon, b_lat, b_lon)
            if dist_m < 2:
                continue

            base_hours = (dist_m / 1000.0) / 40.0

            mid_lat = (a_lat + b_lat) / 2.0
            mid_lon = (a_lon + b_lon) / 2.0

            edge_link_id = None

            if oneway in ("yes", "1", "true"):
                n1["edges"].append({"to": n2["key"], "weight": base_hours, "link_id": edge_link_id})
            elif oneway == "-1":
                n2["edges"].append({"to": n1["key"], "weight": base_hours, "link_id": edge_link_id})
            else:
                n1["edges"].append({"to": n2["key"], "weight": base_hours, "link_id": edge_link_id})
                n2["edges"].append({"to": n1["key"], "weight": base_hours, "link_id": edge_link_id})

            n1["degree"] += 1
            n2["degree"] += 1

    return nodes


__all__ = [
    "node_key",
    "build_graph",
    "nearest_node",
    "edge_key",
    "count_lights_by_signals",
    "count_lights_by_degree",
    "calc_path_distance",
    "get_route_coords",
    "get_route_coords_recalc",
    "find_link_id_from_meta",
    "build_graph_recalc",
]
