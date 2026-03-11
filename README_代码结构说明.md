# FYP Demo 代码结构说明（2026-03-11）

本文档用于说明当前项目的实际结构与职责分工。

## 1. 根目录

1. `/Users/apple/Desktop/fyp_demo/UI 2`
- 主前端页面（你现在实际使用的页面）。

2. `/Users/apple/Desktop/fyp_demo/camera1`
- 后端服务（Node.js + Express + PostgreSQL）
- Python 计算引擎（路径规划与事故摄像头匹配）。

3. `/Users/apple/Desktop/fyp_demo/README.md`
- 总体使用说明（启动、部署、GitHub更新流程）。

4. `/Users/apple/Desktop/fyp_demo/README_代码结构说明.md`
- 当前文件（代码结构索引）。

5. `/Users/apple/Desktop/fyp_demo/README_一键使用说明.md`
- 给其他人的本地一键运行说明（Docker Compose）。

## 2. 前端（UI 2）

1. `/Users/apple/Desktop/fyp_demo/UI 2/index.html`
- 页面骨架：Dashboard、Map View、Route Planner、Weather、Alerts、登录注册。

2. `/Users/apple/Desktop/fyp_demo/UI 2/styles.css`
- UI 样式。

3. `/Users/apple/Desktop/fyp_demo/UI 2/script.js`
- 前端核心逻辑：
  - 登录注册/会话状态
  - 摄像头与事故渲染
  - 调用后端 `/api/route-plan` 做路径规划
  - 管理员模拟路线
  - Alerts + View Details + AI 摘要
  - 右侧资讯栏（近7天事故新闻 + 最新交通规则）

## 3. 后端（camera1）

1. `/Users/apple/Desktop/fyp_demo/camera1/server.js`
- 后端主入口，负责：
  - 认证、会话、验证码注册
  - 摄像头/事故/天气/地理编码 API
  - 路径规划 API：`POST /api/route-plan`
  - 资讯流聚合 API：`GET /api/traffic-info-feed`
  - 限流、日志追踪、缓存和容错

2. `/Users/apple/Desktop/fyp_demo/camera1/py/compute_engine.py`
- Python 计算引擎：
  - `plan_routes`：A* 三策略路径规划
  - `enrich_incidents_with_cameras`：事故匹配最近摄像头

3. `/Users/apple/Desktop/fyp_demo/camera1/config.js`
- 基础配置（端口等）。

4. `/Users/apple/Desktop/fyp_demo/camera1/.env`
- 本地环境变量（数据库、API key、SMTP、Python 命令）。

5. `/Users/apple/Desktop/fyp_demo/camera1/.env.example`
- 环境变量模板。

6. `/Users/apple/Desktop/fyp_demo/camera1/package.json`
- Node 依赖和启动脚本。

## 4. 数据与文档

1. `/Users/apple/Desktop/fyp_demo/camera1/data/incident_api_mock.json`
- 管理员模拟事故数据。

2. `/Users/apple/Desktop/fyp_demo/camera1/data/LTATrafficSignalAspectGEOJSON.geojson`
- 信号点位数据（红绿灯统计）。

3. `/Users/apple/Desktop/fyp_demo/camera1/docs/摄像头实现指南.md`
4. `/Users/apple/Desktop/fyp_demo/camera1/docs/A星寻路实现指南.md`
5. `/Users/apple/Desktop/fyp_demo/camera1/docs/ROUTING_README.md`
- 这三份是你当前逻辑对应的详细技术文档。

## 5. 部署相关文件

1. `/Users/apple/Desktop/fyp_demo/Dockerfile`
- 生产/线上容器构建（Node + Python 同镜像）。

2. `/Users/apple/Desktop/fyp_demo/.dockerignore`
- Docker 构建忽略清单。

3. `/Users/apple/Desktop/fyp_demo/docker-compose.yml`
- 本地一键运行（web + postgres）。

4. `/Users/apple/Desktop/fyp_demo/render.yaml`
- Render Blueprint（线上自动部署配置）。

## 6. 运行入口

1. 本地开发（原生）：
```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm start
```

2. 本地一键（Docker）：
```bash
cd /Users/apple/Desktop/fyp_demo
docker compose up --build
```

3. 访问地址：
- `http://localhost:3000/ui2/`

## 7. public 目录现状

1. `/Users/apple/Desktop/fyp_demo/camera1/public` 目前为空（旧页面已移除）。
2. `server.js` 仍保留 `express.static(public)`，但当前业务主流程不依赖它。

## 8. 当前主要 API

1. `GET /api/cameras`
2. `GET /api/incidents`
3. `GET /api/geocode`
4. `POST /api/route-plan`
5. `GET /api/weather/current`
6. `GET /api/weather/forecast`
7. `POST /api/ai/incident-summary`
8. `GET /api/traffic-info-feed`
