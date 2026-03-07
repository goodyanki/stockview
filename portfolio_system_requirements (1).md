# 项目设计需求总结

## 1. 项目目标

构建一个小型的个人资产可视化 Web 应用，采用 **前后端分离架构**：

- **前端** 部署在 **Cloudflare Pages**，负责展示资产数据、报表摘要与持仓浮盈浮亏。
- **后端** 部署在 **Microsoft Azure App Service**，负责对接券商接口、统一数据处理、计算与持久化。
- **数据库** 作为统一数据中心，保存来自不同券商的数据，并通过字段区分数据来源。

本项目当前主要整合两类数据源：

1. **盈透（Interactive Brokers, IBKR）的 Flex API**
   - 用于获取报表类数据。
   - Flex API 返回的数据中可直接获得持仓相关的 **未实现盈亏（Unrealized P/L）** 等字段。
   - 后端负责解析并入库。

2. **长桥（Longbridge）的 OpenAPI**
   - 不使用 OAuth 2.0 方案，优先采用更直接、简单的 OpenAPI 对接方式。
   - 用于直接获取当前持仓数据。
   - 同时通过 Quote / 行情接口获取对应证券的现价。
   - 后端根据持仓成本价与现价，自行计算浮盈浮亏。

最终目标是将不同来源的数据统一清洗、存储和展示，使前端能够以统一表格形式查看：

- IBKR Flex 报表信息
- 长桥当前持仓
- 长桥按现价计算的浮盈浮亏
- 不同券商数据的统一资产视图

---

## 2. 总体架构

### 2.1 部署架构

- **前端：Cloudflare Pages**
  - 负责页面渲染、表格展示、请求后端 API。
  - 不直接访问任何券商 API。

- **后端：Azure App Service**
  - 暴露 REST API 给前端调用。
  - 对接 IBKR Flex API 与 Longbridge OpenAPI。
  - 进行数据解析、统一建模、计算、入库。

- **数据库：统一关系型数据库**
  - 推荐 PostgreSQL。
  - 保存原始数据、标准化后的持仓数据、行情快照、报表解析结果。

### 2.2 数据流

#### IBKR Flex API 数据流
1. 后端调用 IBKR Flex API 拉取报表。
2. 后端解析 XML / 报表结构。
3. 提取持仓、成本、未实现盈亏、币种、时间等字段。
4. 将原始报表与解析结果保存至数据库。
5. 前端通过后端接口读取并展示。

#### Longbridge OpenAPI 数据流
1. 后端调用 Longbridge OpenAPI 获取当前持仓。
2. 后端从返回结果中提取代码、数量、成本价、币种等字段。
3. 后端再调用 Quote / 行情接口获取各个持仓证券当前价格。
4. 后端使用现价与成本价计算：
   - 未实现盈亏（Unrealized P/L）
   - 未实现收益率
   - 当前市值
5. 计算结果写入数据库并提供给前端展示。

---

## 3. 功能需求

### 3.1 IBKR Flex 报表模块

#### 功能目标
通过 IBKR Flex API 获取用户账户报表，并解析出可展示的结构化数据。

#### 输入来源
- IBKR Flex API 返回的报表内容。

#### 核心处理逻辑
- 拉取指定报表。
- 解析报表中的持仓与盈亏字段。
- 提取以下核心字段：
  - 账户标识
  - 证券代码 / Symbol
  - 持仓数量
  - 成本价 / 成本基础
  - 市值（若有）
  - 未实现盈亏（Unrealized Profit/Loss）
  - 币种
  - 报表日期 / 时间
- 保存原始报表内容，便于未来调试与追溯。
- 保存标准化结构，便于统一查询。

#### 输出结果
- 提供一个后端接口，用于前端展示 IBKR Flex 报表解析结果。

### 3.2 Longbridge 持仓模块

#### 功能目标
通过 Longbridge OpenAPI 获取当前持仓，并补充现价数据，生成带浮盈浮亏的持仓表。

#### 输入来源
- Longbridge OpenAPI 持仓接口
- Longbridge OpenAPI Quote / 行情接口

#### 核心处理逻辑
- 获取账户当前持仓。
- 提取以下字段：
  - 账户标识
  - 股票代码 / Symbol
  - 市场
  - 数量
  - 成本价
  - 币种
- 根据持仓证券代码批量请求行情接口，获取现价。
- 按如下逻辑计算：
  - `current_value = quantity * last_price`
  - `cost_value = quantity * avg_cost`
  - `unrealized_pnl = current_value - cost_value`
  - `unrealized_pnl_pct = (last_price - avg_cost) / avg_cost`
- 将结果标准化并入库。

#### 输出结果
- 提供一个后端接口，用于前端展示 Longbridge 当前持仓及其浮盈浮亏情况。

### 3.3 统一资产数据模块

#### 功能目标
将来自 IBKR Flex 与 Longbridge OpenAPI 的数据统一汇总到同一数据库模式中，通过字段明确区分数据来源。

#### 核心要求
- 每条持仓或报表记录必须具备 `broker_source` 字段。
- 示例值：
  - `IBKR_FLEX`
  - `LONGBRIDGE_OPENAPI`
- 前端可按来源过滤，也可统一展示。

#### 展示方式
前端至少提供两张表：

1. **IBKR Flex 报表表格**
   - 展示从 Flex API 解析出的报表记录。

2. **Longbridge 当前持仓表格**
   - 展示当前持仓、现价、成本价、未实现盈亏、收益率。

后续可扩展一个总览页面：
- 不同券商总市值汇总
- 总未实现盈亏汇总
- 按券商分类展示

---

## 4. 数据库设计要求

数据库需要作为统一数据中心，至少满足以下要求：

### 4.1 设计目标
- 保存原始接口返回数据，便于追踪与调试。
- 保存标准化后的持仓与报表数据，便于统一查询。
- 支持不同券商数据共存。
- 支持后续扩展新的券商来源。

### 4.2 建议核心表

#### brokers
用于定义券商来源。

建议字段：
- `id`
- `code`
- `name`

#### accounts
用于定义不同券商下的账户。

建议字段：
- `id`
- `broker_id`
- `account_no`
- `account_name`

#### raw_imports
用于保存原始接口返回内容。

建议字段：
- `id`
- `broker_source`
- `import_type`（如 `FLEX_REPORT`, `POSITION`, `QUOTE`）
- `raw_payload`
- `created_at`

#### positions
用于保存统一后的持仓数据。

建议字段：
- `id`
- `account_id`
- `broker_source`
- `symbol`
- `market`
- `quantity`
- `avg_cost`
- `last_price`
- `current_value`
- `cost_value`
- `unrealized_pnl`
- `unrealized_pnl_pct`
- `currency`
- `snapshot_time`

#### reports
用于保存 Flex 报表解析结果。

建议字段：
- `id`
- `account_id`
- `broker_source`
- `report_type`
- `report_date`
- `symbol`
- `quantity`
- `avg_cost`
- `market_value`
- `unrealized_pnl`
- `currency`
- `parsed_payload`
- `created_at`

---

## 5. 后端需求

### 5.1 技术角色
后端需要承担以下职责：

- 统一封装券商接口调用。
- 对原始数据进行解析和标准化。
- 计算 Longbridge 持仓浮盈浮亏。
- 写入数据库。
- 提供前端可消费的 API。

### 5.2 后端接口建议

建议至少提供以下 REST API：

#### 1. 获取 IBKR Flex 报表数据
- `GET /api/reports/ibkr`

返回内容：
- Flex 报表解析结果列表

#### 2. 手动触发 IBKR Flex 同步
- `POST /api/sync/ibkr-flex`

返回内容：
- 同步是否成功
- 导入记录数

#### 3. 获取 Longbridge 当前持仓
- `GET /api/positions/longbridge`

返回内容：
- 当前持仓列表
- 包含现价、成本价、未实现盈亏等

#### 4. 手动触发 Longbridge 同步
- `POST /api/sync/longbridge`

返回内容：
- 同步是否成功
- 更新记录数

#### 5. 获取统一资产视图
- `GET /api/portfolio/summary`

返回内容：
- 不同券商的汇总信息
- 总市值
- 总未实现盈亏

### 5.3 同步策略
建议支持两种模式：

1. **手动同步**
   - 用户点击按钮后触发。

2. **定时同步**
   - 后端按设定周期自动拉取数据。
   - 例如每 5 分钟同步一次 Longbridge 持仓与行情。
   - 每天或每次需要时同步一次 IBKR Flex 报表。

---

## 6. 前端需求

### 6.1 前端职责
前端主要负责展示，不负责任何券商 API 调用。

### 6.2 页面需求

#### 页面 1：IBKR Flex 报表页
展示字段可包括：
- Symbol
- Quantity
- Avg Cost
- Market Value
- Unrealized P/L
- Currency
- Report Date

#### 页面 2：Longbridge 持仓页
展示字段可包括：
- Symbol
- Market
- Quantity
- Avg Cost
- Last Price
- Current Value
- Unrealized P/L
- Unrealized P/L %
- Currency
- Snapshot Time

#### 页面 3：统一资产概览页（可选）
展示：
- 各券商市值汇总
- 各券商未实现盈亏汇总
- 总资产规模

### 6.3 前端基本要求
- 表格清晰可读。
- 支持数据刷新。
- 支持按券商来源筛选。
- 支持错误提示与空状态展示。

---

## 7. 非功能需求

### 7.1 安全性
- 券商 API 密钥、Token、Flex 配置等敏感信息必须只保存在后端环境变量中。
- 前端不可直接暴露任何券商认证信息。
- 后端需要对外接口进行基本访问保护。

### 7.2 可扩展性
- 数据表与服务层要能方便扩展新的券商来源。
- `broker_source` 字段必须作为统一数据源识别字段保留。

### 7.3 可维护性
- 原始数据与解析数据分开保存。
- 报表解析逻辑与行情计算逻辑分离。
- IBKR 与 Longbridge 的服务层分开封装，避免耦合。

### 7.4 可观测性
- 后端应记录同步日志。
- 同步失败时保留错误信息，便于排查。

---

## 8. 推荐项目结构（概念级）

```text
project/
├─ frontend/                      # Cloudflare Pages 前端
│  ├─ src/
│  │  ├─ pages/
│  │  ├─ components/
│  │  ├─ api/
│  │  └─ types/
│  └─ package.json
│
├─ backend/                       # Azure App Service 后端
│  ├─ src/
│  │  ├─ routes/
│  │  ├─ controllers/
│  │  ├─ services/
│  │  │  ├─ ibkrFlexService
│  │  │  ├─ longbridgeService
│  │  │  ├─ quoteService
│  │  │  └─ pnlService
│  │  ├─ repositories/
│  │  ├─ models/
│  │  ├─ jobs/
│  │  └─ config/
│  └─ package.json
│
└─ database/
   ├─ schema.sql
   └─ migrations/
```

---

## 9. 项目边界说明

本阶段项目重点是：

- 成功打通 **IBKR Flex API** 报表拉取与解析；
- 成功打通 **Longbridge OpenAPI** 持仓与行情查询；
- 建立统一数据库模型；
- 在前端展示报表与持仓浮盈浮亏。

本阶段暂不强调：

- 复杂交易功能
- 下单功能
- 多用户系统
- 复杂权限系统
- 高级图表分析功能

当前版本应优先实现一个 **可用、清晰、易扩展** 的资产查看与整合系统。

---

## 10. 最终需求总结

该项目是一个个人资产整合型小型 Web 应用，采用：

- **Cloudflare Pages** 作为前端部署平台；
- **Azure App Service** 作为后端部署平台；
- **统一数据库** 保存不同券商来源的数据。

其中：

- **IBKR Flex API** 负责提供报表类数据，并直接提供未实现盈亏等字段；
- **Longbridge OpenAPI** 负责提供当前持仓与行情数据，后端根据成本价和现价计算浮盈浮亏；
- 所有数据最终统一入库，并通过 `broker_source` 字段区分来源；
- 前端通过后端接口统一展示报表、持仓与盈亏结果。

这个设计适合作为一个结构清晰的 MVP，也为未来继续接入更多券商、增加历史净值曲线、做资产汇总分析打下基础。

