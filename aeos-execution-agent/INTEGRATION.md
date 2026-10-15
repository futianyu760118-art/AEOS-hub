# 新系统接入说明

要把 AEOS 执行面智能体接入一个**新系统**（如 OA、ERP、MES、供应链），只需三步：

1. 配置 `.env`（连接 Hub 的地址/令牌/身份 + 本系统只读查询凭据）。
2. 写一个**本系统的查询适配器**（复用通用 `createHttpQueryAdapter`，只配鉴权/端点/响应映射）。
3. 声明本系统的**查询语义（`intent`）**，让 Hub 能用自然语言理解并渲染结果。

其余核心代码（`agent-core.js` 的 WS 反向连接/注册/心跳/派单/召回）一律不改。

## 两种集成方式

### 方式一：独立容器 / Sidecar（推荐）

业务系统 → 本地接口或内网 → AEOS Execution Agent 容器 → 主动 WSS 连接 AEOS Hub。

- 不侵入业务系统代码；不受业务系统语言限制；独立升级/回滚/故障隔离。
- 业务系统无需向 Hub 开放入站端口。

### 方式二：SDK / 模块嵌入

把 `src/agent-core.js` + `src/capabilities.js` 作为依赖嵌入，但须保证：

- 连接生命周期由宿主管理（`core.start()/core.stop()`）。
- 不污染宿主全局；不强制占用固定端口；不硬编码 Hub 配置。
- 嵌入模式与容器模式使用同一套协议和适配接口。

## 三步接入

### 1. 配置 `.env`

复制 `.env.example` 为 `.env`，填 `EXECUTION_WS_URL` / `EXECUTION_PLANE_TOKEN` / `EXECUTION_AGENT_ID` / `EXECUTION_SOURCE_SYSTEM` / `TARGET_QUERY_*`（本系统只读查询凭据）。

### 2. 写本系统的查询适配器

用通用适配器 `createHttpQueryAdapter` 配 `endpoints` / `auth` / `unwrap`：

```js
import { createHttpQueryAdapter } from './query-adapter.js';

export function createMyQueryAdapter({ baseUrl, token }) {
  return createHttpQueryAdapter({
    baseUrl,
    endpoints: { '/api/my/orders': 'my.orders', '/api/my/inventory': 'my.inventory' },
    auth: { type: 'bearer', token },   // hmac / bearer / none / 自定义 headers
    unwrap: (body) => body.data ?? body,
  });
}
```

> 参考实现：`src/adapters/company-control-query.js`（中台示例，换成自己的即可）。

### 3. 声明查询语义（intent）+ 注册能力

在 `src/main.js` 里 `registerCapability`，声明 `inputSchema`（派单输入结构）、`constraints: { readOnly: true }`（只读声明，必填）、`intent`（自然语言查询语义）：

```js
registerCapability({
  name: 'query_control_platform',
  description: '精确查询本系统只读业务数据',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string', enum: ['/api/my/orders', '/api/my/inventory'] }, params: { type: 'object' } },
    required: ['path'],
  },
  constraints: { readOnly: true },
  intent: {
    paths: [{
      path: '/api/my/orders',
      label: '订单',
      keywords: ['订单', 'order'],
      params: [{ name: 'order_no', label: '订单号' }, { name: 'status', label: '状态', enum: [{ value: 'paid', label: '已付款' }] }],
      output: { title: ['order_no'], fields: ['amount', 'customer', 'status'] },
    }],
  },
  handler: createMyQueryAdapter({ baseUrl: config.targetQueryBaseUrl, token: config.targetQueryToken }),
});
```

- `intent.paths[].label` / `keywords` 供自然语言识别；`params[].enum` 提供枚举中英映射；`output` 提供结果展示的标题/字段顺序。
- `constraints.readOnly` 必须为 `true`，否则 Hub 派单时拒绝（`WRITE_FORBIDDEN`）。
- 完整能力 schema 与 intent 格式见 `execution-plane-agent-contract.md`。

## 验收清单

- [ ] 启动后自动连接 Hub，Hub 能识别其来源系统与能力（含 `inputSchema`/`constraints`/`intent`）。
- [ ] Hub 能下发查询任务，返回结果；能下发推理任务（契约未定则保持占位「未接通」）。
- [ ] Hub 能召回任务，Agent 同步取消。
- [ ] Agent 或 Hub 重启后自动恢复连接。
- [ ] 一个系统故障不影响其他智能体。
- [ ] 不重新编译/修改 Hub 主体代码；不携带任何 Hub 前端、数据库或业务模块。
