# company-control MCP 字段清单（订单 / 订单明细 / BOM 树）

- **服务**：company-control（AEOS MCP Server，只读）
- **版本**：0.2.0
- **数据来源**：SPC 对外接口（`/api/v1/external/*`，数据供给 HMAC API Key）
- **生成日期**：2026-09-22
- **适用工具**：`orders_list`、`order_details_list`、`bom_tree`、`detail_orders_list`（0.1.0 兼容）
- **内容范围**：第 1–4 节为 MCP 工具对外字段；**第 5 节为源表数据库全字段对照**（含未暴露字段，供使用方评估与提需求）

---

## 0. 通用约定

### 0.1 返回信封（所有工具统一）

| 字段 | 类型 | 说明 |
|---|---|---|
| `source` | string | 固定 `company-control` |
| `capability` | string | 工具名（如 `orders_list`） |
| `read_only` | boolean | 恒为 `true` |
| `generated_at` | string(datetime) | 响应生成时间（UTC，ISO 8601） |
| `data_confidence` | string | `high` / `medium` / `low`（上游数据新鲜度） |
| `data_as_of` | string(datetime) | 业务数据实际时间（UTC，ISO 8601） |
| `evidence_refs` | array[string] | 证据引用，格式 `control-platform://{entity}/{id}@{data_as_of}` |
| `data` | array \| object | 业务数据（见各工具字段表） |
| `page` | object | 仅列表类工具返回，见 0.2 |
| `request_id` | string | 调用方传入的 `request_id` 原样回显（可选） |

### 0.2 分页信封 `page`

| 字段 | 类型 | 说明 |
|---|---|---|
| `page` | integer | 当前页码 |
| `page_size` | integer | 每页条数 |
| `total` | integer | 总条数 |
| `truncated` | boolean | 是否还有下一页（`total > page × page_size`） |
| `next_cursor` | string | 有下一页时为下一页页码 |

### 0.3 错误信封

```json
{
  "source": "company-control",
  "error": {
    "code": "INVALID_ARGUMENT | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | UPSTREAM_TIMEOUT | UPSTREAM_UNAVAILABLE | RATE_LIMITED | STALE_DATA | INTERNAL_ERROR",
    "message": "错误说明",
    "retryable": false,
    "occurred_at": "2026-09-22T01:00:00Z"
  }
}
```

### 0.4 类型与空值约定

- `date`：字符串 `YYYY-MM-DD`；`datetime`：ISO 8601（UTC）
- `number`：JSON 数字；`integer`：JSON 整数；空值为 `null`
- 请求参数均可选（除注明必填外）；**不传即不过滤**（空字符串等价于不传）
- 多选过滤参数用**逗号分隔**（如 `status=open,closed`）

---

## 1. `orders_list` — 订单列表（订单表头行）

- 上游：`GET /api/v1/external/orders/list`（endpoint_code：`orders.list`）
- 每条记录 = 一个订单行（`order_no` + `line_no`）

### 1.1 请求参数

| 参数 | 类型 | 必填 | 默认 | 约束 | 说明 |
|---|---|---|---|---|---|
| `keyword` | string | 否 | `""` | ≤80 | 关键字：订单号 / 客户 / 产品名 模糊匹配 |
| `status` | string | 否 | `""` | ≤200 | 订单状态，逗号分隔多选（如 `open,closed`）；**无正式字典，取值以 SPC 为准** |
| `customer_code` | string | 否 | `""` | ≤80 | 客户编码精确匹配 |
| `risk_level` | string | 否 | `""` | ≤40 | 风险等级，逗号分隔多选（如 `red,yellow`） |
| `promised_date_start` | string(date) | 否 | `""` | YYYY-MM-DD | 合同交期范围起（含） |
| `promised_date_end` | string(date) | 否 | `""` | YYYY-MM-DD | 合同交期范围止（含） |
| `updated_after` | string(datetime) | 否 | `""` | ISO 8601 | 增量同步：仅返回 `updated_at` 不早于该时间的记录 |
| `page` | integer | 否 | `1` | ≥1 | 页码 |
| `page_size` | integer | 否 | `20` | 1–200 | 每页条数 |
| `request_id` | string | 否 | `""` | ≤64 | 审计/链路追踪，原样回显 |

### 1.2 返回 `data[]` 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | integer | 主键 |
| `order_no` | string | 订单号 |
| `line_no` | string | 订单行号 |
| `customer` | string | 客户名称 |
| `customer_code` | string | 客户编码 |
| `product_code` | string | 产品编码 |
| `product_name` | string | 产品名称 |
| `order_qty` | number | 订单数量 |
| `completed_qty` | number | 完工数量 |
| `order_amount` | number | 订单金额 |
| `status` | string | 订单状态（**派生值**）：`pending_review` 未审核 / `in_progress` 进行中 / `partially_closed` 部分关闭 / `completed` 已完成 / `cancelled` 已取消 |
| `erp_status` | integer | ERP 订单状态原始值（0 未审核 / 1 审核 / 2 部分关闭 / 3 已关闭） |
| `delivery_completed_date` | string(date) | 发货完成日期（`erp_status=3` 时用于区分已完成/已取消） |
| `risk_level` | string | 风险等级（`red`/`yellow`/`blue`/`green`） |
| `promised_date` | string(date) | 合同交期 |
| `planned_start_date` | string(date) | 计划开工日期 |
| `owner` | string | 负责人 |
| `updated_at` | string(datetime) | 最后更新时间（增量同步锚点） |

### 1.3 示例

请求参数：

```json
{"keyword": "示例客户", "promised_date_start": "2026-09-01", "promised_date_end": "2026-09-30", "page": 1, "page_size": 20}
```

返回（节选）：

```json
{
  "source": "company-control",
  "capability": "orders_list",
  "read_only": true,
  "data_confidence": "high",
  "data_as_of": "2026-09-22T01:00:00Z",
  "evidence_refs": ["control-platform://order/SO-2609-001@2026-09-22T01:00:00Z"],
  "data": [
    {
      "id": 1, "order_no": "SO-2609-001", "line_no": "1",
      "customer": "示例客户A", "customer_code": "C-001",
      "product_code": "P-100", "product_name": "商业照明灯",
      "order_qty": 100.0, "completed_qty": 10.0, "order_amount": 1280000.0,
      "status": "open", "risk_level": "red",
      "promised_date": "2026-09-20", "planned_start_date": "2026-09-10",
      "owner": "张三", "updated_at": "2026-09-19T10:00:00"
    }
  ],
  "page": {"page": 1, "page_size": 20, "total": 1, "truncated": false}
}
```

---

## 2. `order_details_list` — 订单明细列表

- 上游：`GET /api/v1/external/order-details/list`（endpoint_code：`order_details.list`）
- 每条记录 = 一个订单明细行（含 BOM 关联）

### 2.1 请求参数

| 参数 | 类型 | 必填 | 默认 | 约束 | 说明 |
|---|---|---|---|---|---|
| `order_no` | string | 否 | `""` | ≤80 | 订单号精确匹配（拉取某订单全部明细行） |
| `keyword` | string | 否 | `""` | ≤80 | 关键字：订单号 / 产品名 / 产品型号 模糊匹配 |
| `product_code` | string | 否 | `""` | ≤80 | 产品编码精确匹配 |
| `status` | string | 否 | `""` | ≤200 | 明细行状态，逗号分隔多选 |
| `bom_no` | string | 否 | `""` | ≤80 | BOM 编号精确匹配 |
| `promised_date_start` | string(date) | 否 | `""` | YYYY-MM-DD | 合同交期范围起（含） |
| `promised_date_end` | string(date) | 否 | `""` | YYYY-MM-DD | 合同交期范围止（含） |
| `updated_after` | string(datetime) | 否 | `""` | ISO 8601 | 增量同步锚点 |
| `page` | integer | 否 | `1` | ≥1 | 页码 |
| `page_size` | integer | 否 | `20` | 1–200 | 每页条数 |
| `request_id` | string | 否 | `""` | ≤64 | 审计/链路追踪，原样回显 |

### 2.2 返回 `data[]` 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | integer | 主键 |
| `sale_order_id` | integer | 所属订单 id（关联 `sale_order.id`） |
| `order_no` | string | 订单号 |
| `erp_line_id` | string | ERP 行 id |
| `line_no` | string | 订单行号 |
| `product_code` | string | 产品编码 |
| `product_name` | string | 产品名称 |
| `product_model` | string | 产品型号 |
| `order_qty` | number | 订单数量 |
| `order_amount` | number | 订单金额 |
| `promised_date` | string(date) | 合同交期 |
| `planned_start_date` | string(date) | 计划开工日期 |
| `batch_no` | string | 批次号 |
| `bom_no` | string | BOM 编号 |
| `bom_id` | integer | BOM id（可用于 `bom_tree` 查询） |
| `labor_price_amount` | number | 工价金额（按 BOM 汇总） |
| `status` | string | 明细行状态 |
| `customer` | string | 客户名称（取自订单头） |
| `customer_code` | string | 客户编码（取自订单头） |
| `created_at` | string(datetime) | 创建时间 |
| `updated_at` | string(datetime) | 最后更新时间 |

> 说明：`evidence_refs` 实体为 `order-detail`，格式 `control-platform://order-detail/{order_no}/{line_no}@{data_as_of}`。

---

## 3. `bom_tree` — BOM 多级树

- 上游：`GET /api/v1/external/boms/tree`（endpoint_code：`boms.tree`）
- 返回**已组装好的多级 BOM 树**（免去下游自行 BFS 拼装）
- 组装口径：层级靠 `material_id` 桥接（`BomDetail.material_id` → 反查子 BOM）；需求量纯连乘
  `req_qty(N) = standard_qty × demand_qty × Π(祖先 standard_qty)`；防环、限深 20 层

### 3.1 请求参数

| 参数 | 类型 | 必填 | 默认 | 约束 | 说明 |
|---|---|---|---|---|---|
| `bom_id` | string | **是** | — | 1–80 | 顶层 BOM ID |
| `demand_qty` | number | 否 | `null` | ≥0 | 根需求量；缺省取根 BOM 的 `base_qty`，再缺省取 `1` |
| `flatten` | boolean | 否 | `false` | — | `true` 返回扁平列表 `items`；`false` 返回嵌套树 `tree` |
| `request_id` | string | 否 | `""` | ≤64 | 审计/链路追踪，原样回显 |

### 3.2 返回 `data` 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `bom_id` | string | 顶层 BOM ID |
| `bom_no` | string | 顶层 BOM 编号 |
| `material_id` | integer | 顶层物料 id |
| `base_qty` | number | 根 BOM 基础用量 |
| `demand_qty` | number | 根需求量（实际使用的值） |
| `bom_version` | string | BOM 版本号 |
| `bom_type` | string | BOM 类型 |
| `flatten` | boolean | 是否扁平列表形态 |
| `total_nodes` | integer | 节点总数 |
| `max_level` | integer | 最大层级 |
| `message` | string | 未找到 BOM 时的提示（正常为 `null`） |
| `tree` | array[node] | 嵌套树（`flatten=false` 时返回；否则为 `null`） |
| `items` | array[node] | 扁平列表（`flatten=true` 时返回；否则为 `null`） |

### 3.3 节点字段（`tree[]` / `items[]` 元素）

| 字段 | 类型 | 说明 |
|---|---|---|
| `material_id` | string | 物料 id（引用 `scm_material.erp_material_id`） |
| `material_code` | string | 物料编码 |
| `material_name` | string | 物料名称 |
| `spec_model` | string | 规格型号 |
| `unit` | string | 计量单位 |
| `material_type` | string | 物料类型 |
| `material_property` | integer | 物料属性（常见：`1` 外购 / `2` 自制 / `3` 委外加工 / `5` 虚拟件 / `6` 特征类） |
| `line_no` | string | BOM 行号 |
| `standard_qty` | number | 标准用量（单件用量） |
| `aux_qty` | number | 辅助数量 |
| `config_type` | string | 配置类型 |
| `lead_offset_days` | integer | 前期偏移天数 |
| `back_flush` | integer | 是否倒冲（`0` 否 / `1` 是） |
| `scrap_rate` | number | 损耗率 |
| `oper_sn` | string | 工序号 |
| `process_id` | string | 工序 ID |
| `warehouse_id` | string | 仓库 ID |
| `valid_date` | string(date) | 生效日期 |
| `invalid_date` | string(date) | 失效日期 |
| `kit_flag` | integer | 套件标识（`0` 否 / `1` 是） |
| `req_qty` | number | **需求量**（沿树连乘结果） |
| `level` | integer | 层级（根的直接子件为 `1`） |
| `bom_id` | string | 该节点所属 BOM ID（扁平列表还原关系用） |
| `parent_material_id` | integer | 父物料 id（还原关系用） |
| `has_sub_bom` | boolean | 是否还有下级子 BOM |
| `children` | array[node] | 子节点（仅嵌套树形态；扁平列表无此字段） |

> 说明：`evidence_refs` 实体为 `bom`，格式 `control-platform://bom/{bom_id}@{data_as_of}`。

### 3.4 示例（嵌套）

```json
{"bom_id": "BOM-001", "flatten": false}
```

```json
{
  "source": "company-control",
  "capability": "bom_tree",
  "data": {
    "bom_id": "BOM-001", "bom_no": "BOM-001", "material_id": 1001,
    "base_qty": 1.0, "demand_qty": 100.0, "bom_version": "V1", "bom_type": "量产",
    "flatten": false, "total_nodes": 2, "max_level": 2, "message": null,
    "tree": [
      {
        "material_id": "1001", "material_code": "M-100", "material_name": "灯壳",
        "standard_qty": 1.0, "req_qty": 100.0, "level": 1,
        "bom_id": "BOM-001", "parent_material_id": null, "has_sub_bom": true,
        "children": [
          {
            "material_id": "2001", "material_code": "M-200", "material_name": "螺丝",
            "standard_qty": 4.0, "req_qty": 400.0, "level": 2,
            "bom_id": "BOM-002", "parent_material_id": 1001, "has_sub_bom": false,
            "children": []
          }
        ]
      }
    ],
    "items": null
  }
}
```

扁平形态（`flatten=true`）返回 `items` 数组，每个节点无 `children`，可用 `bom_id` / `level` / `parent_material_id` 还原层级关系。

---

## 4. `detail_orders_list` — 订单风险列表（0.1.0 兼容工具）

- 上游与 `orders_list` 相同（`/external/orders/list`）
- 用于兼容 AEOS Hub 旧首页，参数名为旧契约

### 4.1 请求参数与映射

| 旧参数 | 类型 | 约束 | 映射到上游 | 说明 |
|---|---|---|---|---|
| `customer` | string | ≤80 | `keyword` | 客户名称（模糊查询） |
| `product_line` | string | ≤40 | `keyword` | 产品线；与 `customer` 同时提供时**优先 `customer`** |
| `date_from` | string(date) | YYYY-MM-DD | `promised_date_start` | **语义为合同交期**（旧名为下单日期） |
| `date_to` | string(date) | YYYY-MM-DD | `promised_date_end` | 同上 |
| `page` | integer | 1–100 | `page` | 旧上限 100 |
| `page_size` | integer | 1–100 | `page_size` | 旧上限 100 |
| `request_id` | string | ≤64 | `request_id` | 原样透传 |

约束：`customer` / `product_line` / `date_from+date_to` **至少提供一个**，否则返回 `INVALID_ARGUMENT`。

### 4.2 返回字段

- `status` 与 `orders_list` 相同为**派生值**；另加两个兼容别名（保留新版原字段）：

| 兼容字段 | 来源 | 说明 |
|---|---|---|
| `amount_cny` | `order_amount` | 订单金额（兼容别名） |
| `due_date` | `promised_date` | 合同交期（兼容别名） |

- `risk_level` 原样返回；**不提供** `risk_probability`（不做事后换算）
- `evidence_refs` 实体为 `order`，格式 `control-platform://order/{order_no}@{data_as_of}`

---

## 5. 源表数据库全字段对照（含未暴露字段）

> 说明：以下为 SPC 源表**全部列**。`✅` 表示当前已通过 MCP 返回（括号内为 MCP 字段名）；
> `❌` 表示该列**未暴露**——如需使用，须由 SPC 侧在对外接口放开（MCP 为薄封装，放开后自动透传）。
> 类型为 PostgreSQL 类型；`timestamp` 均为 `timestamp without time zone`。

### 5.1 `sale_order`（订单表，48 列）→ 工具：`orders_list` / `detail_orders_list`

| # | 列名 | 类型 | 可空 | 注释 | MCP 暴露 |
|---|---|---|---|---|---|
| 1 | `id` | integer | 否 | 主键 | ✅ `id` |
| 2 | `order_no` | varchar(64) | 否 | 订单号 | ✅ `order_no` |
| 3 | `customer` | varchar(128) | 是 | 客户名称 | ✅ `customer` |
| 4 | `customer_code` | varchar(64) | 是 | 客户编码 | ✅ `customer_code` |
| 5 | `department` | varchar(64) | 是 | 部门 | ❌ |
| 6 | `audit_date` | date | 是 | 审核日期 | ❌ |
| 7 | `owner` | varchar(64) | 是 | 负责人 | ✅ `owner` |
| 8 | `status` | varchar(32) | 否 | 订单状态原始列（默认 `open`；对外返回的是**派生值**） | ✅ `status`（派生） |
| 9 | `risk_level` | varchar(16) | 是 | 风险等级 | ✅ `risk_level` |
| 10 | `data_source` | varchar(32) | 是 | 数据来源 | ❌ |
| 11 | `extra_data` | jsonb | 是 | 扩展数据 | ❌ |
| 12 | `created_at` | timestamp | 否 | 创建时间 | ❌ |
| 13 | `updated_at` | timestamp | 否 | 更新时间 | ✅ `updated_at` |
| 14 | `batch_no` | varchar(128) | 是 | 批次号 | ❌（订单明细工具中暴露） |
| 15 | `line_no` | varchar(32) | 否 | 订单行号 | ✅ `line_no` |
| 16 | `product_code` | varchar(64) | 是 | 产品编码 | ✅ `product_code` |
| 17 | `product_name` | varchar(256) | 是 | 产品名称 | ✅ `product_name` |
| 18 | `order_qty` | numeric(15,2) | 是 | 订单数量 | ✅ `order_qty` |
| 19 | `promised_date` | date | 是 | 合同交期 | ✅ `promised_date`（兼容别名 `due_date`） |
| 20 | `planned_start_date` | date | 是 | 计划开工日期 | ✅ `planned_start_date` |
| 21 | `delivery_completed_date` | date | 是 | 发货完成日期 | ✅ `delivery_completed_date` |
| 22 | `customer_grade` | varchar(4) | 是 | 客户等级 A/B/C/D | ❌ |
| 23 | `shipping_plan` | date | 是 | **出货计划** | ❌ |
| 24 | `customer_inspection_date` | date | 是 | 客户验货时间 | ❌ |
| 25 | `inspection_result` | varchar(64) | 是 | 客检结果 OK/NG | ❌ |
| 26 | `packaging_status` | text | 是 | 包装完成状况 | ❌ |
| 27 | `bom_return_date` | date | 是 | BOM 回收日期 | ❌ |
| 28 | `material_ready_date` | date | 是 | 料齐套时间 | ❌ |
| 29 | `shipping_status_desc` | text | 是 | 发货状态即时说明 | ❌ |
| 30 | `procurement_status` | text | 是 | 采购物料齐套-总体说明 | ❌ |
| 31 | `material_dates` | jsonb | 是 | 物料分类到料日期 `{电子料,SMT上线,光源,…,包材}` | ❌ |
| 32 | `front_process_date` | date | 是 | 前道日期 | ❌ |
| 33 | `first_article_date` | date | 是 | 首件检验日期 | ❌ |
| 34 | `assembly_start_date` | date | 是 | 组装上线日期 | ❌ |
| 35 | `assembly_complete_date` | date | 是 | 组装完成日期 | ❌ |
| 36 | `remark` | text | 是 | 备注 | ❌ |
| 37 | `order_nature` | varchar(32) | 是 | 订单性质 | ❌ |
| 38 | `order_date` | date | 是 | 下单时间 | ❌ |
| 39 | `risk_score` | numeric(5,2) | 是 | 风险总评分 0–100 | ❌ |
| 40 | `risk_factors` | jsonb | 是 | 各因子分值明细 `{delivery_delay,shortage,process_lag,quality,eta_delay,inspection_ng}` | ❌ |
| 41 | `risk_assessed_at` | timestamp | 是 | 最近风险评估时间 | ❌ |
| 42 | `completed_qty` | numeric(15,2) | 是 | 完成数量 | ✅ `completed_qty` |
| 43 | `order_amount` | numeric(15,2) | 是 | 金额 | ✅ `order_amount`（兼容别名 `amount_cny`） |
| 44 | `is_closed` | integer | 否 | 是否关闭（0 否 / 1 是） | ❌ |
| 45 | `field_synced_at` | jsonb | 是 | 字段级同步时间 `{field_name: ISO8601}` | ❌ |
| 46 | `erp_status` | integer | 是 | ERP 订单状态（整型：0 未审核 / 1 审核 / 2 部分关闭 / 3 已关闭） | ✅ `erp_status` |
| 47 | `erp_id` | integer | 是 | ERP 订单主键 ID | ❌ |
| 48 | `is_deleted` | integer | 否 | 是否删除（0 否 / 1 是） | ❌ |

### 5.2 `sale_order_line`（订单明细表，19 列）→ 工具：`order_details_list`

| # | 列名 | 类型 | 可空 | 注释 | MCP 暴露 |
|---|---|---|---|---|---|
| 1 | `id` | integer | 否 | 主键 | ✅ `id` |
| 2 | `order_no` | varchar(64) | 否 | 订单号 | ✅ `order_no` |
| 3 | `line_no` | varchar(32) | 否 | 行号 | ✅ `line_no` |
| 4 | `product_code` | varchar(64) | 是 | 产品编码 | ✅ `product_code` |
| 5 | `product_name` | varchar(256) | 是 | 产品名称 | ✅ `product_name` |
| 6 | `order_qty` | numeric(15,2) | 是 | 订单数量 | ✅ `order_qty` |
| 7 | `promised_date` | date | 是 | 合同交期 | ✅ `promised_date` |
| 8 | `planned_start_date` | date | 是 | 计划开工日期 | ✅ `planned_start_date` |
| 9 | `batch_no` | varchar(128) | 是 | 批次号 | ✅ `batch_no` |
| 10 | `status` | varchar(32) | 否 | 明细行状态 | ✅ `status` |
| 11 | `created_at` | timestamp | 否 | 创建时间 | ✅ `created_at` |
| 12 | `updated_at` | timestamp | 否 | 更新时间 | ✅ `updated_at` |
| 13 | `sale_order_id` | integer | 否 | 所属订单 id | ✅ `sale_order_id` |
| 14 | `erp_line_id` | varchar(64) | 是 | ERP 行 id | ✅ `erp_line_id` |
| 15 | `product_model` | varchar(128) | 是 | 产品型号 | ✅ `product_model` |
| 16 | `order_amount` | numeric(15,2) | 是 | 金额 | ✅ `order_amount` |
| 17 | `bom_no` | varchar(64) | 是 | BOM 编号 | ✅ `bom_no` |
| 18 | `bom_id` | integer | 是 | BOM id | ✅ `bom_id` |
| 19 | `shipping_plan` | date | 是 | **出货计划**（冗余自 `sale_order`，排产以此为准） | ❌ |

> 另：MCP 返回的 `customer` / `customer_code` 来自订单头（join），`labor_price_amount`（工价金额）由 BOM 汇总计算，均非本表列。

### 5.3 `scm_bom`（BOM 表，24 列）→ 工具：`bom_tree`（根信息）

| # | 列名 | 类型 | 可空 | 注释 | MCP 暴露 |
|---|---|---|---|---|---|
| 1 | `id` | bigint | 否 | 主键 | ❌ |
| 2 | `bom_id` | varchar(64) | 否 | BOM ID（外部系统） | ✅ `bom_id` |
| 3 | `bom_no` | varchar(64) | 否 | BOM 编号 | ✅ `bom_no` |
| 4 | `material_id` | integer | 是 | 物料 ID | ✅ `material_id` |
| 5 | `parent_bom_id` | varchar(50) | 是 | 上级物料 ID | ❌ |
| 6 | `bom_version` | varchar(20) | 是 | BOM 版本号 | ✅ `bom_version` |
| 7 | `bom_type` | varchar(32) | 是 | BOM 类型 | ✅ `bom_type` |
| 8 | `bill_type_id` | varchar(32) | 是 | 单据类型 ID | ❌ |
| 9 | `base_qty` | numeric(18,6) | 是 | 基础用量 | ✅ `base_qty` |
| 10 | `aux_attr_qty` | numeric(18,6) | 是 | 辅助属性数量 | ❌ |
| 11 | `unit_id` | varchar(32) | 是 | 计量单位 ID | ❌ |
| 12 | `aux_attr_id` | varchar(32) | 是 | 辅助属性 ID | ❌ |
| 13 | `supply_mode` | varchar(32) | 是 | 供应模式 | ❌ |
| 14 | `customer_material_id` | varchar(64) | 是 | 客户物料 ID | ❌ |
| 15 | `audit_status` | varchar(32) | 是 | 审核状态 | ❌ |
| 16 | `use_status` | varchar(32) | 是 | 使用状态 | ❌ |
| 17 | `disabled_status` | integer | 否 | 禁用状态（0 否 / 1 是） | ❌ |
| 18 | `void_flag` | integer | 否 | 作废标识（0 否 / 1 是） | ❌ |
| 19 | `is_audited` | integer | 否 | 是否审核（0 否 / 1 是） | ❌ |
| 20 | `audit_date` | date | 是 | 审核日期 | ❌ |
| 21 | `entry_date` | date | 是 | 录入日期 | ❌ |
| 22 | `data_source` | varchar(32) | 是 | 数据来源 | ❌ |
| 23 | `create_time` | timestamp | 否 | 创建时间 | ❌ |
| 24 | `update_time` | timestamp | 是 | 更新时间 | ❌ |

> 另：`demand_qty` / `flatten` / `total_nodes` / `max_level` / `message` / `tree` / `items` 为工具级字段（非表列）。

### 5.4 `scm_bom_detail`（BOM 明细表，25 列）→ 工具：`bom_tree`（节点）

| # | 列名 | 类型 | 可空 | 注释 | MCP 暴露 |
|---|---|---|---|---|---|
| 1 | `id` | bigint | 否 | 主键 | ❌ |
| 2 | `bom_id` | varchar(64) | 否 | BOM ID（外部系统） | ✅ `bom_id` |
| 3 | `line_no` | varchar(32) | 否 | 行号 | ✅ `line_no` |
| 4 | `material_id` | integer | 是 | 物料 ID | ✅ `material_id` |
| 5 | `standard_qty` | numeric(18,6) | 是 | 标准用量 | ✅ `standard_qty` |
| 6 | `aux_qty` | numeric(18,6) | 是 | 辅助数量 | ✅ `aux_qty` |
| 7 | `material_type` | varchar(32) | 是 | 物料类型 | ✅ `material_type` |
| 8 | `config_type` | varchar(32) | 是 | 配置类型 | ✅ `config_type` |
| 9 | `lead_offset_days` | integer | 是 | 前期偏移天数 | ✅ `lead_offset_days` |
| 10 | `back_flush` | integer | 否 | 是否倒冲（0 否 / 1 是） | ✅ `back_flush` |
| 11 | `scrap_rate` | numeric(10,4) | 是 | 损耗率 | ✅ `scrap_rate` |
| 12 | `oper_sn` | varchar(32) | 是 | 工序号（FOperSN） | ✅ `oper_sn` |
| 13 | `process_id` | varchar(32) | 是 | 工序 ID | ✅ `process_id` |
| 14 | `warehouse_id` | varchar(32) | 是 | 仓库 ID | ✅ `warehouse_id` |
| 15 | `location_id` | varchar(32) | 是 | 库位 ID | ❌ |
| 16 | `valid_date` | date | 是 | 生效日期 | ✅ `valid_date` |
| 17 | `invalid_date` | date | 是 | 失效日期 | ✅ `invalid_date` |
| 18 | `unit_id` | varchar(32) | 是 | 计量单位 ID | ❌（节点 `unit` 来自物料主数据） |
| 19 | `customer_bom_code` | varchar(64) | 是 | 客户 BOM 编码 | ❌ |
| 20 | `aux_attr_id` | varchar(32) | 是 | 辅助属性 ID | ❌ |
| 21 | `material_size` | varchar(64) | 是 | 物料尺寸 | ❌ |
| 22 | `kit_flag` | integer | 否 | 套件标识（0 否 / 1 是） | ✅ `kit_flag` |
| 23 | `data_source` | varchar(32) | 是 | 数据来源 | ❌ |
| 24 | `create_time` | timestamp | 否 | 创建时间 | ❌ |
| 25 | `update_time` | timestamp | 是 | 更新时间 | ❌ |

> 另：节点字段 `material_code` / `material_name` / `spec_model` / `unit` / `material_property` 来自物料主数据
> （`scm_material`）；`req_qty` / `level` / `parent_material_id` / `has_sub_bom` / `children` 为树展开计算字段。

## 6. 取值与字典说明

| 字段 | 取值 | 说明 |
|---|---|---|
| `status`（订单列表） | `pending_review` 未审核 / `in_progress` 进行中 / `partially_closed` 部分关闭 / `completed` 已完成 / `cancelled` 已取消 | **派生值**：由 `erp_status` + `delivery_completed_date` 计算；过滤支持派生码，兼容旧原始值（如 `open`） |
| `status`（订单明细） | 原始行状态（当前实际以 `open` 为主） | 明细行状态，未派生 |
| `risk_level` | `red` 高风险 / `yellow` 中风险 / `blue` 低风险 / `green` 正常 | 以 SPC 为准 |
| `material_property` | `1` 外购 / `2` 自制 / `3` 委外加工 / `5` 虚拟件 / `6` 特征类 | 以 SPC 为准 |
| `back_flush` / `kit_flag` | `0` 否 / `1` 是 | — |
| `data_confidence` | `high` / `medium` / `low` | 上游数据新鲜度；上游不可用时健康检查降为 `low` |
| `evidence_refs` | `control-platform://{entity}/{id}@{data_as_of}` | entity：`order` / `order-detail` / `bom` / `health` |

---

## 7. 变更记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-09-22 | 0.2.0 | 初版：订单列表 / 订单明细列表 / BOM 树 / 0.1.0 兼容订单风险列表字段清单 |
| 2026-09-22 | 0.2.0 | 补充源表数据库全字段对照（`sale_order` 48 列 / `sale_order_line` 19 列 / `scm_bom` 24 列 / `scm_bom_detail` 25 列），标注 MCP 已暴露与未暴露字段 |
