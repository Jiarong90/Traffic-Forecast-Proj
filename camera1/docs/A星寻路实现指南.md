# A星寻路实现指南

## 当前实现位置

路径规划核心位于：
- [/Users/apple/Desktop/fyp_demo/camera1/py/compute_engine.py](/Users/apple/Desktop/fyp_demo/camera1/py/compute_engine.py)

FastAPI 当前入口：
- [/Users/apple/Desktop/fyp_demo/camera1/py/combined_api_server.py](/Users/apple/Desktop/fyp_demo/camera1/py/combined_api_server.py)

Node 路由入口：
- [/Users/apple/Desktop/fyp_demo/camera1/server.js](/Users/apple/Desktop/fyp_demo/camera1/server.js)
- `POST /api/route-plan`
- `POST /api/ml/recalculate`

## 当前实现方式

当前系统不是直接把浏览器地图当路由器。

而是：
1. 使用本地新加坡路网快照
2. 截取起终点附近子图
3. Python 构图
4. A* / 多策略搜索
5. 返回三条候选路线

## 当前输出

每条路线输出包含：
- id
- label
- color
- estMinutes
- totalDist
- lights
- coords

## 重规划

当前已经支持从实时位置重新规划路线。

对应计算入口：
- `recalculate_route(...)`

用途：
- 用户偏航后，从当前实时位置到原终点重新计算路线

## 红绿灯统计

当前红绿灯数量基于真实信号点，并带有去重处理。

现有目标是：
- 避免同一个大型路口重复统计
- 保证 `fewer lights` 路线相对更合理

## 当前说明

这是 demo 级别的路径规划实现，不是商业级车载导航引擎。
