# README 一键使用说明

这份说明只保留当前项目的最短启动流程。

## 推荐启动

在项目根目录执行：

```bash
cd /Users/apple/Desktop/fyp_demo
./start.sh
```

脚本会：
- 使用 `camera1/.venv`
- 启动 FastAPI
- 启动 Node
- 输出访问地址和日志位置

## 第一次运行前提

### 1. 安装 Node 依赖

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm install
```

### 2. 创建 Python 虚拟环境

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-fastapi.txt
```

### 3. 安装 macOS 下 XGBoost 需要的运行库

```bash
brew install libomp
```

### 4. 配置 `.env`

编辑：
- [/Users/apple/Desktop/fyp_demo/camera1/.env](/Users/apple/Desktop/fyp_demo/camera1/.env)

## 网站入口

- `http://localhost:3000/ui2/`

## 如果不用 `start.sh`

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

## 当前重要说明

- `Expressway Outlook` 和 `High-Risk Zones` 依赖 FastAPI combined service。
- 如果 FastAPI 没启动，这两块会报错，但主站其他部分可能仍能打开。
- 浏览器样式或脚本没更新时，强制刷新：
  - `Command + Shift + R`
