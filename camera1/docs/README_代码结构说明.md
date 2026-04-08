# README 代码结构说明

## 顶层结构

### [/Users/apple/Desktop/fyp_demo/UI 2](/Users/apple/Desktop/fyp_demo/UI%202)
前端界面。

主要文件：
- [index.html](/Users/apple/Desktop/fyp_demo/UI%202/index.html)
- [styles.css](/Users/apple/Desktop/fyp_demo/UI%202/styles.css)
- [script.js](/Users/apple/Desktop/fyp_demo/UI%202/script.js)
- [ml-traffic-model.js](/Users/apple/Desktop/fyp_demo/UI%202/ml-traffic-model.js)
- `assets/images/`

### [/Users/apple/Desktop/fyp_demo/camera1](/Users/apple/Desktop/fyp_demo/camera1)
主后端目录。

主要文件：
- [server.js](/Users/apple/Desktop/fyp_demo/camera1/server.js)
- [config.js](/Users/apple/Desktop/fyp_demo/camera1/config.js)
- [package.json](/Users/apple/Desktop/fyp_demo/camera1/package.json)
- [requirements-fastapi.txt](/Users/apple/Desktop/fyp_demo/camera1/requirements-fastapi.txt)

## Python 目录

### [/Users/apple/Desktop/fyp_demo/camera1/py](/Users/apple/Desktop/fyp_demo/camera1/py)

当前核心文件：
- [combined_api_server.py](/Users/apple/Desktop/fyp_demo/camera1/py/combined_api_server.py)
- [compute_engine.py](/Users/apple/Desktop/fyp_demo/camera1/py/compute_engine.py)
- [ml_traffic_predictor.py](/Users/apple/Desktop/fyp_demo/camera1/py/ml_traffic_predictor.py)
- [train_model.py](/Users/apple/Desktop/fyp_demo/camera1/py/train_model.py)
- [ml_config.py](/Users/apple/Desktop/fyp_demo/camera1/py/ml_config.py)

当前辅助目录：
- [/Users/apple/Desktop/fyp_demo/camera1/py/data](/Users/apple/Desktop/fyp_demo/camera1/py/data)
- [/Users/apple/Desktop/fyp_demo/camera1/py/model](/Users/apple/Desktop/fyp_demo/camera1/py/model)
- [/Users/apple/Desktop/fyp_demo/camera1/py/static](/Users/apple/Desktop/fyp_demo/camera1/py/static)

## 数据目录

### [/Users/apple/Desktop/fyp_demo/camera1/data](/Users/apple/Desktop/fyp_demo/camera1/data)

当前重要文件：
- [sg-road-network-overpass.json](/Users/apple/Desktop/fyp_demo/camera1/data/sg-road-network-overpass.json)
- [erp_rates_2026-03-23.json](/Users/apple/Desktop/fyp_demo/camera1/data/erp_rates_2026-03-23.json)

## 当前运行链路

### 页面链路

- 浏览器 -> `UI 2`
- 前端 -> Node `server.js`
- Node -> FastAPI `combined_api_server.py`
- Node / FastAPI -> Supabase / LTA / OneMap / data.gov / OpenWeather / OneMotoring / Gemini

### 认证链路

- 前端 -> Node
- Node -> Supabase Auth
- 用户资料和设置 -> `app_user_profiles` / `app_user_settings`

### 导航链路

- `Route Planner`
- `POST /api/route-plan`
- Node 准备请求
- FastAPI / Python 计算
- 返回三条路线
- 前端再做事件分析、费用展示、路线确认和实时跟踪

### Dashboard 分析链路

- `Expressway Outlook`
- `High-Risk Zones`
- 前端请求 Node
- Node 代理到 FastAPI combined service

## 当前页面

- Home
- About
- Dashboard
- Map View
- Route Planner
- Weather
- Habit Routes
- Alerts
- Alert Detail
- Profile
- Settings
- Admin Users

## 当前说明

- `FASTbot` 位于前端浮动聊天入口
- Android GPS 是一个单独的移动端定位页
- `start.sh` 是当前推荐启动入口
