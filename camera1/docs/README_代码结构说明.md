# README 代码结构说明

## 顶层结构

### `/Users/apple/Desktop/fyp_demo/UI 2`
前端界面。

主要文件：
- `index.html`: 页面结构
- `styles.css`: 全局样式
- `script.js`: 页面逻辑、交互、路由、地图、导航、About/Home 页面行为
- `ml-traffic-model.js`: 前端 ML 预测辅助模块（当前主要用于 Alerts 详情）
- `assets/`: logo、首页图片、成员图片等静态资源

### `/Users/apple/Desktop/fyp_demo/camera1`
主后端目录。

主要文件：
- `server.js`: Node.js 主服务
- `config.js`: 基础配置
- `package.json`: Node 启动脚本
- `requirements-fastapi.txt`: FastAPI 依赖

## Python 目录

### `/Users/apple/Desktop/fyp_demo/camera1/py`
Python 计算服务。

文件说明：
- `api_server.py`: FastAPI 入口
- `compute_engine.py`: 路径规划、事件分析、事故/摄像头匹配等核心计算
- `ml_traffic_predictor.py`: 交通影响预测
- `train_model.py`: ML 训练脚本
- `ml_config.py`: ML 配置
- `ml_models/`: 模型文件

## 数据目录

### `/Users/apple/Desktop/fyp_demo/camera1/data`
本地数据。

当前重要文件：
- `sg-road-network-overpass.json`: 本地新加坡路网快照，路径规划优先使用
- `LTATrafficSignalAspectGEOJSON.geojson`: 信号点位数据

## 当前运行链路

### 页面链路

- 浏览器访问 `http://localhost:3000/ui2/`
- Node.js 提供静态页面和业务接口
- Node.js 调 FastAPI 做计算型任务
- Node.js 访问 Supabase、天气、LTA、OneMap、新闻等外部数据源

### 认证链路

- 前端 -> `server.js`
- `server.js` -> Supabase Auth
- 用户信息使用 `auth.users` + `public.app_user_profiles`

### 路径规划链路

- 前端 `Route Planner`
- `POST /api/route-plan`
- Node.js 准备路网和输入参数
- FastAPI 调 `compute_engine.py`
- 返回三条策略路线

## 当前页面结构

主要页面：
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

- Home / About / Business Model 是公开页面
- Dashboard / Map View / Route Planner / Weather / Alerts 提供公开查看能力
- 登录后可用 Profile、Settings、反馈、Habit Routes 管理
- Admin 用户可用管理员界面和模拟功能
