# ROUTING README

本文档说明当前版本导航功能的运行方式、调用链路和排障方式。

## 1. 当前版本结论

当前导航功能的主路径已经变成：

1. 前端调用 Node.js `/api/route-plan`
2. Node.js 优先调用 FastAPI 计算服务
3. FastAPI 调用 Python 路径规划算法
4. 若 FastAPI 不可用，Node.js 回退到 Python 子进程

所以当前不是单纯：

- 前端 -> Node.js -> Python 子进程

而是：

- 前端 -> Node.js -> FastAPI -> Python 算法

## 2. 相关文件

1. 前端导航逻辑：
- [/Users/apple/Desktop/fyp_demo/UI 2/script.js](/Users/apple/Desktop/fyp_demo/UI%202/script.js)

2. Node.js 路由入口：
- [/Users/apple/Desktop/fyp_demo/camera1/server.js](/Users/apple/Desktop/fyp_demo/camera1/server.js)

3. FastAPI 服务：
- [/Users/apple/Desktop/fyp_demo/camera1/py/api_server.py](/Users/apple/Desktop/fyp_demo/camera1/py/api_server.py)

4. Python 路径规划算法：
- [/Users/apple/Desktop/fyp_demo/camera1/py/compute_engine.py](/Users/apple/Desktop/fyp_demo/camera1/py/compute_engine.py)

## 3. 当前相关接口

### 3.1 地理编码

- `GET /api/geocode?q=<postal|place|mrt>`

### 3.2 路线规划

- `POST /api/route-plan`

### 3.3 路线事件分析

- `POST /api/route-events/analyze`

### 3.4 路线事件评分

- `POST /api/route-events/evaluate`

## 4. 当前启动方式

### 4.1 启动 FastAPI

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
source .venv/bin/activate
npm run start:fastapi
```

### 4.2 启动 Node.js

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm start
```

### 4.3 打开页面

- `http://localhost:3000/ui2/`

## 5. 当前路径规划链路

1. 前端输入起点终点
2. 前端通过 `/api/geocode` 解析邮编、地名或 MRT
3. 前端调用 `/api/route-plan`
4. Node.js 拉取 Overpass 路网与信号点
5. Node.js 调用 FastAPI `/compute/plan-routes`
6. FastAPI 进入 `compute_engine.py -> plan_routes`
7. 返回三条路线给前端

## 6. 当前策略

返回路线固定为三类：

1. `fastest`
2. `fewerLights`
3. `balanced`

前端再结合事故与事件评分，做二次排序和状态展示。

## 7. 现在的 FastAPI 接口映射

### Node.js 外层接口

1. `POST /api/route-plan`
2. `POST /api/route-events/analyze`
3. `POST /api/route-events/evaluate`

### FastAPI 内层接口

1. `POST /compute/plan-routes`
2. `POST /compute/analyze-events-for-route`
3. `POST /compute/evaluate-route-events`

## 8. 自检方式

### 8.1 检查 FastAPI 是否在线

```bash
curl http://127.0.0.1:8000/health
```

### 8.2 检查 Node.js 路线规划接口

```bash
curl -X POST http://localhost:3000/api/route-plan \
  -H "Content-Type: application/json" \
  -d '{"start":{"lat":1.3521,"lon":103.8198},"end":{"lat":1.3009,"lon":103.8452}}'
```

## 9. 常见问题

1. `FastAPI timeout`
- 检查 `npm run start:fastapi` 是否已启动

2. `Python route planning failed`
- 若 FastAPI 不可用，会回退到 Python 子进程
- 检查 `PYTHON_BIN=python3`

3. `Overpass API 错误`
- 这是上游路网数据波动，不是前端问题

4. `No available route found`
- 起终点可能超出当前可连通路网范围

## 10. 当前实现特点

1. 主路径已经是 FastAPI
2. Node.js 仍保留回退机制
3. 前端无需直接感知 FastAPI，仍然只调 Node.js `/api/*`
