"""A* search implementation for the road graph."""

import heapq

try:
    from .geo import haversine
except ImportError:  # direct CLI execution
    from geo import haversine


def reconstruct_path(prev, end_key):
    """根据 prev 映射回溯路径。"""
    out = []
    cur = end_key
    while cur is not None:
        out.append(cur)
        cur = prev.get(cur)
    out.reverse()
    return out


def a_star(nodes, start_key, end_key, cost_fn):
    """
    A* 主过程。

    - g：起点到当前点的已知最小代价（实际累计）
    - h：当前点到终点的启发式估计（直线距离/50kmh）
    - f = g + h：用于优先队列排序

    说明：
    - 这里的 h 使用“可接受启发”（低估真实成本）思路，保证路径可行性。
    - 当 end_key 不可达时返回空数组，由上层做兜底处理。
    """
    g = {start_key: 0.0}
    prev = {start_key: None}
    open_heap = [(0.0, start_key)]  # 小根堆，存 (f_score, node_key)
    closed = set()

    while open_heap:
        _, current = heapq.heappop(open_heap)
        if current in closed:
            continue
        if current == end_key:
            break

        closed.add(current)
        cur_node = nodes[current]

        for edge in cur_node["edges"]:
            to_key = edge["to"]
            if to_key in closed:
                continue

            tentative = g[current] + cost_fn(edge, cur_node, nodes[to_key])
            if tentative < g.get(to_key, float("inf")):
                prev[to_key] = current
                g[to_key] = tentative
                h = haversine(nodes[to_key]["lat"], nodes[to_key]["lon"], nodes[end_key]["lat"], nodes[end_key]["lon"]) / 1000.0 / 50.0
                heapq.heappush(open_heap, (tentative + h, to_key))

    if end_key not in prev:
        return []
    return reconstruct_path(prev, end_key)


__all__ = ["reconstruct_path", "a_star"]
