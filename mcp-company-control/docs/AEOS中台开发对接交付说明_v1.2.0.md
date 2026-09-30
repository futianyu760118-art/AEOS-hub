# company-control MCP：AEOS 与 SPC 中台开发对接交付说明

> 交付版本：1.2.0  
> 对接范围：SPC 数据供给 API → company-control MCP → AEOS Hub  
> 权限边界：全部为 `READ_ONLY`；不创建、修改、关闭任何 SPC 业务单据  
> 交付对象：SPC 中台开发、接口测试、AEOS 开发

## 1. 本包用途与安全边界

此包是 AEOS 使用的中台只读适配器源码和联调契约。中台开发可据此核对已开放 API、HMAC 签名、请求参数、返回字段、错误语义及新增能力需求。

压缩包中不包含 `.env`、AppKey、AppSecret、Token、缓存、运行日志或业务数据。中台凭证仅由部署负责人通过安全渠道写入 AEOS 运行主机的 `.env`，不得提交代码库、发在群聊或写入接口文档。

运行时唯一规范包为 `mcp-company-control/`。请勿复制为 `mcp-company-control-v*` 并让 AEOS 同时加载多个版本，否则 Tool 契约和凭证来源会不明确。

## 2. 已实现链路

```text
SPC 数据供给 API
  └─ HMAC API Key / endpoint_code
       └─ company-control MCP（输入校验、脱敏、错误映射、Evidence）
            └─ AEOS Registry + McpAccessGateway（只读白名单）
                 └─ 管理者看板 / Attention / 经营事项 / Agent 分析
```

AEOS 会将每条业务事实关联为 `evidence_refs`。业务结论必须引用实际返回的 Evidence；数据过旧、分页未完成或上游不可用时，页面和 Agent 必须显示“数据置信度不足”，不得补造空数据、概率或处理结果。

## 3. HMAC 认证与请求规则

优先使用 SPC「数据供给」HMAC API Key：

```text
请求头：X-App-Key、X-Timestamp、X-Signature
时间戳：秒级 Unix 时间；SPC 建议允许 ±300 秒
待签名串：timestamp + app_key + endpoint_code + query_string
签名算法：HMAC-SHA256(app_secret)，hex 输出
```

`endpoint_code` 是 SPC 数据供给注册表代码，**不是 URL 路径**。查询参数必须以实际发送的编码和顺序参与签名。适配器不记录密钥，日志只写 stderr。

本地/容器建议使用中控 HTTPS 入口：

```text
CONTROL_PLATFORM_BASE_URL=https://spc.hengyou-soft.com/api/v1
```

若宿主机配置了 HTTP 代理，需为 `spc.hengyou-soft.com` 和 `150.158.13.110` 配置 `NO_PROXY/no_proxy`，避免代理影响中台请求。

## 4. 已对接 SPC API

以下路径均相对于 `CONTROL_PLATFORM_BASE_URL`。请确保 API Key 已勾选相应 endpoint code，并确认正式环境路径与代码保持一致。

| SPC 路径 | endpoint_code | AEOS MCP Tool | 用途 |
|---|---|---|---|
| `/common/ping` | `int:health.ping` | `get_system_health` | 健康检查 |
| `/external/orders/list` | `orders.list` | `orders_list`、`detail_orders_list` | 销售订单 / 订单风险兼容查询 |
| `/external/order-details/list` | `order_details.list` | `order_details_list` | 销售订单明细行 |
| `/external/boms/tree` | `boms.tree` | `bom_tree` | 多级 BOM |
| `/external/materials/list` | `materials.list` | `master_material_search` | 物料主数据 |
| `/external/suppliers/list` | `suppliers.list` | `master_supplier_get` | 供应商主数据 |
| `/external/material-kitting/results` | `kitting.results` | `material_kitting_results_list` | 齐套结果 |
| `/external/material-kitting/shortages` | `kitting.shortages` | `material_shortages_list` | 缺料明细 |
| `/external/material-kitting/demands` | `kitting.demands` | `material_kitting_demands_list` | 齐套需求对象 |
| `/external/inventory/availability` | `inventory.availability` | `inventory_availability_list` | 可用库存 |
| `/external/material-supplies/list` | `material.supplies` | `material_supplies_list` | 未来供给 |
| `/external/quality-issues/list` | `quality_issues.list` | `quality_issues_list` | 质量异常 |
| `/external/quality-trace/list` | `quality_trace.list` | `quality_trace` | 质量追溯 |
| `/external/production/work-orders/list` | `production.work_orders.list` | `production_work_orders_list` | OA 生产任务单快照 |
| `/external/production/operations/list` | `production.operations.list` | `production_operations_list` | 按销售订单锚定的工序进度 |
| `/external/production/order-links/list` | `production.order_links.list` | `production_order_links_list` | 工单与销售订单双源关联 |
| `/external/production/reports/list` | `production.reports.list` | `production_reports_list` | ERP 生产日报累计报工 |
| `/external/production/capacity/list` | `production.capacity.list` | `production_capacity_list` | 部门、排产段、日期维度的产能 |

## 5. MCP Tool 清单

### 5.1 订单与主数据

| Tool | 主要参数 | 说明 |
|---|---|---|
| `orders_list` | `keyword`、`customer_code`、`product_code`、交期范围、分页 | 新版订单列表；单页最多 200 |
| `order_details_list` | `order_no`、`product_code`、分页 | 订单明细行；单页最多 200 |
| `bom_tree` | `bom_id`、`demand_qty`、`flatten` | `bom_id` 必填；返回树或扁平节点 |
| `master_material_search` | `keyword`、分页 | 0.1.0 兼容；单页最多 100 |
| `master_supplier_get` | `supplier_code` | 精确编码匹配；不存在返回 `NOT_FOUND` |
| `detail_orders_list` | `customer`、`product_line`、`date_from/to`、分页 | 0.1.0 兼容；日期语义为合同交期 |

### 5.2 物料齐套与供给

| Tool | 主要参数 | 说明 |
|---|---|---|
| `material_kitting_results_list` | `demand_no`、`order_no`、`product_code`、分页 | 齐套状态、齐套率、预计齐套日期 |
| `material_shortages_list` | `demand_no`、`material_code`、关键件标识、分页 | 净缺口、预计可用日期、原因、责任部门 |
| `material_kitting_demands_list` | `order_no`、`customer_code`、`product_code`、分页 | 当前需求对象为销售订单行 |
| `inventory_availability_list` | `material_code`、`wh_code`、分页 | `available_qty = 现存 - 锁定` |
| `material_supplies_list` | `material_code`、`supply_type`、日期范围、分页 | 采购、委外、自制、调拨四类供给 |

### 5.3 质量与兼容能力

| Tool | 主要参数 | 说明 |
|---|---|---|
| `quality_issues_list` | `issue_no`、`order_no`、`product_code`、状态、日期范围、分页 | 质量异常；无数据源字段必须返回 `null` |
| `quality_trace` | `order_no` / `product_code` / `batch_no` 三选一、分页 | 追溯订单、产品、批次关联 |
| `catalog_metrics_list` | 分页 | 兼容保留；当前 SPC 未开放，返回不可用错误 |
| `metric_query` | `metric_code`、日期范围、粒度 | 兼容保留；日期跨度最多 92 天；当前不可用 |
| `get_system_health` | 无 | MCP、HMAC 与中台连通性自检 |

### 5.4 生产协同

| Tool | 主要参数 | 已确认的口径与限制 |
|---|---|---|
| `production_work_orders_list` | 工单、销售订单、产品、状态、车间、计划完工日期范围、分页 | 来源为 OA 生产任务单；`cancelled` 无来源；原始状态保留为 `status_raw` |
| `production_operations_list` | `order_no`（必填）、工序类型、状态、计划日期范围、分页 | SPC 工序无工单外键，必须按销售订单查询；工作中心、前置工序无来源时为 `null` |
| `production_order_links_list` | `work_order_no` / `order_no` 至少一项、关联来源、分页 | `production_task` 为订单级关联；`schedule_snapshot` 为订单行级排产快照且无工单号；禁止按产品推断关联 |
| `production_reports_list` | `work_order_no`（必填）、销售订单、报工日期范围、分页 | 来源为 ERP 生产日报累计口径；撤销、更正和版本无来源时为 `null` |
| `production_capacity_list` | 日期起止（均必填）、部门、排产段、分页 | 按部门、排产段、日期聚合；周日不排产为 0，缺排产基础条件为 `null` |

全部 Tool：严格拒绝未知参数、支持可选 `request_id`（最长 64）、声明 `readOnlyHint=true`、不包含写操作。

## 6. SPC 返回契约

SPC 业务接口建议统一返回：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [],
    "total": 0,
    "data_as_of": "2026-09-24T06:00:00Z",
    "data_confidence": "high",
    "stale": false
  }
}
```

列表必须使用 `items` 和 `total`；无记录时返回空数组，不能省略字段。`data_as_of` 是业务数据更新时间，不能用请求时间替代。`data_confidence` 仅允许 `high`、`medium`、`low`。`stale=true` 表示数据超过双方确认的新鲜度阈值。

每条记录需提供稳定业务主键，例如 `order_no`、`bom_id`、`material_code`、`supplier_code`、`issue_no`。齐套记录需能以 `demand_no + demand_line_no + allocation_run_id` 区分；供给记录需使用 `supply_type + supply_no + supply_line_no` 区分。

成功时 MCP 统一返回 `source`、`capability`、`read_only`、`generated_at`、`data_as_of`、`data_confidence`、`data`、`evidence_refs`，列表额外返回 `page`。Evidence URI 形式为：

```text
control-platform://{entity}/{stable_id}@{data_as_of}
```

## 7. 错误、时效与敏感字段

| SPC / 网络场景 | MCP 返回 | 处理要求 |
|---|---|---|
| 400 / 422 | `INVALID_ARGUMENT` | 参数错误，不重试 |
| 401 | `UNAUTHORIZED` | 检查 AppKey、AppSecret、时间戳、endpoint_code 授权 |
| 403 | `FORBIDDEN` | 检查 API Key 权限和 IP 白名单 |
| 404 | `NOT_FOUND` | 资源不存在；列表端点 404 不得转为空列表 |
| 429 | `RATE_LIMITED` | 有限重试一次 |
| 5xx | `UPSTREAM_UNAVAILABLE` | 有限重试一次 |
| 超时 | `UPSTREAM_TIMEOUT` | 有限重试一次 |
| `stale=true` | `STALE_DATA` 或齐套低置信度结果 | 页面标记“数据置信度不足” |

适配器递归脱敏 `phone`、`mobile`、`contact_phone`、`cost_price`、`unit_cost`、`id_card`、`bank_card`。中台如新增敏感字段，请通知 AEOS 扩充脱敏集合。

## 8. 中台开发需确认的事项

1. 对照第 4 节确认 18 个路径和 endpoint_code，给出最终接口注册表。
2. 为 AEOS API Key 授权全部 18 个 endpoint_code；确认调用主机 IP 白名单和时间戳容差。
3. 提供订单、齐套、库存供给、质量、生产工单、工序、关联、报工及产能字段字典、状态枚举、数量和日期口径。
4. 确认分页排序、`updated_after` 增量语义、删除/关闭记录表示和数据新鲜度阈值。
5. 提供一组脱敏联调数据，覆盖正常、空结果、无权限、限流、过期和关联缺失场景。
6. 明确质量和生产字段缺失时应返回 `null`；不要用 0、空字符串或默认状态伪造业务事实。

## 9. 生产协同中心：已实现契约与联调重点

生产协同的 5 个只读 Tool、SPC 路径及 endpoint_code 已进入适配器与 AEOS Registry。生产数据每次调用均强制校验真实 `data_as_of` 与 `data_confidence`：数据过期返回 `STALE_DATA`；缺失或非法时效字段返回 `UPSTREAM_UNAVAILABLE` 并明确“数据置信度不足”。

中台联调时请重点确认第 5.4 节的来源限制是否符合现网数据。特别是工序只能按 `order_no` 查询，订单关联具有双源差异，生产日报是累计口径，产能并非工作中心/班次维度。若这些来源口径变更，需同步更新字段契约和适配器，不能由 AEOS 推断补全。

### 2026-09-24 容器实测结果

AEOS Docker 容器通过 HTTPS、HMAC、MCP stdio 调用了全部 5 个生产 Tool，五个 HTTP 请求均返回 200。结果按 MCP 时效规则分类如下：

| Tool | 结果 | 中台需处理事项 |
|---|---|---|
| `production_work_orders_list` | 可用；返回高置信度、未过期数据 | 无 |
| `production_order_links_list` | 可用；本次筛选无匹配记录但元数据新鲜 | 无；空结果仍须保留 `data_as_of` 与 `data_confidence` |
| `production_operations_list` | HTTP 200，但缺少有效 `data_as_of` / `data_confidence`，MCP 返回 `UPSTREAM_UNAVAILABLE` | 即使空结果，也必须返回真实 `data_as_of` 和 `high` / `medium` / `low` 置信度 |
| `production_reports_list` | HTTP 200，但缺少有效 `data_as_of` / `data_confidence`，MCP 返回 `UPSTREAM_UNAVAILABLE` | 同上；不能以请求时间代替业务数据时间 |
| `production_capacity_list` | 返回过期数据，MCP 返回 `STALE_DATA` | 刷新产能数据或确认并调整双方约定的新鲜度阈值 |

上述三类非可用结果均是保护性降级：AEOS 不会把“无时效数据”当成零风险，也不会把过期产能当成当前产能。

## 10. 联调验收

中台与 AEOS 双方共同完成：

```text
1. HMAC /common/ping 返回 HTTP 200、code=0。
2. tools/list 返回 21 个 Tool，且均 readOnlyHint=true。
3. 订单、订单明细、BOM、物料、供应商各成功查询一次。
4. 齐套结果、缺料、需求、库存、供给五类数据可查询并含 Evidence。
5. 质量异常、质量追溯可查询；缺失质量字段保持 null。
6. 五个生产 Tool 均可查询；验证工序、关联、报工和产能的必填锚点与数据来源限制。
7. 401、403、404、429、5xx、超时、stale 的错误和降级语义正确。
8. 分页结果不遗漏 Evidence；超过读取上限时页面显示“部分数据”。
9. AEOS Docker 容器内经 Registry → Gateway → MCP → SPC 成功读取数据。
```

本包自测命令：

```bash
python scripts/test_company_control.py
```

该自测使用内置 Mock，验证协议、Schema、Evidence、脱敏和错误映射；真实联调仍以第 10 节的中台环境结果为准。

## 11. 文件定位

| 文件 | 作用 |
|---|---|
| `server.json` | Tool 元数据、版本和 READ_ONLY 声明 |
| `mcp_server/upstream_client.py` | 路径—endpoint_code、HMAC、超时、重试、错误映射 |
| `mcp_server/server.py` | MCP 服务与订单/BOM/健康 Tool 注册 |
| `mcp_server/kitting.py` | 齐套、缺料、库存、未来供给 Tool |
| `mcp_server/quality.py` | 质量异常、质量追溯 Tool |
| `mcp_server/legacy_compat.py` | 0.1.0 兼容 Tool |
| `mcp_server/contracts.py` | 标准信封、Evidence、脱敏 |
| `scripts/test_company_control.py` | 适配器回归测试 |
| `.env.example` | 无凭证配置模板 |
