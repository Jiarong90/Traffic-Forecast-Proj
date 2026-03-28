# FYP Demo

当前项目主入口：

- `http://localhost:3000/ui2/`

## 1. 当前架构

1. 前端：[/Users/apple/Desktop/fyp_demo/UI 2](/Users/apple/Desktop/fyp_demo/UI%202)
2. 后端：[/Users/apple/Desktop/fyp_demo/camera1/server.js](/Users/apple/Desktop/fyp_demo/camera1/server.js)
3. Python 计算：[/Users/apple/Desktop/fyp_demo/camera1/py/compute_engine.py](/Users/apple/Desktop/fyp_demo/camera1/py/compute_engine.py)
4. 数据库与认证：
   - 数据库：Supabase PostgreSQL
   - 认证：Supabase Auth（`auth.users`，UUID）

## 2. 当前认证与数据库说明

当前版本已经不再使用旧的本地 `public.users` / `public.sessions` 登录体系。

现在统一使用：

1. `auth.users`
   - Supabase Auth 用户表
   - 用户主键为 `uuid`

2. `public.app_user_profiles`
   - 保存业务侧用户资料和角色
   - 例如 `name`、`role`

3. `public.app_user_settings`
   - 保存设置页中的公司地点、家庭地点、通勤时间、常用路线

4. `public.app_user_feedback_reports`
   - 保存用户反馈

5. `public.habit_routes`
   - 保存 Habit Routes

6. `public.saved_places`
   - 保存地点信息

7. `public.traffic_alerts`
   - 保存 Habit Routes 相关交通告警

8. `public.app_settings`
   - 保存系统级配置，例如模拟路线配置

9. `public.signup_verifications`
   - 保存邮箱验证码注册流程中的临时验证码数据

已经删除的旧表：

1. `public.users`
2. `public.sessions`
3. `public.user_settings`
4. `public.user_feedback_reports`
5. `public.habit_route_alert_dismissals`

## 3. 当前核心功能

1. 用户登录、注册、登出
2. 邮箱验证码注册流程
3. Dashboard 实时事故展示
4. Map View 实时摄像头与事故点展示
5. Route Planner 三策略路径规划
6. Habit Routes 保存、加载、删除、监控
7. Alerts 与路线告警
8. 用户反馈提交与管理员查看
9. 管理员用户列表与统计
10. 管理员模拟路线与模拟事故

## 4. 环境要求

1. Node.js >= 18
2. Python 3
3. 可访问的 Supabase 项目

## 5. `.env` 配置

编辑文件：

- [/Users/apple/Desktop/fyp_demo/camera1/.env](/Users/apple/Desktop/fyp_demo/camera1/.env)

当前需要的关键变量：

```env
PORT=3000
DATABASE_URL=postgresql://...
DATABASE_SSL=true

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

PYTHON_BIN=python3

MAIL_DEV_MODE=false
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=...

ONEMAP_API_KEY=...
LTA_ACCOUNT_KEY=...
OPENWEATHER_API_KEY=...
GEMINI_API_KEY=...
```

说明：

1. `DATABASE_URL`：当前连接的 Supabase PostgreSQL connection string
2. `SUPABASE_URL`：当前使用的 Supabase 项目地址
3. `SUPABASE_ANON_KEY`：用于后端调用 Supabase Auth 密码登录接口
4. `SUPABASE_SERVICE_ROLE_KEY`：用于后端创建/删除 Auth 用户，不能放前端，不能提交到 GitHub

## 6. 启动方式

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm install
npm start
```

启动后访问：

- `http://localhost:3000/ui2/`

如果 `3000` 端口被占用，先停止旧进程，再重新执行 `npm start`。

## 7. 当前关键接口

1. `POST /api/auth/login`
2. `POST /api/auth/signup/request-code`
3. `POST /api/auth/signup/verify-code`
4. `DELETE /api/auth/account`
5. `GET /api/user/settings`
6. `PUT /api/user/settings`
7. `PUT /api/user/name`
8. `PUT /api/user/password`
9. `GET /api/habit-routes`
10. `POST /api/habit-routes`
11. `PATCH /api/habit-routes/:id`
12. `DELETE /api/habit-routes/:id`
13. `GET /api/incidents`
14. `POST /api/route-plan`
15. `POST /api/feedback`
16. `GET /api/admin/users`
17. `GET /api/admin/feedback`

## 8. 当前登录体系说明

当前登录流程是：

1. 前端提交邮箱和密码到 `/api/auth/login`
2. 后端使用 Supabase Auth 进行密码登录
3. 后端返回 Supabase access token
4. 前端把 token 存在 `sessionStorage`
5. 后续请求通过 `Authorization: Bearer <token>` 调用后端接口
6. 后端使用该 token 向 Supabase Auth 查询当前用户身份

所以当前项目是：

- 前端不直接连 Supabase SDK 做登录
- 前端统一调用你自己的 Node.js API
- Node.js 再去对接 Supabase Auth 和 Supabase PostgreSQL

## 9. 常见问题

1. `Authentication failed`
   - 检查 `SUPABASE_URL`
   - 检查 `SUPABASE_ANON_KEY`
   - 检查 access token 是否有效

2. `Supabase Auth is not fully configured`
   - 检查 `.env` 是否同时配置了：
     - `SUPABASE_URL`
     - `SUPABASE_ANON_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY`

3. `PostgreSQL connected` 失败
   - 检查 `DATABASE_URL`
   - 检查 `DATABASE_SSL=true`

4. 注册验证码失败
   - 检查 SMTP 配置
   - 或将 `MAIL_DEV_MODE=true` 走开发模式

5. Python 路线规划失败
   - 检查 `PYTHON_BIN=python3`
   - 检查本机 Python 依赖

## 10. 相关文档

1. [/Users/apple/Desktop/fyp_demo/README_一键使用说明.md](/Users/apple/Desktop/fyp_demo/README_%E4%B8%80%E9%94%AE%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E.md)
2. [/Users/apple/Desktop/fyp_demo/README_代码结构说明.md](/Users/apple/Desktop/fyp_demo/README_%E4%BB%A3%E7%A0%81%E7%BB%93%E6%9E%84%E8%AF%B4%E6%98%8E.md)
3. [/Users/apple/Desktop/fyp_demo/camera1/docs/摄像头实现指南.md](/Users/apple/Desktop/fyp_demo/camera1/docs/%E6%91%84%E5%83%8F%E5%A4%B4%E5%AE%9E%E7%8E%B0%E6%8C%87%E5%8D%97.md)
4. [/Users/apple/Desktop/fyp_demo/camera1/docs/A星寻路实现指南.md](/Users/apple/Desktop/fyp_demo/camera1/docs/A%E6%98%9F%E5%AF%BB%E8%B7%AF%E5%AE%9E%E7%8E%B0%E6%8C%87%E5%8D%97.md)
5. [/Users/apple/Desktop/fyp_demo/camera1/docs/ROUTING_README.md](/Users/apple/Desktop/fyp_demo/camera1/docs/ROUTING_README.md)

## 11. GitHub 更新

```bash
cd /Users/apple/Desktop/fyp_demo
git status
git add .
git commit -m "your update message"
git push
```
