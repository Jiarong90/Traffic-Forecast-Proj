FROM node:20-bookworm-slim

# 安装 Python（供 Node.js 子进程调用 python/compute/routing.py）
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先拷贝依赖清单，利用 Docker 缓存加速构建
COPY backend/package.json backend/package-lock.json /app/backend/
WORKDIR /app/backend
RUN npm ci --omit=dev

# 再拷贝业务代码
WORKDIR /app
COPY backend /app/backend
COPY frontend /app/frontend
COPY python /app/python

ENV NODE_ENV=production
ENV PYTHON_BIN=python3

EXPOSE 3000

WORKDIR /app/backend
CMD ["npm", "start"]
