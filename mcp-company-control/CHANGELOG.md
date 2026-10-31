# Changelog

## 1.2.0 (2026-09-23)

- 新增 5 个生产协同类只读 Tool（对齐《SPC 生产协同中心链路开发交接文档 v1.0》§5/§6，P0+P1）：
  - `production_work_orders_list`（`/external/production/work-orders/list`，endpoint_code `production.work_orders.list`）：
    OA 生产任务单快照；状态映射 planned/released/in_progress/completed/unknown（cancelled 无来源），status_raw 保留源语义；
    evidence `control-platform://production-work-order/{work_order_id}@{data_as_of}`
  - `production_operations_list`（`/external/production/operations/list`，endpoint_code `production.operations.list`）：
    `order_no` 必填（SPC 工序进度无工单外键）；evidence `control-platform://production-operation/{operation_id}@{data_as_of}`
  - `production_order_links_list`（`/external/production/order-links/list`，endpoint_code `production.order_links.list`）：
    双源 production_task（订单级，line_no 恒 null）+ schedule_snapshot（行级，无工单号）；
    evidence `control-platform://production-order-link/{link_id}@{data_as_of}`
  - `production_reports_list`（`/external/production/reports/list`，endpoint_code `production.reports.list`）：
    ERP 生产日报累计口径；`work_order_no` 必填；撤销/更正无来源恒 null；
    evidence `control-platform://production-report/{report_id}@{data_as_of}`
  - `production_capacity_list`（`/external/production/capacity/list`，endpoint_code `production.capacity.list`）：
    按（部门, 排产段, 日期）聚合；date_start/date_end 必填；周日不排产 available=0、缺基础条件为 null；
    evidence `control-platform://production-capacity/{work_center_code}/{capacity_date}@{data_as_of}`
- 时效强制校验（交接文档 §7）：调用公共 helper 前校验真实 `data_as_of` / 置信度；
  `stale=true` → `STALE_DATA`；缺失/非法 → `UPSTREAM_UNAVAILABLE`「数据置信度不足」，
  不落入公共 helper 默认兜底（缺失时间→当前时间 / 未知置信度→high）
- 与交接文档建议契约的已确认偏差（SPC 数据现实）：工序锚点为 order_no；关联关系订单级；
  报工无撤销语义；产能无工作中心/班次维度（详见 README「已知限制」）
- SPC 侧配套：`backend/app/api/v1/external/endpoints/production_coordination.py` 5 个只读端点
  （无表结构变更、无迁移；授权走数据供给 API Key 勾选 5 个 endpoint code）
- 测试脚本扩展至 41 项（新增 7 项：生产工单/工序锚点/双源关联/报工锚点/产能窗口/
  缺时效降级/过期映射）

## 1.1.0 (2026-09-23)

- 新增 2 个质量类只读 Tool（对齐 AEOS 异常与质量中心交付说明 §7）：
  - `quality_issues_list`（`/external/quality-issues/list`，endpoint_code `quality_issues.list`）：
    质量异常查询；无数据源字段（severity/inspection_result/batch_no/supplier_code/material_code/line_no/blocking/issue_type）原样返回 null；
    evidence `control-platform://quality-issue/{issue_no}@{data_as_of}`
  - `quality_trace`（`/external/quality-trace/list`，endpoint_code `quality_trace.list`）：
    order_no/product_code/batch_no 三选一；扁平节点（quality_issue/order_line/bom）；
    evidence `control-platform://quality-trace/{object_type}/{object_id}@{data_as_of}`
- 上游 `stale=true` 统一转 `STALE_DATA`（retryable，交付说明 §11.9）；`supplier_code` 参数不暴露（SPC 侧 422）
- 测试脚本扩展至 34 项（新增 4 项：质量列表链路 / 追溯节点 evidence / 缺锚点校验 / 过期映射）

## 0.2.0 (2026-09-21)

- **工具集（9 个只读 Tool）= 4 个新版 + 5 个 0.1.0 兼容**：
  - 新版：`orders_list`（`/external/orders/list`）、`order_details_list`（`/external/order-details/list`）、
    `bom_tree`（`/external/boms/tree`）、`get_system_health`（`/common/ping`）
  - 0.1.0 兼容：`detail_orders_list`（适配到订单表头端点，参数映射 + `amount_cny`/`due_date` 别名）、
    `master_material_search`（`/external/materials/list`）、`master_supplier_get`（`/external/suppliers/list`）、
    `catalog_metrics_list` / `metric_query`（SPC 指标端点未开放 → 结构化 `UPSTREAM_UNAVAILABLE`，`retryable=false`）
- 兼容层新增模块：`tool_helpers.py`（公共错误信封/校验/列表返回）、`orders.py`（订单共享查询与别名）、
  `legacy_compat.py`（兼容工具注册）；旧分页上限保持 100，新版上限 200
- 健康检查修正（兼容方案 §8）：成功含 `control-platform://health/ping@<ts>` evidence；
  上游不可用时 `data_confidence=low` 且无证据；`checked_at`/`data_as_of`/evidence 使用同一时间戳
- 新增 streamable-http 传输（`--transport streamable-http`，CLI 参数优先于 `MCP_TRANSPORT`），与 stdio 并存；
  HTTP 模式强制静态 Bearer Token（`MCP_HTTP_TOKEN`，未配置拒绝启动），默认监听 `127.0.0.1:8902`
- 新增物料/供应商端点映射：`materials.list`、`suppliers.list`（API Key 需勾选）
- 测试脚本扩展至 24 项：stdio 20 项（含 0.1.0 契约回归、能力未开放错误、参数/字段映射、健康检查置信度）
  + HTTP 4 项（401 / 握手 / 缺 token 拒绝启动）

## 0.1.0 (2026-09-20)

- 初始骨架：FastMCP stdio Server + 6 个只读 Tool（health / 指标目录 / 指标查询 / 物料检索 / 供应商 / 订单明细）
- 标准返回包、Evidence URI、结构化错误、超时与受限重试、敏感字段脱敏
- 独立测试脚本覆盖 AEOS MCP Integration Spec §20 十二条
- 合规补强（规范审计后）：`serverInfo.version`、`dimension` 枚举、拒绝未定义字段（`extra=forbid`，`additionalProperties:false`）、Tool `readOnlyHint` 标注、`server.json` 元数据（§5/§7/§10/§15）
- `get_system_health` 返回规范 §16 顶层字段超集；数据类 Tool 支持 `request_id` 透传（§14）；上游 `stale` 标记返回 `STALE_DATA`（§12）
- SPC 生产对接：新增「数据供给」HMAC API Key 认证（`X-App-Key`/`X-Timestamp`/`X-Signature`，签名串 `timestamp+app_key+endpoint_code+query_string`），优先级 APP_KEY/SECRET > TOKEN > client_credentials；自动拆 SPC `{code,message,data}` 信封；`get_system_health` 对接现网 `int:health.ping`（`/common/ping`）；真实 `.env`（生产地址）就位
