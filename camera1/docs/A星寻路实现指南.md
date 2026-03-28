# A* 寻路实现指南

本文档说明当前版本 A* 路径规划的实际实现方式。

## 1. 当前版本结论

当前 A* 寻路已经不是前端本地计算，也不只是 Node.js 调 Python 子进程。

当前主链路是：

1. 前端调用 `POST /api/route-plan`
2. Node.js 聚合道路数据和信号点
3. Node.js 调 FastAPI `/compute/plan-routes`
4. FastAPI 调用 `compute_engine.py` 中的 `plan_routes`
5. FastAPI 失败时，Node.js 才回退到旧的 Python 子进程方式

## 2. 代码位置

1. 前端入口：
- [/Users/apple/Desktop/fyp_demo/UI 2/script.js](/Users/apple/Desktop/fyp_demo/UI%202/script.js)
  - `calculateRoutes()`
  - `fetchRoutePlansFromPython()` 这类前端入口仍然是调用后端 `/api/route-plan`

2. Node.js 后端：
- [/Users/apple/Desktop/fyp_demo/camera1/server.js](/Users/apple/Desktop/fyp_demo/camera1/server.js)
  - `app.post('/api/route-plan', ...)`

3. FastAPI 服务：
- [/Users/apple/Desktop/fyp_demo/camera1/py/api_server.py](/Users/apple/Desktop/fyp_demo/camera1/py/api_server.py)

4. Python 算法：
- [/Users/apple/Desktop/fyp_demo/camera1/py/compute_engine.py](/Users/apple/Desktop/fyp_demo/camera1/py/compute_engine.py)
  - `plan_routes(payload)`
  - `a_star(...)`

## 3. 当前 API 流程

1. 前端先通过 `/api/geocode` 解析输入地点
2. 前端把起点终点经纬度提交到 `/api/route-plan`
3. Node.js 根据起终点计算 bbox
4. Node.js 调 Overpass 获取道路网络
5. Node.js 加载红绿灯信号点
6. Node.js 调 FastAPI `/compute/plan-routes`
7. FastAPI 执行 `plan_routes`
8. 返回三条路线给前端

## 4. A* 当前实现逻辑

### 4.1 图构建

在 `compute_engine.py` 中：

1. 基于 Overpass 返回的道路几何构图
2. 节点通过 `node_key` 归一化
3. 边按道路几何双向建边

### 4.2 边权重

基础时间权重：

- `distance(km) / 40` 小时

### 4.3 启发函数

启发函数使用 Haversine 距离：

- `h(n) = Haversine(n, end) / 1000 / 50`

### 4.4 三类策略

当前固定返回三条：

1. `fastest`
- 时间优先

2. `fewerLights`
- 对路口额外惩罚，减少红绿灯等待

3. `balanced`
- 在时间与红绿灯之间折中

### 4.5 红绿灯统计

优先使用真实信号点：

1. 路线附近命中
2. 半径去重

若真实信号点不足，再退回路口度数法估算。

## 5. 接口说明

### 5.1 外层接口

```http
POST /api/route-plan
```

请求示例：

```json
{
  "start": { "lat": 1.3521, "lon": 103.8198 },
  "end": { "lat": 1.3009, "lon": 103.8452 },
  "paddingDeg": 0.03
}
```

### 5.2 内层 FastAPI 接口

```http
POST /compute/plan-routes
```

这是 Node.js 内部调 FastAPI 时使用的接口。

## 6. 当前返回结果

后端返回结构（简化）：

```json
{
  "routes": [
    {
      "id": "fastest",
      "label": "FASTEST",
      "color": "#2563eb",
      "totalDist": 12345.6,
      "estMinutes": 22.1,
      "trafficLights": 19,
      "coords": [[1.35,103.82],[1.34,103.83]]
    }
  ],
  "meta": {
    "engine": "fastapi",
    "signalCount": 2000,
    "generatedAt": "2026-03-23T...Z"
  }
}
```

如果 FastAPI 不可用，`meta.engine` 会回退为：

- `python-fallback`

## 7. 运行要求

1. Node.js 18+
2. Python 3+
3. FastAPI 依赖已安装
4. `.venv` 可用

建议：

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-fastapi.txt
```

## 8. 启动方式

终端 1：

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
source .venv/bin/activate
npm run start:fastapi
```

终端 2：

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm start
```

## 9. 已知限制

1. Overpass 网络波动会直接影响路由响应时间
2. 当前仍未接入更细粒度的封路、单行、临时交通限制
3. 路线本体由 A* 给出，事故叠加延误仍在后续事件评分中处理
4. 当前 FastAPI 主路径已接入，但 Node.js 仍保留回退逻辑
