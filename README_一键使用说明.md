# FYP Demo 一键使用说明（给其他人）

这份文档只讲“下载后本地一键跑起来”，不需要上线到公网。

## 1. 前置条件

对方电脑需要：

1. 安装 Docker Desktop（Mac/Windows）或 Docker Engine（Linux）
2. 终端可以执行 `docker compose`

可先自检：

```bash
docker --version
docker compose version
```

## 2. 一键启动

### 2.1 下载项目

```bash
git clone https://github.com/Bogda-Yang/fyp_demo.git
cd fyp_demo
```

### 2.2 直接启动

```bash
docker compose up --build
```

第一次会拉镜像并构建，时间会稍久。

## 3. 访问地址

启动成功后打开：

`http://localhost:3000/ui2/`

## 4. 停止服务

在当前终端按 `Ctrl + C`，或在新终端执行：

```bash
docker compose down
```

## 5. 常用命令

### 5.1 再次启动（不重建）

```bash
docker compose up
```

### 5.2 重建并启动（代码更新后建议）

```bash
docker compose up --build
```

### 5.3 清空数据库并重置（开发测试）

```bash
docker compose down -v
docker compose up --build
```

## 6. 常见问题

1. 端口占用（3000/5432）  
先关闭本机同端口服务，或改 `docker-compose.yml` 端口映射。

2. 启动失败提示 Docker 未运行  
先打开 Docker Desktop，再重试。

3. 页面打不开  
先看容器日志：

```bash
docker compose logs -f
```

## 7. 说明

1. 本项目是本地部署，不是公网部署。  
2. 其他人无法通过你的网址访问，只能在他们自己的电脑本地访问 `localhost`。  
3. 如需公网访问，再单独做云端部署（Render/Railway 等）。
