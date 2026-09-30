# SPC 生产协同中心链路开发交接文档

> 版本：V1.0 · 2026-09-23  
> 接入目标：SPC → company-control MCP → AEOS Hub → 管理者 / 中枢 Agent  
> 阶段：A1/A2，只读分析与协同建议  
> 状态：开发设计交接稿；生产专用端点、页面字段与业务口径待 SPC 确认  
> 中台入口：[SPC 中台](https://spc.hengyou-soft.com/dashboard)

## 1. 交付说明与核验范围

本稿沿用此前订单、物料齐套、异常与质量链路的交接方式，提供现状、目标链路、接口契约、字段、代码落点、验收、责任分工和上线回退要求，供 SPC、中台 MCP 和 AEOS 开发共同评审。

本次只新增文档，没有实现生产接口、修改业务数据或上线功能。访问上述中台入口后，浏览器标签地址为 `/login`；页面绑定读取超时，未取得生产协同中心菜单、列表、详情或接口响应。因此，本文的生产页面、端点名称和字段均为**建议设计**，不能作为 SPC 已存在功能的证明。

本次未取得 company-control 业务工具的实时 `evidence_refs`，不输出实际产能、延期工单或订单金额结论。实时经营判断为“数据置信度不足”。代码引用只证明本地实现，不能代替业务 Evidence 或线上联调结果。

### 1.1 本次核验来源

| 来源 | 可证明内容 | 不能证明内容 |
|---|---|---|
| 当前 `mcp-company-control/server.json`、`mcp/registry.json` | 16 个只读 Tool 已在本地登记 | 所有生产端点实时可用 |
| `mcp-company-control/mcp_server/upstream_client.py` | 13 个路径映射、HMAC、超时和重试实现 | SPC 当前授权及网络状态 |
| `mcp-company-control/mcp_server/kitting.py`、`quality.py` | 齐套、质量适配已实现 | 工单级齐套、质量放行具备完整数据 |
| `src/server.ts`、`src/dashboard.ts` | 看板已接订单、齐套、缺料、质量查询 | 生产协同中心已完成接入 |
| 浏览器标签状态 | dashboard 请求后标签位于 login | 生产中心具体功能和字段 |

历史文档里的 `mcp-company-control-v0.2/` 不再作为开发目录。本稿以唯一规范目录 `mcp-company-control/` 为准，遵循 `docs/mcp-package-governance.md`。

## 2. 业务目标与边界

生产协同中心应回答：哪些生产任务未按计划启动或完成、停在哪道工序、受什么缺料或质量问题影响、关联哪些订单、需要哪个角色何时确认动作。

目标业务链：

```text
销售订单 / 订单行
  → 生产需求与订单分配关系
  → 生产工单与计划版本
  → 物料齐套及开工前置条件
  → 工序计划 / 车间执行 / 有效报工
  → 质量检验及处置状态
  → 完工 / 入库事实
  → 订单交付影响
  → 责任角色与协同建议（人工确认）
```

上述链路是目标覆盖范围，具体数据来源由 SPC 确认。工单完工、工序报工、合格、入库和客户交付是不同业务事件，不可互相替代。

一期允许查询、聚合、解释风险和提出建议；不包含创建或下达工单、调整排程、派工、报工、领退料、质量放行、关闭异常、自动承诺交期或发送催办。AEOS 内分析任务状态也不代表 SPC 业务单据已处理。

## 3. 当前可复用能力与缺口

以下路径均为相对 `CONTROL_PLATFORM_BASE_URL` 的 API 路径；该配置不等于浏览器 `/dashboard` 地址。API 基址由部署负责人确认，不能根据前端域名猜测。

| 已登记 Tool | SPC 路径 | 本链路用途 |
|---|---|---|
| `get_system_health` | `/common/ping` | 验证连接，不能代替逐能力检查 |
| `orders_list` / `detail_orders_list` | `/external/orders/list` | 订单、合同交期及订单暴露金额 |
| `order_details_list` | `/external/order-details/list` | 订单行、产品、BOM 关联 |
| `bom_tree` | `/external/boms/tree` | 根据 `bom_id` 查询结构 |
| `master_material_search` | `/external/materials/list` | 物料主数据 |
| `master_supplier_get` | `/external/suppliers/list` | 供应商主数据 |
| `material_kitting_results_list` | `/external/material-kitting/results` | 齐套结果与计算批次 |
| `material_shortages_list` | `/external/material-kitting/shortages` | 净缺口与供给时间 |
| `material_kitting_demands_list` | `/external/material-kitting/demands` | 需求对象；现有说明为销售订单行 |
| `inventory_availability_list` | `/external/inventory/availability` | 可用库存参考 |
| `material_supplies_list` | `/external/material-supplies/list` | 未来供给参考 |
| `quality_issues_list` | `/external/quality-issues/list` | 质量异常 |
| `quality_trace` | `/external/quality-trace/list` | 订单、产品、批次追溯 |

`catalog_metrics_list`、`metric_query` 仅保留兼容契约，当前实现返回能力未开放，不能用于读取生产指标。

当前 Tool 清单没有工单、工序、报工或工作中心产能的专用能力。现有供给中的自制计划不能代替工单执行事实，销售订单行齐套不能直接解释成某张工单可开工。

质量接口缺失字段保留 `null`；现有 `quality_trace` 的锚点是 `order_no / product_code / batch_no`，不支持直接传 `work_order_no`。工单质量关联需新增正式关联键或先通过可靠的订单行关系追溯，不得按产品相同就判定阻塞。

## 4. 技术链路

```text
ERP / MES / SPC 生产业务数据（实际主责系统待确认）
        ↓ 只读视图及字段映射
SPC 数据供给 API（HMAC + endpoint code + 授权范围）
        ↓
company-control MCP
  输入校验 → 上游调用 → 字段校验 / 脱敏 → 时效 → Evidence
        ↓
AEOS Registry + McpAccessGateway
  白名单 → readOnlyHint → 超时 / 熔断 → 调用审计
        ↓
生产协同聚合服务（新增）
  工单 / 工序 / 订单关联 + 齐套 / 质量关联 + 完整性判断
        ↓
管理看板 / Attention / 每日经营问题 / 生产分析任务
        ↓
事项、依据、风险或缺口、建议动作、置信度、人工确认角色
```

扩展现有 company-control，不建立第二份带版本后缀的包。Hub 后台读取经 `McpAccessGateway`；Agent 侧工具清单与策略使用同一 Registry 约束。前端不持有 SPC 密钥、不直接调用 SPC。

## 5. 建议新增的 SPC / MCP 契约

**本节所有接口、endpoint code、Tool 名称均为待评审建议，尚未在本仓库实现，也未经上游验证。** 路径与 endpoint code 必须由 SPC 注册表最终确认，签名使用 code 而非 URL。

| 阶段 | 建议 MCP Tool | 建议 GET 路径 | 建议 endpoint code |
|---|---|---|---|
| P0 | `production_work_orders_list` | `/external/production/work-orders/list` | `production.work_orders.list` |
| P0 | `production_operations_list` | `/external/production/operations/list` | `production.operations.list` |
| P0 | `production_order_links_list` | `/external/production/order-links/list` | `production.order_links.list` |
| P1 | `production_reports_list` | `/external/production/reports/list` | `production.reports.list` |
| P1 | `production_capacity_list` | `/external/production/capacity/list` | `production.capacity.list` |

P0 实现工单、工序快照与订单追溯，支撑计划偏差分析；P1 有真实报工、工作日历及标准工时后再实现停滞分析和负荷判断。没有产能源时 P0 不能承诺能否按期完成。

### 5.1 查询参数

公共参数：`page`（从 1 开始）、`page_size`（建议默认 20、最大 200）、`request_id`（最长 64）、`updated_after`（带时区 ISO 8601，可选）。拒绝未知参数，日期起止顺序需校验，查询窗口上限由 SPC 与业务 Owner 定稿。

| Tool | 专用过滤与限制 |
|---|---|
| 工单列表 | `work_order_no`、`order_no`、`product_code`、`status`、`workshop_code`、`planned_end_start/end`；未带条件时使用受限分页，不隐式全库扫描 |
| 工序列表 | `work_order_no` 必填；可选 `operation_id`、`work_center_code`、`status` |
| 订单关联列表 | `work_order_no` 或 `order_no` 至少一个；可选 `order_line_id` |
| 报工列表 | `work_order_no` 必填；可选 `operation_id`、`reported_start/end`；报工撤销与更正也需可查 |
| 产能列表 | `work_center_code`、`date_start/end` 必填；包含日历和计划版本 |

`updated_after` 表示数据更新时间，不等于计划交期或报工发生时间。全量分页建议按稳定主键排序；增量按 `(updated_at, id)` 排序，采用重叠窗口及主键版本去重，避免同秒记录遗漏。删除/取消记录需墓碑或定期全量对账，不能让本地继续保留过时工单。

### 5.2 SPC 返回信封（建议，沿用现有风格）

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [],
    "total": 0,
    "data_as_of": "2026-09-23T02:00:00Z",
    "data_confidence": "high",
    "stale": false
  }
}
```

这是协议示意，不是本次查询结果。只有查询成功且覆盖范围完整时，空数组才表示该范围内无记录。`total` 为过滤后的总条数，不是当前页长度；部分结果不能冒充全量。多页快照一致性需通过 `snapshot_id` 等经评审的扩展实现，或明确声明无法保证一致性并降级置信度。

## 6. 建议数据字典与关联约束

下列必需字段指新契约的交付要求，并不声称上游现在具有这些字段。不可得的业务字段应返回 `null` 并说明缺失原因；稳定主键等结构必需项缺失时，数据不能进入可信聚合。

### 6.1 工单快照

| 字段 | 类型 | 语义 / 约束 |
|---|---|---|
| `work_order_id` / `work_order_no` | string | 稳定内部 ID / 展示单号；跨账套须加来源范围 |
| `source_system` / `org_code` | string | 来源和组织，参与复合唯一键 |
| `product_code` / `bom_id` / `bom_version` | string 或 null | 产品与实际生产 BOM 版本 |
| `planned_qty` / `uom` | decimal / string | 计划数量与单位；不混算不同单位 |
| `completed_qty` / `good_qty` / `scrap_qty` | decimal 或 null | 工单级有效累计；SPC 明确是否包含返工、撤销 |
| `received_qty` | decimal 或 null | 完工入库数量；不与报工完工混淆 |
| `status_raw` / `status` | string | 原始状态与确认后的标准状态 |
| `planned_start_at` / `planned_end_at` | datetime 或 null | 计划窗口，带时区 |
| `actual_start_at` / `actual_end_at` | datetime 或 null | 实际业务事件，不根据报表时间猜测 |
| `estimated_finish_at` | datetime 或 null | 上游预测；需同时给算法 / 版本 / 预测时间 |
| `schedule_version` | string 或 null | 排程版本；保留原计划与当前计划差异 |
| `workshop_code` / `owner_org` / `owner` | string 或 null | 车间、责任部门、责任人 |
| `blocking` / `blocking_reason` | boolean / string 或 null | 已确认阻塞事实；未知不补 false |
| `updated_at` | datetime | 源对象更新时间 |

建议标准状态：`planned / released / in_progress / paused / completed / cancelled / unknown`。由生产负责人签认映射表；保留 `status_raw`，未知值不按已完成处理。

### 6.2 工序快照

| 字段 | 语义 / 约束 |
|---|---|
| `operation_id`、`work_order_id`、`operation_seq` | 稳定工序 ID、工单外键、展示顺序；顺序号不能单独充当主键 |
| `operation_code/name`、`route_version` | 工序与工艺路线版本 |
| `predecessor_operation_ids` | 前置工序；允许并行、返工和分支，不能只按序号猜依赖 |
| `work_center_code` | 工作中心关联键 |
| `planned_qty/good_qty/scrap_qty`、`uom` | 本工序数量；跨工序不相加成工单完工量 |
| `planned_start_at/planned_end_at`、`actual_start_at/actual_end_at` | 计划与实际时间 |
| `status_raw/status`、`blocking_reason` | 状态映射与业务阻塞事实 |
| `last_reported_at`、`updated_at` | 最后有效报工时间与快照更新时间，分别提供 |

### 6.3 工单与销售订单行关系

关系表最小字段：`link_id`、`work_order_id`、`order_no`、`order_line_id`、`line_no`、`allocated_qty`、`uom`、`allocation_version`、`updated_at`。

一张工单可分配多个订单行，一个订单行可分多张工单。按关系表关联，禁止仅用产品编码、客户名称或工单号前缀匹配。若没有分配关系，显示“未关联订单”，保留工单自身风险。

数量分配需校验单位与分配版本；重复关联去重。受影响订单金额按订单主键去重，不能把同一订单金额按工序或工单重复累加。订单总额仅是暴露金额，不能视为实际损失；部分履约金额没有正式口径时不得按数量比例自行分摊。

### 6.4 报工与产能（P1）

报工字段：`report_id`、`work_order_id`、`operation_id`、`report_type`、`reported_qty`、`good_qty`、`scrap_qty`、`uom`、`reported_at`、`is_reversed`、`reversal_of`、`revision`、`updated_at`。明确增量记录与累计快照；同一报工重放不得重复计数，更正/撤销应抵消原记录且保留追溯关系。

产能字段：`work_center_code`、`capacity_date`、`shift_id`、`calendar_version`、`schedule_version`、`available_minutes`、`planned_load_minutes`、`downtime_minutes`、`updated_at`。统一单位与停机扣减口径。人员或设备数量不直接等于可用产能；缺少标准工时或工作日历时不计算负荷率。

### 6.5 与齐套、质量的关联

齐套按正式 `demand_type + demand_no + demand_line_no + allocation_run_id` 识别；先确认需求对象是否支持工单。现有销售行结果只能作为订单供给背景；工单级占用需由 SPC 交付映射与分配规则。不得将相同库存重复分配给多张工单，也不在 Hub 重新运行未经授权的分配算法。

质量异常优先使用工单或工序的显式关联。只有订单级质量事实时显示“关联订单存在质量异常，工单阻塞待确认”；未回传 `blocking` 或放行结果时，不输出“禁止开工”或“已允许流转”的事实判断。

## 7. MCP 返回、Evidence 与数据时效

每个新 Tool 同时声明 `permission_level=READ_ONLY`、Registry `readOnly=true` 和 MCP `annotations.readOnlyHint=true`，严格 Schema 拒绝未定义参数。

建议 Evidence 实体：`production-work-order`、`production-operation`、`production-order-link`、`production-report`、`production-capacity`。引用 ID 含来源、组织及稳定对象 ID，明确转义规则以避免 `/`、`@` 等造成歧义。

以下为**虚构的契约示例，禁止作为业务依据引用**：

```json
{
  "source": "company-control",
  "capability": "production_work_orders_list",
  "read_only": true,
  "generated_at": "2026-09-23T02:01:00Z",
  "data_as_of": "2026-09-23T02:00:00Z",
  "data_confidence": "high",
  "request_id": "example-production-001",
  "evidence_refs": [
    "control-platform://production-work-order/EXAMPLE-ORG/EXAMPLE-WO@2026-09-23T02:00:00Z"
  ],
  "data": [{"work_order_id": "EXAMPLE-WO", "work_order_no": "EXAMPLE-WO", "status": "in_progress"}],
  "page": {"page": 1, "page_size": 20, "total": 1, "truncated": false}
}
```

示例只展示信封，完整字段按第 6 节交付。跨域结论同时引用工单、订单、齐套或质量的实际 Evidence，不能只引用工单却声称已验证缺料原因。Hub 调用审计与 MCP 业务 Evidence 分别保留，不能互相替代。

当前公共 `list_result()` 最多返回 50 个 Evidence。生产查询一期建议 `page_size<=50`，确保需展示的记录能找到引用；若允许更大页，必须补充分页取证或设计行级引用，禁止返回 200 条后为未覆盖的记录编造引用。

当前 `as_of_confidence()` 对缺失时间/置信度有默认当前时间/高置信度的行为。新增生产适配必须在调用公共 helper 前校验真实 `data_as_of` 和合法置信度；缺失时返回结构化数据不可用错误并提示“数据置信度不足”，不可把请求时间作为业务刷新时间。若改公共 helper，必须单独评审并回归既有链路。

生产一期建议沿用质量链路：`stale=true` 返回 `STALE_DATA`；历史缓存可展示但带过期标识，不参与“正常”判定。现有齐套允许过期结果返回并降为 `low`，聚合需同时检查置信度、行级 `expired` 及各来源时间。新鲜度阈值与跨源最大时间差由业务 Owner 确认，不在文档中擅定已生效 SLA。

## 8. 风险识别与计算口径

| 事项 | 规则与所需事实 | 不能做的推断 |
|---|---|---|
| 计划未开工 | 计划开工时间已过且状态明确未开工、数据新鲜 | 缺实际开工字段就认定未开工 |
| 计划完工逾期 | 当前时间超过计划完成时间且非完成/取消 | 等同客户订单已延期 |
| 工序停滞 | 在制工序超过确认的无报工阈值，并排除非工作时段 | 仅按更新时间久就认定停工 |
| 齐套阻塞 | 同一需求分配版本明确存在净缺口且映射到工单 | 销售行缺料自动推为全部工单阻塞 |
| 质量影响 | 显式质量关联；阻塞需额外 `blocking=true` 等事实 | 所有未关闭问题都是停产原因 |
| 产能超载（P1） | 同工作中心、班次、版本的负荷超过可用分钟 | 按工单数量估算产能 |
| 交付风险 | 关联订单交期与可信预计完工、检验/入库/运输缓冲对比 | 工单完工晚一天即承诺订单晚一天 |

计算建议：

- 工单完成率 = 经业务确认的工单级有效完工数量 / 计划数量；分母缺失或为 0 时返回未知。超产保留原值并标记，不能静默截断掩盖问题。
- 工序累计不能跨工序相加得到工单数量；返工数量不能重复算成新增合格品。
- 计划逾期时长和预计延期时长分别展示，前者是事实比较，后者需要可靠预测来源。
- 负荷率 = 计划负荷分钟 / 可用分钟；可用分钟为 0 单独显示停产/无可用产能，不除零或补成 0%。
- 金额影响、概率和时效系数均有来源且口径批准后，按“金额影响 × 概率 × 时效”排序。缺概率时不把颜色映射成概率，改按确认的阻塞等级、交期紧迫性、去重暴露金额排序并说明是降级排序。

同一工单存在多个风险时保留多个原因，但对象计数去重。事实、规则推导与业务预测分别标识；每条推导保存规则版本、输入时间与 Evidence。

## 9. Hub 接入及页面交付

### 9.1 查询流程

1. 检查 Registry 与实时 Tool 清单，确认生产能力是否可用；health 成功不足以说明生产接口可用。
2. 分页读取限定窗口工单，记录覆盖范围、总数、数据时间和截断状态。
3. 按候选风险工单读取工序和订单关联，限制并发并设置总时间预算，避免无界 N+1 查询。
4. 复用订单、齐套、质量 Tool，遵守其真实输入 Schema，不传尚未支持的工单过滤字段。
5. 先做字段、关系、版本、时效校验，再计算风险；局部失败只降级对应来源。
6. 展示建议和证据；需要进一步分析时创建 AEOS 分析任务，不向 SPC 下发业务指令。

一期优先按需查询，避免新增无必要的数据复制。缓存键应包含组织/权限范围、过滤条件、页码与计划版本；缓存时长可配置并展示采集时间。达到分页/时间预算时标记“部分数据”，不得显示全厂完整风险总数。

### 9.2 建议界面

生产总览：查询范围、在制工单、未开工偏差、完工逾期、待确认阻塞、数据覆盖情况。卡片必须区分全量统计与当前页统计。

工单列表：单号、产品、数量/单位、车间、计划时间、实际状态、当前工序、关联订单、风险原因、责任部门、数据时间、Evidence。

工单详情：计划与实际对照、工序依赖、订单分配、齐套与质量证据、有效报工（P1）、建议动作。没有相关数据时显示对应缺口，不把缺口渲染为空风险。

状态至少区分：未接入、加载失败、数据过期、部分覆盖、成功但范围内无记录、成功且存在记录。页面具体位置与 SPC 菜单名称待登录后核验，不承诺本稿是现有页面复刻。

### 9.3 代码落点

以下是后续开发清单，本次未修改这些代码。

| 文件 / 模块 | 建议改造 |
|---|---|
| `mcp-company-control/mcp_server/production.py`（新增） | Tool Schema、参数/时间校验、Evidence、生产返回规范 |
| `mcp-company-control/mcp_server/upstream_client.py` | 正式路径与 endpoint code 映射，复用认证/重试 |
| `mcp-company-control/mcp_server/server.py` | 注册生产 Tool、更新 `EXPECTED_TOOLS` |
| `mcp-company-control/server.json`、`mcp/registry.json` | 同步元数据、版本和只读白名单 |
| `mcp-company-control/README.md`、`CHANGELOG.md` | 字段、授权、限制和兼容说明 |
| `mcp-company-control/scripts/test_company_control.py` | 新接口契约与旧 Tool 回归 |
| `src/production-coordination.ts`（新增） | 独立聚合与风险规则，避免继续扩张订单模型 |
| `src/server.ts` | Gateway 查询、缓存、隔离失败、生产分析任务分派 |
| `src/dashboard.ts`、`src/mcp-pagination.ts` | 生产视图接入及覆盖信息；复用前核对分页语义 |
| `public/app.js`、`public/index.html`、`public/style.css` | 生产视图、证据、缺口展示 |
| `src/daily-questions.ts` | 新增生产经营问题，并确认旧配置迁移行为 |
| `src/agent-squad-store.ts`（如采用小队） | 生产角色、归属和持久化迁移；不得只添加 UI 名称 |
| `AGENTS.md` | 新能力边界及只读 Evidence 要求 |
| `test/production-coordination.test.ts`（新增） | 数量口径、关联、规则、降级测试 |

当前任务分派 `taskType` 仅含 `order/kitting/quality`。若启用生产分析任务，应同步扩展服务端类型、成员资格校验、提示词、前端提交与持久化兼容，不允许未知生产任务落入订单默认分支。

## 10. 鉴权与错误处理

复用现有 HMAC 请求头 `X-App-Key`、`X-Timestamp`、`X-Signature`。签名材料为 `timestamp + app_key + endpoint_code + query_string`，使用 HMAC-SHA256。直接复用客户端的查询串构造逻辑，确保签名与实际发送的编码、顺序一致；不得另写一套猜测的排序算法。

SPC 管理员为部署用 Key 授权新增 endpoint code，确认组织数据范围与调用主机限制。凭证由部署环境注入，不放入文档、浏览器、代码或审计正文。沿用元数据与递归脱敏，并核验生产字段是否包含人员、成本等额外敏感内容。

| 场景 | 处理要求 |
|---|---|
| 400/422 | `INVALID_ARGUMENT`，给可修复字段，不重试 |
| 401/403 | `UNAUTHORIZED/FORBIDDEN`，提示认证/授权问题，不无限重试 |
| 404 | 现有映射为 `NOT_FOUND`；列表端点 404 属能力异常，不转空列表 |
| 已确认未开放 | 结构化 `UPSTREAM_UNAVAILABLE` 且 `retryable=false` |
| 超时、429、5xx | 复用有限重试与 Gateway 熔断；当前客户端最多首次加一次重试 |
| 返回结构不合规 | 显式失败或记录级隔离并标记不完整，不默认为成功空数组 |
| stale / 时效不明 | “数据置信度不足”，停止无风险判断 |
| 某来源失败 | 保留其他可用域，明确缺失来源和影响 |

请求 ID 支持追踪；现有标准错误信封不含 `request_id`，如要扩展需同步契约和测试，不能在验收中假定已支持错误回显。

## 11. 联调与验收用例

下列为开发完成后的验收要求，不是本次已运行结果。

| 用例 | 预期 |
|---|---|
| 已授权 Key 查询工单、工序、订单关系 | 数据、数量、状态、主键与 SPC 原始记录一致 |
| 缺少授权 / 签名 code 错误 | 明确错误，不返回空成功 |
| 未知字段、非法日期、反向区间、超大页 | Schema/参数校验拒绝 |
| 全部新 Tool | READ_ONLY、运行时 readOnlyHint、Registry 元数据一致 |
| 一工单多订单 / 一订单多工单 | 关系准确，数量不重复，暴露金额去重 |
| 并行工序与返工 | 不假设线性工艺，不重复计入完工 |
| 报工重复、撤销、更正（P1） | 幂等计算，保留追溯 |
| 零计划量、超产、单位不一致 | 未知或异常标识，不除零、不混单位 |
| 51 条以上记录与多页结果 | 每条被引用记录有有效 Evidence；完整性可见 |
| 多页间数据变动 / 相同更新时间增量 | 不漏记录；无法保证时明确降级 |
| 时间缺失、过期、不同源时间偏差 | 不补造高置信度；按来源降级 |
| 质量 blocking=null / 仅产品匹配 | 不自动认定工单被质量阻塞 |
| 订单行齐套但无工单分配 | 不自动判定工单可开工 |
| 单端点超时或返回 404 | 其他链路仍可用；生产显示不可用 |
| 成功空结果 vs 截断结果 | 分别显示无记录和部分覆盖 |
| 生产任务分派 | 生产角色校验生效；旧任务仍可读取 |
| 旧订单、齐套、质量查询 | 名称、参数、返回和只读边界兼容 |

建议验证命令：仓库根执行 `npm run check:types`、`npm run test:mcp-policy`、`npm run test:dashboard`、`npm run test:pagination`；在 `mcp-company-control/` 执行 `python scripts/test_company_control.py`。新增生产聚合测试须接入 `package.json` 后执行。所有命令使用项目已配置运行环境，不以 Mock 通过替代真实 SPC 联调。

验收记录应附：脱敏请求与响应、正式 endpoint code、字段映射表、状态枚举、至少一条正常及一条异常工单的完整证据链、测试结果、数据新鲜度规则、业务 Owner 核对意见。完成记录后才能将“待联调”改为“已验收”。

## 12. 实施步骤、责任与交接物

| 阶段 | 主责 | 交付物与完成条件 |
|---|---|---|
| D0 口径确认 | 生产计划负责人 + SPC | 页面字段、源表、状态、工单订单关系、数量口径、时效阈值签认 |
| D1 上游开发 | SPC 平台组 | P0 三个只读端点、正式 code、授权、脱敏样例、分页规则 |
| D2 MCP 适配 | MCP 开发 | 新 Tool、Evidence、元数据、错误与回归测试 |
| D3 Hub 接入 | AEOS 开发 | 聚合、看板、生产任务路由、缺口展示、配置迁移 |
| D4 联调验收 | 测试 + 生产/质量/物料 Owner | 真实工单核对、异常路径、人工确认边界 |
| D5 灰度与交接 | 运维 + 业务负责人 | 运行手册、监控、回退演练、验收批准 |

阶段为依赖顺序，不代表已承诺开发工期。上游字段不可用时先交付缺口说明，不能用模拟值通过生产验收。

需要 SPC 交接的材料：生产协同中心实际菜单及页面路由、数据源表与字段字典、接口与枚举清单、主键及多对多关系、数量/工时口径、权限范围、刷新任务和 SLA、错误样例、联调联系人。

需要 AEOS 交接的材料：代码变更与版本、Tool/Registry 对照表、测试报告、Evidence 示例、风险规则版本、部署配置项说明、数据源状态展示说明、回退步骤。材料不包含真实密钥。

## 13. 上线、监控与回退

上线建议：SPC 先发布并验证 P0 只读端点 → 授权部署 Key → 发布兼容 MCP 包 → 同步 Registry/元数据 → 核对 tools/list → 灰度开启生产视图 → 业务 Owner 对照真实工单验收 → 扩大使用范围。

建议监控调用成功率、耗时、认证失败、分页截断、数据年龄、缺失主键比例、未关联工单比例、Evidence 覆盖率和版本不一致。报警阈值及负责人由运维和业务共同确认。

回退优先关闭新增生产视图与任务入口，撤去生产 Tool 的调用依赖；如禁用 Tool，必须同时同步 Registry、MCP 元数据及运行实现，避免清单校验失败。需要版本回退时回退成套兼容版本，保留订单、齐套和质量能力及既有 Evidence。不得删除历史证据来消除错误记录。

## 14. Agent 结论模板与人工确认

```text
事项：<工单/工序及具体偏差>
依据：<本次 MCP 真实返回的 evidence_refs，多来源分别列出>
风险/缺口：<时间影响、金额口径、概率；缺失写未知>
建议动作：<建议责任角色、需核查内容、建议时间；注明审批角色>
置信度：高/中/低；<数据时效、关联完整性、字段缺失原因>
```

建议分级：P0 为已确认影响生产或交付且需立即核实的事项；P1 为近期计划偏差或阻塞待确认；P2 为字段、时效和关联缺口。此分级为建议规则，需业务负责人确认。调序/加班由生产计划负责人确认，供给调整由物料/采购负责人确认，质量处置与放行由品质负责人确认，金额与对外交期承诺由有权业务负责人确认。

本稿无实时工单 Evidence，不能填写实际业务 TOP 风险。下节列出的是开发交接关注项，按上线依赖排列；金额、概率均未知，无法执行经营风险乘积排序。

## 15. TOP 需人关注事项（最多 5 条）

| 事项 | 依据 | 风险 / 缺口 | 建议动作与确认角色 | 置信度 |
|---|---|---|---|---|
| 1. 确认生产数据端点 | 本地 Tool/路径映射未含生产专用能力；无业务 evidence_ref | 端点及授权未确认会阻塞联调；金额/概率未知 | SPC 负责人在 D1 前确认正式 API、code 与授权 | 高：本地缺口明确；线上状态待核验 |
| 2. 确认工单与订单行关系 | 现有订单能力不证明工单分配关系；无业务 evidence_ref | 可能关联错订单或重复金额；影响未量化 | 生产计划与 SPC 在 D0 签认稳定主键和分配规则 | 中：设计风险，待数据验证 |
| 3. 确认完工、报工及入库口径 | 第 6 节为建议字段；无业务 evidence_ref | 可能误报进度和交期 | 生产/MES Owner 在 D0 确认返工、撤销和数量口径 | 中：设计风险，需人工确认 |
| 4. 确认齐套与质量的工单级证据 | 当前齐套需求说明及 quality_trace Schema | 销售行背景不能证明工单可开工或质量放行 | 计划、物料、品质负责人在 D4 前核验关联；质量判断需人工确认 | 高：现有接口约束已核验；业务数据不足 |
| 5. 补齐真实时效与逐项 Evidence | 当前 helper 默认值与 50 条 Evidence 限制 | 新链路可能出现虚假新鲜度或缺引用 | MCP/AEOS 开发在 D2/D3 加校验与覆盖测试，由测试负责人验收 | 高：本地实现已核验 |

## 附录：本地实现定位

- [MCP 元数据](../mcp-company-control/server.json)、[Registry](../mcp/registry.json)
- [上游客户端](../mcp-company-control/mcp_server/upstream_client.py)、[公共返回 helper](../mcp-company-control/mcp_server/tool_helpers.py)、[标准契约](../mcp-company-control/mcp_server/contracts.py)
- [齐套适配](../mcp-company-control/mcp_server/kitting.py)、[质量适配](../mcp-company-control/mcp_server/quality.py)
- [Gateway](../src/mcp-access-gateway.ts)、[服务端](../src/server.ts)、[看板聚合](../src/dashboard.ts)
- [每日问题](../src/daily-questions.ts)、[分析小队存储](../src/agent-squad-store.ts)
- [包治理规则](mcp-package-governance.md)、[MCP 说明](../mcp-company-control/README.md)

这些引用为工程核验来源，不是 MCP 业务 `evidence_refs`。
