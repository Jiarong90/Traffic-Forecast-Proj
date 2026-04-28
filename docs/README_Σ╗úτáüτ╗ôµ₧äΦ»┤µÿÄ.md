# README 代码结构说明

本文档描述当前 `fyp_demo` 的实际代码结构，已同步到 `frontend/`、`backend/`、`python/` 三段式结构。

## 顶层结构

```text
fyp_demo/
  start.sh
  README.md
  Dockerfile
  docker-compose.yml
  render.yaml

  frontend/
  backend/
  python/
  docs/
```

### 顶层文件

- `start.sh`: macOS / Linux / WSL 一键启动脚本，同时启动 FastAPI 和 Node.js。
- `README.md`: 项目总体说明和本地运行说明。
- `Dockerfile`, `docker-compose.yml`, `render.yaml`: 部署相关文件。

## Frontend

目录：

```text
frontend/
  index.html
  manifest.json
  mobile-location.html
  ml-traffic-model.js
  sw.js

  assets/images/
  css/
  js/
```

### Frontend 入口

- `index.html`: 主页面 HTML，包含 Home、About、Dashboard、Map View、Route Planner、Weather、Alerts、Profile、Settings、Admin Users 等页面结构。
- `mobile-location.html`: 安卓手机上传实时定位的页面。
- `manifest.json`: PWA manifest。
- `sw.js`: service worker，用于 `/` 路径下的静态资源缓存。
- `ml-traffic-model.js`: 前端天气影响预测辅助模块，当前主要用于 Alerts 详情中的 ML traffic impact prediction。

### Frontend Images

目录：`frontend/assets/images/`

当前主要资源：

- `logo2.jpg`: 当前顶部 logo。
- `logo1.jpg`: Home 第四页背景。
- `home-1.1.png`, `home-1.2.png`, `home-1.3.png`: Home 前三页背景图。
- `CAMERA.jpg`, `INCIDENTS.jpg`, `ERP.jpg`, `PGS.jpg`: Map View / Route Planner 地图图标。
- `Yang.jpg`: About team member 图片。
- `paynow.jpg`: Profile membership 升级二维码。
- `logo-192.png`, `logo-512.png`: PWA 图标。

### Frontend CSS

目录：`frontend/css/`

加载顺序由 `frontend/index.html` 控制：

- `base.css`: 根变量、全局基础样式、顶部导航、logo、通用按钮基础。
- `layout.css`: Home、About、Business Model、Auth、Profile、Settings 等布局。
- `components.css`: Dashboard 卡片、Admin Users、Feedback 表格和通用组件。
- `pages-dashboard.css`: Dashboard 和 Map View 相关样式。
- `pages-map.css`: Route Planner 地图、路线控制和部分地图覆盖样式。
- `pages-route.css`: Route Planner 卡片、路线选项、trip cost 相关样式。
- `pages-weather.css`: Weather 页面样式。
- `pages-alerts.css`: Alerts、Habit Routes、Expressway analytics、Incident ML、Journey HUD 等样式。
- `modals.css`: 弹窗、移动端和最终覆盖样式。

说明：CSS 已按文件拆分，但仍保留部分历史大块样式，目的是避免前端视觉行为在重构时变化。

### Frontend JavaScript

目录：`frontend/js/`

当前实际运行文件：

```text
frontend/js/
  app.js
  auth.js

  pages/
    dashboard.js
    routePlanner.js
    weather.js

  features/
    chatbot.js
    incidentImpact.js
    journey.js
    mobileMenu.js
    reroute.js
```

文件职责：

- `app.js`: 前端最终启动入口，注册 service worker、初始化 Journey Simulation 和 Incident ML detail。
- `auth.js`: 页面切换、登录注册、验证码、Profile、Settings、车辆信息、会员状态、顶部菜单和 logo/Home 跳转。
- `pages/dashboard.js`: 全局地图状态、Dashboard、Map View、Alerts 基础渲染、摄像头/事故/ERP/PGS/feedback 点位、Admin feedback 展示。
- `pages/routePlanner.js`: Route Planner、路线生成、路线卡片、路线确认、trip cost、地图路线、路线上的摄像头/事故/feedback 点位。
- `pages/weather.js`: Weather 查询、当前位置天气、天气详情和天气建议。
- `features/reroute.js`: Habit Routes、路线智能分析、事故/拥堵点避让重规划、候选绕行。
- `features/journey.js`: 导航 journey simulation、红点移动、已走灰色路线、路段 pin 和 journey 状态。
- `features/incidentImpact.js`: Alerts 详情里的 incident ML panel、影响预测和反馈保存。
- `features/chatbot.js`: FASTbot、Expressway analytics、hotspots、chatbot 触发 route planner。
- `features/mobileMenu.js`: 移动端菜单开关。

已删除内容：

- 空的前端 placeholder 文件已删除，例如 `api.js`、`state.js`、`utils.js`、`pages/home.js`、`features/routing.js` 等。

## Backend

目录：

```text
backend/
  server.js
  config.js
  package.json
  package-lock.json

  src/
    app.js
    context.js
    db.js
    state.js
    middleware/
    routes/
    services/
    utils/
```

### Backend 入口

- `server.js`: Node.js 启动入口。现在只负责创建 app、注册 routes、初始化数据库并监听端口。
- `config.js`: 集中管理环境变量、路径、外部 API URL、TTL、端口和 Python 路径。
- `package.json`: Node.js 依赖和启动脚本。
- `src/app.js`: Express app、静态页面服务、CORS、JSON middleware、request log 和 rate limit。
- `src/db.js`: PostgreSQL pool 和 SSL 连接配置。
- `src/state.js`: 运行期缓存和状态，例如 mobile location、source cache、camera fallback。
- `src/context.js`: 将 config、db、auth、services、utils 组合成 route modules 使用的 `ctx`。

说明：`server.js` 已从原来的大文件拆分为启动入口 + services/utils/middleware 结构，route 文件的业务接口保持原注册方式。

### Backend Middleware / Services / Utils

目录：

```text
backend/src/
  middleware/
    rateLimit.js

  services/
    auth.service.js
    cache.service.js
    data.service.js
    dataSource.service.js
    gemini.service.js
    mobile.service.js
    onemotoring.service.js
    payload.service.js
    python.service.js
    roadNetwork.service.js
    rss.service.js
    trafficCameras.service.js
    trafficIncidents.service.js
    weather.service.js

  utils/
    common.js
```

- `middleware/rateLimit.js`: API rate limit 和 client IP 识别。
- `services/auth.service.js`: 密码哈希、验证码邮件、Supabase Auth、Profile bootstrap、`requireAuth`、`requireAdmin`。
- `services/cache.service.js`: 通用 TTL cache。
- `services/data.service.js`: 数据相关 services 的统一聚合导出入口，保持 routes 的 `ctx` 接口稳定。
- `services/dataSource.service.js`: 通用远程文本/JSON 拉取和超时控制 helper。
- `services/onemotoring.service.js`: OneMotoring ERP/PGS KML、停车价格页面、ERP 本地价目表读取。
- `services/gemini.service.js`: Gemini text generation helper。
- `services/mobile.service.js`: Android mobile location payload helper。
- `services/payload.service.js`: Profile/settings/feedback/habit route payload 标准化和校验。
- `services/python.service.js`: FastAPI 调用、Python fallback 子进程调用。
- `services/roadNetwork.service.js`: 本地新加坡路网快照、Overpass fallback、路线规划友好错误信息。
- `services/rss.service.js`: RSS 新闻源解析和拉取。
- `services/trafficCameras.service.js`: data.gov.sg 实时摄像头、LTA signal、SPF red-light、OSM camera point 数据。
- `services/trafficIncidents.service.js`: LTA/data.gov.sg/mock incidents、事故标准化 fallback、事故与摄像头匹配 fallback。
- `services/weather.service.js`: weather endpoint 参数校验和 OpenWeather key 检查。
- `utils/common.js`: 时间、文本、数值、HTML decode、距离计算、incident area helper。

### Backend Routes

目录：`backend/src/routes/`

- `index.js`: 统一注册所有 route module，保持稳定注册顺序。
- `auth.routes.js`: 登录、登出、注册验证码、删除账号、Profile、Settings、车辆信息、会员升级、改名、改密码。
- `admin.routes.js`: Admin Users、用户反馈、feedback location、删除 feedback、Habit Routes、route alerts。
- `traffic.routes.js`: 交通摄像头、LTA incidents、traffic news、geocode、reverse geocode、ERP、PGS、安卓定位上传/读取/清理。
- `route.routes.js`: `/api/route-plan`、route events analyze/evaluate、road network bbox 接口。
- `weather.routes.js`: 当前天气、天气预报、AI weather advice、AI incident summary、weather impact prediction。
- `feedback.routes.js`: 兼容型接口，包括 recalculate、incident feedback list/save、incident predict proxy。
- `ml.routes.js`: `/api/ml/*` FastAPI proxy gatekeeper。
- `chat.routes.js`: FASTbot `/api/chat` 和 Gemini function declarations。
- `replay.routes.js`: `/api/replay/start`、`/api/replay/stop`，用于 admin replay recording。

已删除内容：

- Admin Simulation Controls 前端已删除。
- Admin Simulation 后端配置接口 `/api/admin/simulation-config` 已删除。
- `app_settings` / `simulation_config` 初始化逻辑已删除。

## Python / FastAPI

目录：

```text
python/
  api_server.py
  requirements-fastapi.txt

  compute/
    routing.py
    graph.py
    astar.py
    avoidance.py
    cameras.py
    incidents.py
    route_events.py
    geo.py
    incident_prediction.py

  ml/
    config.py
    incident_predictor.py
    traffic_predictor.py
    train_model.py

  data/
  models/
```

### Python 入口

- `api_server.py`: FastAPI 主入口。
- `requirements-fastapi.txt`: FastAPI/Python 依赖。

### Python Compute

- `compute/routing.py`: 路线规划 public entry 和 CLI op 分发。
- `compute/graph.py`: 路网图构建、最近节点、路线坐标、红绿灯统计、重规划图构建。
- `compute/astar.py`: A* 搜索实现。
- `compute/avoidance.py`: 事故/拥堵点避让惩罚和重规划。
- `compute/route_events.py`: 路线事件筛选、事件命中和路线评分。
- `compute/cameras.py`: 事故与摄像头匹配计算。
- `compute/incidents.py`: 事故标准化和影响范围/持续时间估算。
- `compute/geo.py`: 距离、坐标和数值转换通用函数。
- `compute/incident_prediction.py`: FastAPI 不可用时的 incident prediction CLI fallback。

### Python ML

- `ml/traffic_predictor.py`: 天气相关 traffic impact prediction。
- `ml/incident_predictor.py`: incident duration / class prediction 相关逻辑。
- `ml/train_model.py`: traffic model 训练脚本。
- `ml/config.py`: traffic model 数据和模型路径配置。

### FastAPI Endpoints

主要接口：

- `GET /health`
- `POST /compute/normalize-incidents`
- `POST /compute/enrich-incidents-with-cameras`
- `POST /compute/analyze-events-for-route`
- `POST /compute/evaluate-route-events`
- `POST /compute/plan-routes`
- `POST /compute/ml-traffic-impact`
- `GET /api/hotspots`
- `GET /api/map-hotspots`
- `GET /api/vms-landmarks`
- `GET /api/expressway-forecast`
- `GET /api/expressway-geometry`
- `POST /api/route-intel`
- `POST /api/habit-routes/analyze`
- `POST /api/habit-routes/historical`
- `POST /api/habit-routes/best-time`
- `POST /api/hijack-predict`
- `POST /api/incident-predict`
- `POST /api/ml/incident-predict`

## Data And Models

### `python/data/`

当前保留的重要数据：

- `sg-road-network-overpass.json`: 本地新加坡路网快照，Route Planner 优先使用。
- `LTATrafficSignalAspectGEOJSON.geojson`: LTA traffic signal 点位，用于红绿灯统计。
- `erp_rates_2026-03-23.json`: ERP price bands。
- `incident_api_mock.json`: admin mock incident source。
- `road_links.parquet`: expressway / link analytics 使用的 road links。
- `dashboard_hotspots.parquet`, `link_level_hotspots.parquet`: Dashboard / map hotspot analytics。
- `link_danger_lookup.parquet`, `link_station_mapping.parquet`: route intelligence / station matching。
- `vms_landmarks.parquet`, `traffic_landmarks.parquet`: expressway landmark / geometry 相关数据。
- `data/ml/traffic_data.csv`: traffic ML 训练数据。

### `python/models/`

当前保留模型：

- `traffic_model.pkl`
- `scaler.pkl`
- `label_encoder.pkl`
- `incident_classifier.pkl`
- `incident_regressor.pkl`
- `incident_label_encoder.pkl`

已删除/释放空间的大文件：

- `plan_model.parquet`
- `holiday_model.parquet`
- `link_neighbors_slim.parquet`
- `upstream_neighbors.json`
- `asc_specialist.json`
- `descent_specialist.json`
- `gatekeeper.json`
- `router.json`
- `traffic_xgb_model.json`

## Docs

当前 `docs/` 保留：

- `ANDROID_GPS_USAGE.md`: 安卓手机实时定位使用说明。
- `WINDOWS_DEPLOYMENT_GUIDE.md`: Windows 用户部署指南。
- `README_代码结构说明.md`: 当前文件，代码结构说明。

已删除旧说明：

- `摄像头实现指南.md`
- `README_一键使用说明.md`
- `A星寻路实现指南.md`
- `ROUTING_README.md`

## 当前运行链路

### Web App

```text
Browser
  -> http://localhost:3000/
  -> backend/server.js serves frontend/
```

### API

```text
Frontend JS
  -> Node.js /api/*
  -> Supabase / LTA / OneMap / OpenWeather / Gemini / FastAPI
```

### Route Planner

```text
Route Planner
  -> POST /api/route-plan
  -> Node.js loads local road network + signal points
  -> FastAPI /compute/plan-routes
  -> python/compute/routing.py
  -> python/compute/graph.py + astar.py + avoidance.py
  -> returns route options
```

### Live Android GPS

```text
Android mobile-location.html
  -> POST /api/mobile-location/update
  -> Node keeps latest mobile coordinates
  -> Route Planner reads /api/mobile-location/latest
```

### Weather / Alerts ML

```text
Weather / Alerts
  -> Node weather.routes.js
  -> OpenWeather / Gemini / FastAPI
  -> python/ml/traffic_predictor.py or frontend/ml-traffic-model.js
```

## 当前页面权限

- Home / About / Business Model: 未登录可访问。
- Dashboard / Map View / Route Planner / Weather / Alerts: 基础查看能力对未登录用户开放。
- Profile / Settings / feedback submission / Habit Routes 管理: 需要登录。
- Admin Users / admin feedback history / replay recording: 需要 admin 用户。

## 当前清理状态

- 前端空 placeholder 文件已删除。
- 后端空 service、空 app/auth/db、空 route placeholder 文件已删除。
- Admin Simulation 后端遗留已删除。
- 大型未引用数据/模型文件已删除，当前只保留 demo 运行需要的数据和模型。
