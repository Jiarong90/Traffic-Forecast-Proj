"""Shared geographic and numeric helpers for routing compute modules."""

import math


def haversine(lat1, lon1, lat2, lon2):
    """计算两点球面距离（单位：米）。"""
    r = 6371000.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def to_float(v):
    """将输入安全转为有限浮点数；失败返回 None。"""
    try:
        n = float(v)
        if math.isfinite(n):
            return n
    except Exception:
        return None
    return None


def distance_to_route(route_coords, lat, lon):
    """计算点到路线折线点集的最小距离（简化为点到顶点最小值）。"""
    best = float("inf")
    for c in route_coords:
        d = haversine(lat, lon, c[0], c[1])
        if d < best:
            best = d
    return best


def nearest_coord_index(coords, lat, lon):
    """找到给定点在路线坐标数组中的最近索引。"""
    best_i = 0
    best_d = float("inf")
    for i, c in enumerate(coords or []):
        d = haversine(lat, lon, c[0], c[1])
        if d < best_d:
            best_d = d
            best_i = i
    return best_i
