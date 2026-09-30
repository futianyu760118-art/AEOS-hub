# SPC 生产协同中心 Hub 接入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按现有订单、齐套、质量链路的模式，把 company-control 的生产工单、工序、订单关联、报工和产能能力接入 AEOS 看板、日问、Agent Squad、经营事项和 Evidence，并在完成只读/写入能力评审后部署到 Docker。

**Architecture:** 保留 `mcp-company-control` 作为唯一 SPC 适配器，Hub 通过 Registry 和只读 Gateway 调用 21 个 Tool。新增生产聚合层只负责解析结果、建立证据关联、标注时效和生成建议事项；不在 Hub 或 MCP 中创建、修改、关闭任何中台业务数据。

**Tech Stack:** TypeScript/Node.js、Python FastMCP、JSON Registry、Node test runner、Docker Compose。

**Spec:** `mcp-company-control/docs/AEOS中台开发对接交付说明_v1.2.0.md` 与 `docs/SPC生产协同中心链路开发交接文档_v1.0.md`。

## Global Constraints

- company-control 的 21 个 Tool 全部保持 `READ_ONLY`，结论必须引用实际 `evidence_refs`。
- `STALE_DATA`、`UPSTREAM_UNAVAILABLE`、缺失或非法时效字段必须标记“数据置信度不足”，不能转为空风险或零数据。
- 生产工序只能以 `order_no` 为锚点；订单关联双源差异、报工累计口径、产能维度限制必须保留在结果和提示中。
- 不把真实 `.env`、AppKey、AppSecret、Token、日志或业务数据写入镜像、源码包或文档。
- Docker 使用现有 `AEOS` 服务和只读挂载的 `.env`，不得删除持久卷或重置已有运行状态。

## Review Focus

- 空结果与有效时效：测试空列表仍保留 `data_as_of`、`data_confidence`、`evidence_refs`，且不被误判为无风险。
- 生产链路锚点：测试工单无 `order_no`、双源订单关联、工序必须传 `order_no` 的行为。
- 过期/低置信度数据：测试报工和产能的 `medium`/历史时间，以及 `STALE_DATA` 的看板降级。
- 证据归属：测试多条生产记录的 evidence 不串到其他订单或工单。
- CRUD 边界：测试生产能力只能读；任何未登记或写入工具都被 Gateway 拒绝。

### Task 1: 生产协同聚合与风险模型

**Files:**
- Create: `src/production-coordination.ts`
- Modify: `src/dashboard.ts`
- Test: `test/production-coordination.test.ts`
- Test: `test/dashboard.test.ts`

**Interfaces:**
- Consumes: `production_work_orders_list`、`production_operations_list`、`production_order_links_list`、`production_reports_list`、`production_capacity_list` 的标准 MCP envelope。
- Produces: 生产协同汇总，包含工单、工序、订单关联、报工、产能计数，`warnings`、`dataAsOf`、`confidence`、Evidence 数量和看板 `productionAssessment`。生产记录为空或低置信度时不会生成风险结论。

- [x] 完成生产 envelope 解析、时效/置信度保留、空结果降级和 Evidence 汇总测试。
- [x] 扩展 `buildDashboardSnapshot`，新增 `productionAssessment` 和生产域状态；生产空结果不转为零风险结论。

### Task 2: Hub Runtime、看板和经营事项接线

**Files:**
- Modify: `src/server.ts:809-910`
- Modify: `src/dashboard.ts`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Test: `test/dashboard.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ProductionSnapshot`；通过 `mcpAccessGateway.callReadOnly` 创建 5 个生产查询。
- Produces: 首页生产协同中心卡片、生产风险详情和面向中枢的只读提示；从生产风险创建 operating case 时携带正确的 entity/evidence。

- [x] Hub 看板查询工单、产能，并在取得首个工单锚点后查询工序、订单关联和报工。
- [x] 首页新增生产协同中心，展示数量、时效、置信度和工单 Evidence。
- [x] 生产来源已纳入经营事项类型校验，仍只生成建议和人工审批记录。

### Task 3: 日问与 Agent Squad

**Files:**
- Create: `scripts/ensure-production-agents.ts`
- Modify: `src/daily-questions.ts`
- Modify: `docker/entrypoint.sh`
- Test: `test/daily-questions.test.ts`
- Test: `test/agent-squad-store.test.ts`

**Interfaces:**
- Consumes: company-control 生产 Tool 名称和 Task 1 的置信度/Evidence 规则。
- Produces: 生产进度研判、工序阻塞分析、产能与报工证据 Agent；默认日问 `production-coordination`。

- [x] 已创建四类生产 Agent、完成幂等绑定并注册 Docker bootstrap。
- [x] 已加入默认 `production-coordination` 日问及只读边界测试。

### Task 4: 能力边界与 CRUD 评审

**Files:**
- Modify: `mcp/registry.json`
- Modify: `src/mcp-access-gateway.ts`
- Modify: `docs/mcp-package-governance.md`
- Create: `docs/SPC生产协同中心增删改查评审.md`
- Test: `test/mcp-access-gateway.test.ts`

**Interfaces:**
- Consumes: 21 个只读 Tool 的 Registry 元数据和 Gateway allowlist。
- Produces: 可审计的 CRUD 结论：当前仅开放查询（Read）；Create/Update/Delete 暂不开放，需中台提供正式写接口、审批人、幂等键、审计字段、回滚/撤销语义后单独立项。

- [x] 五类生产能力在 Registry/Gateway 中均为 `READ_ONLY`。
- [x] 已新增 `docs/SPC生产协同中心增删改查评审.md`，明确暂不开放业务 C/U/D 及未来准入条件。

### Task 5: Docker、端到端联调与交付

**Files:**
- Modify: `docs/AEOS中台开发对接交付说明_v1.2.0.md`
- Create: `docs/superpowers/reports/2026-09-28-production-coordination-review.md`
- Create: `deliverables/company-control-mcp-v1.2.1-中台对接包.zip`

**Interfaces:**
- Consumes: Tasks 1–4 的实现和测试结果；现有 `.env` 仅作为只读挂载。
- Produces: Docker 中的完整生产协同链路、最终审查报告和不含凭证的对接包。

- [x] `npm test`、类型检查和 company-control 41 项自测通过。
- [x] Docker 重建完成，`AEOS` healthy、`aeos-init` exit 0，未删除持久卷。
- [x] 已完成生产端点和工单—订单关联—工序锚点的只读 smoke；生产端点返回空或历史数据时看板保留低置信度提示。
- [x] 已完成 CRUD 边界评审；本次未新增 SPC 业务写入。

## Self-Review

- Spec coverage: production MCP is already present; this plan covers the missing Hub consumers, UI, Agent/Daily Question, policy review, Docker and handoff.
- Type consistency: Task 1 owns `ProductionSnapshot`; Tasks 2–3 consume it through dashboard and prompt data, while Task 4 remains independent and read-only.
- Review focus: all five input classes are pinned to Tasks 1, 2, 3 and 4 tests.
- Proportion: each task ends in a focused test or deployment check; no write capability is invented without a middle-platform contract.
