# Portfolio System MVP

根据 `portfolio_system_requirements (1).md` 生成的前后端项目骨架：

- `frontend/`：静态前端（可部署到 Cloudflare Pages）
- `backend/`：Python FastAPI 后端（可部署到 Azure App Service）
- `database/schema.sql`：PostgreSQL 表结构参考

## 1. 后端启动

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

配置读取顺序：

1. 根目录 `.dev.vars`
2. `backend/.env`（可覆盖同名项）

## 2. 鉴权规则

`/api/*` 已启用后端鉴权。满足以下任一条件即可访问：

1. Basic Auth（用户名密码）
2. `X-API-Key`（仅当配置 `BACKEND_API_KEY` 时）

当 `.dev.vars` 配置了 `VIEW_USERNAME` 和 `VIEW_PASSWORD` 后，前端登录框填入对应值即可调用接口。

## 3. API 列表

- `GET /api/reports/ibkr`
- `POST /api/sync/ibkr-flex`
- `GET /api/positions/longbridge`
- `POST /api/sync/longbridge`
- `GET /api/portfolio/summary`

## 4. 前端启动

```bash
cd frontend
python -m http.server 8788
```

访问 `http://localhost:8788`，填写：

- Backend API（默认 `http://localhost:8000`）
- Username / Password（对应 `.dev.vars` 中 `VIEW_USERNAME` / `VIEW_PASSWORD`）

## 5. 关键环境变量

- IBKR:
  - `IBKR_FLEX_TOKEN`
  - `IBKR_FLEX_QUERY_ID`
  - `IBKR_USE_MOCK`
- Longbridge:
  - `LONGPORT_TOKEN` 或 `LONGBRIDGE_ACCESS_TOKEN`
  - `LONGPORT_APP_KEY`
  - `LONGPORT_APP_SECRET`
  - `LONGBRIDGE_POSITIONS_URL`
  - `LONGBRIDGE_QUOTES_URL`
- 鉴权:
  - `VIEW_USERNAME`
  - `VIEW_PASSWORD`
  - `BACKEND_API_KEY`（可选）

