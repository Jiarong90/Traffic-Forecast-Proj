# README 一键使用说明

这份说明面向第一次拿到项目的人，只说明最短可运行流程。

## 项目入口

启动成功后访问：

- `http://localhost:3000/ui2/`

## 一键前提

需要本机有：
- Node.js 18+
- Python 3

## 第一次运行

### 1. 安装 Node 依赖

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm install
```

### 2. 创建 Python 虚拟环境并安装依赖

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-fastapi.txt
```

### 3. 配置 `.env`

编辑：
- `camera1/.env`

至少需要配置数据库、Supabase、天气、LTA、OneMap 等 key。

### 4. 启动 FastAPI

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
source .venv/bin/activate
npm run start:fastapi
```

### 5. 启动 Node 后端

另开一个终端：

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm start
```

### 6. 打开网站

- `http://localhost:3000/ui2/`

## 后续再次使用

如果依赖已经装好，之后只需要：

### 终端 1

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
source .venv/bin/activate
npm run start:fastapi
```

### 终端 2

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm start
```

## 说明

- 如果只启动 `npm start` 而没有启动 FastAPI，部分计算功能会不完整或失败。
- 浏览器如果看不到最新样式或脚本，强制刷新：`Command + Shift + R`
