# FYP Demo 一键使用说明

这份文档给第一次接触项目的人使用，目标是尽快在本地跑起来。

## 1. 先说明当前版本的启动方式

当前项目包含两个后端进程：

1. Node.js 主后端
2. FastAPI 计算服务

所以当前推荐的本地运行方式不是只开一个进程，而是：

1. 启动 FastAPI
2. 启动 Node.js

## 2. 前置条件

本机需要：

1. Node.js 18+
2. Python 3
3. 一个可用的 Supabase 项目
4. 已配置好的 `.env`

## 3. 第一次使用

### 3.1 进入目录

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
```

### 3.2 安装 Node 依赖

```bash
npm install
```

### 3.3 创建 Python 虚拟环境

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-fastapi.txt
```

### 3.4 配置 `.env`

至少要保证这些变量存在：

```env
DATABASE_URL=postgresql://...
DATABASE_SSL=true
SUPABASE_URL=https://...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
PYTHON_BIN=python3
FASTAPI_BASE_URL=http://127.0.0.1:8000
```

## 4. 正常启动

### 4.1 启动 FastAPI

终端 1：

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
source .venv/bin/activate
npm run start:fastapi
```

### 4.2 启动 Node.js

终端 2：

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm start
```

### 4.3 打开页面

- `http://localhost:3000/ui2/`

## 5. 如果你只想用一个终端

可以这样启动：

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
source .venv/bin/activate
npm run start:fastapi > fastapi.log 2>&1 &
npm start
```

说明：

1. FastAPI 会在后台运行
2. Node.js 会在前台运行
3. 页面访问地址仍然是 `http://localhost:3000/ui2/`

## 6. 以后再次打开项目

第一次把 `.venv` 和依赖装好后，以后不需要重复安装。

### 6.1 如果你关掉了终端再重新打开

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

### 6.2 如果只是按了 `Ctrl + C`

如果还在同一个终端里：

1. 一般不需要重新安装依赖
2. 一般也不需要重新创建 `.venv`
3. 直接重新运行启动命令即可

## 7. 如何判断服务是否已运行

### 7.1 检查 FastAPI

打开：

- `http://127.0.0.1:8000/health`

如果返回：

```json
{"ok":true}
```

说明 FastAPI 正常运行。

### 7.2 检查前端主站

打开：

- `http://localhost:3000/ui2/`

如果页面能打开，说明 Node.js 正常运行。

## 8. 常见问题

### 8.1 `EADDRINUSE: address already in use :::3000`

说明 `3000` 端口已经有旧进程在跑。

处理：

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
kill PID
```

然后再执行：

```bash
npm start
```

### 8.2 `joblib import failed`

说明 FastAPI 的 Python 依赖没装好。

执行：

```bash
source .venv/bin/activate
python -m pip install -r requirements-fastapi.txt
```

### 8.3 `numpy incompatible architecture`

说明全局 Python 环境的包架构不对。

不要继续修全局环境，直接使用项目自己的 `.venv`。

### 8.4 FastAPI 没起来，但 Node.js 起来了

当前代码保留了回退机制：

1. Node.js 会优先调用 FastAPI
2. 如果 FastAPI 没启动，部分计算会回退到 Python 子进程

所以页面不一定完全挂掉，但推荐还是把 FastAPI 正常启动。

## 9. 当前项目不是公网访问

这是本地运行的 demo。

其他人要使用：

1. 必须把项目下载到他们自己的电脑
2. 在他们自己的电脑上按上面的步骤启动
3. 访问自己的 `localhost`
