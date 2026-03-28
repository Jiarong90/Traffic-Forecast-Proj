# FYP Demo 代码结构说明

本文档说明当前项目的实际结构、职责分工和运行链路。

## 1. 根目录结构

1. [/Users/apple/Desktop/fyp_demo/UI 2](/Users/apple/Desktop/fyp_demo/UI%202)
- 当前主前端

2. [/Users/apple/Desktop/fyp_demo/camera1](/Users/apple/Desktop/fyp_demo/camera1)
- 当前主后端
- Python 计算服务

3. [/Users/apple/Desktop/fyp_demo/README.md](/Users/apple/Desktop/fyp_demo/README.md)
- 总体说明

4. [/Users/apple/Desktop/fyp_demo/README_一键使用说明.md](/Users/apple/Desktop/fyp_demo/README_%E4%B8%80%E9%94%AE%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E.md)
- 给其他人的快速上手说明

5. [/Users/apple/Desktop/fyp_demo/README_代码结构说明.md](/Users/apple/Desktop/fyp_demo/README_%E4%BB%A3%E7%A0%81%E7%BB%93%E6%9E%84%E8%AF%B4%E6%98%8E.md)
- 当前文档

## 2. 当前实际架构

当前项目不是单一后端，而是三层：

1. 前端
- `UI 2/index.html`
- `UI 2/script.js`
- `UI 2/styles.css`

2. Node.js 主后端
- `camera1/server.js`
- 负责认证编排、数据库、外部 API 聚合、业务接口

3. Python 计算服务
- `camera1/py/api_server.py`
- `camera1/py/compute_engine.py`
- `camera1/py/ml_traffic_predictor.py`

## 3. 前端部分

### 3.1 主要文件

1. [/Users/apple/Desktop/fyp_demo/UI 2/index.html](/Users/apple/Desktop/fyp_demo/UI%202/index.html)
- 页面骨架
- 包含 Dashboard、Map View、Route Planner、Weather、Habit Routes、Alerts、Profile、Settings、Admin Users

2. [/Users/apple/Desktop/fyp_demo/UI 2/script.js](/Users/apple/Desktop/fyp_demo/UI%202/script.js)
- 前端主逻辑
- 登录/注册
- 页面切换
- 调用后端接口
- 地图与路线展示
- Alerts、反馈、管理员功能

3. [/Users/apple/Desktop/fyp_demo/UI 2/styles.css](/Users/apple/Desktop/fyp_demo/UI%202/styles.css)
- 所有页面样式

4. [/Users/apple/Desktop/fyp_demo/UI 2/ml-traffic-model.js](/Users/apple/Desktop/fyp_demo/UI%202/ml-traffic-model.js)
- 前端 ML 展示辅助逻辑

## 4. Node.js 后端部分

主要文件：

1. [/Users/apple/Desktop/fyp_demo/camera1/server.js](/Users/apple/Desktop/fyp_demo/camera1/server.js)

当前负责：

1. Supabase Auth 对接
2. 用户资料和角色读取
3. 用户设置、反馈、Habit Routes、Alerts 数据库接口
4. 摄像头、事故、天气、地理编码、新闻等 API 聚合
5. 调用 FastAPI 计算服务
6. FastAPI 不可用时回退到 Python 子进程

2. [/Users/apple/Desktop/fyp_demo/camera1/package.json](/Users/apple/Desktop/fyp_demo/camera1/package.json)
- Node 依赖
- 启动命令

3. [/Users/apple/Desktop/fyp_demo/camera1/.env](/Users/apple/Desktop/fyp_demo/camera1/.env)
- 当前运行配置

4. [/Users/apple/Desktop/fyp_demo/camera1/.env.example](/Users/apple/Desktop/fyp_demo/camera1/.env.example)
- 环境变量模板

## 5. Python / FastAPI 部分

### 5.1 主要文件

1. [/Users/apple/Desktop/fyp_demo/camera1/py/api_server.py](/Users/apple/Desktop/fyp_demo/camera1/py/api_server.py)
- FastAPI 服务入口

2. [/Users/apple/Desktop/fyp_demo/camera1/py/compute_engine.py](/Users/apple/Desktop/fyp_demo/camera1/py/compute_engine.py)
- 事故标准化
- 事故与摄像头匹配
- 路径规划
- 路线事件分析
- 路线事件评分

3. [/Users/apple/Desktop/fyp_demo/camera1/py/ml_traffic_predictor.py](/Users/apple/Desktop/fyp_demo/camera1/py/ml_traffic_predictor.py)
- 天气驱动的 ML 交通影响预测

4. [/Users/apple/Desktop/fyp_demo/camera1/py/train_model.py](/Users/apple/Desktop/fyp_demo/camera1/py/train_model.py)
- ML 模型训练脚本

5. [/Users/apple/Desktop/fyp_demo/camera1/py/ml_config.py](/Users/apple/Desktop/fyp_demo/camera1/py/ml_config.py)
- ML 配置

6. [/Users/apple/Desktop/fyp_demo/camera1/requirements-fastapi.txt](/Users/apple/Desktop/fyp_demo/camera1/requirements-fastapi.txt)
- FastAPI 与 ML 依赖

### 5.2 当前 FastAPI 负责的计算接口

1. `/compute/normalize-incidents`
2. `/compute/enrich-incidents-with-cameras`
3. `/compute/plan-routes`
4. `/compute/analyze-events-for-route`
5. `/compute/evaluate-route-events`
6. `/compute/ml-traffic-impact`

## 6. 数据库与认证

当前已经统一为 Supabase 方案。

### 6.1 认证

1. 认证主表：`auth.users`
2. 用户主键类型：`uuid`
3. 前端不直接使用 Supabase SDK 登录
4. 前端统一调用 Node.js `/api/auth/*`
5. Node.js 再调用 Supabase Auth

### 6.2 当前主要业务表

1. `public.app_user_profiles`
2. `public.app_user_settings`
3. `public.app_user_feedback_reports`
4. `public.habit_routes`
5. `public.saved_places`
6. `public.traffic_alerts`
7. `public.app_settings`
8. `public.signup_verifications`

## 7. 当前启动方式

### 7.1 推荐方式

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

访问：

- `http://localhost:3000/ui2/`

### 7.2 回退机制

如果 FastAPI 没启动：

1. Node.js 仍可运行
2. 算法接口会回退到 Python 子进程
3. 但推荐仍然启动 FastAPI，性能和结构更稳定

## 8. 现有主要接口分类

### 8.1 认证与用户

1. `POST /api/auth/login`
2. `POST /api/auth/signup/request-code`
3. `POST /api/auth/signup/verify-code`
4. `DELETE /api/auth/account`
5. `GET /api/user/settings`
6. `PUT /api/user/settings`
7. `PUT /api/user/name`
8. `PUT /api/user/password`

### 8.2 路由与计算

1. `POST /api/route-plan`
2. `POST /api/route-events/analyze`
3. `POST /api/route-events/evaluate`
4. `POST /api/ml/traffic-impact`

### 8.3 交通数据

1. `GET /api/cameras`
2. `GET /api/incidents`
3. `GET /api/geocode`
4. `GET /api/weather/current`
5. `GET /api/weather/forecast`
6. `GET /api/traffic-info-feed`

### 8.4 Habit Routes 与反馈

1. `GET /api/habit-routes`
2. `POST /api/habit-routes`
3. `PATCH /api/habit-routes/:id`
4. `DELETE /api/habit-routes/:id`
5. `GET /api/my-alerts`
6. `POST /api/my-alerts/dismiss`
7. `POST /api/feedback`
8. `GET /api/feedback/mine`
9. `GET /api/admin/feedback`

## 9. 当前已废弃的旧结构

以下旧本地认证表已删除，不再使用：

1. `public.users`
2. `public.sessions`
3. `public.user_settings`
4. `public.user_feedback_reports`
5. `public.habit_route_alert_dismissals`

旧的前端 Supabase SDK 登录残留也已删除。
