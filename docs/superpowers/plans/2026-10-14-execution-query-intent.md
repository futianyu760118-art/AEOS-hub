# 执行面聊天查询意图修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将缺料、齐套、订单、库存、供给、质量、生产及供应商的编号、型号、状态、日期、数量和业务筛选条件转换为准确、受限的中台只读查询，杜绝静默全量查询。

**Architecture:** 把浏览器内的纯意图解析抽到独立 ES 模块，返回 `{ path, params }` 或用户可见错误。`app.js` 继续负责派单与渲染；解析模块只生成白名单路径和明确参数，单元测试直接锁定快捷查询语义。

**Tech Stack:** 浏览器 ES Modules、Node 内建 `node:test`、现有执行面 WebSocket 派单 API。

**Spec:** `docs/superpowers/specs/2026-10-14-execution-query-intent.md`

## Global Constraints

- 仅调用中台只读白名单 path，不修改中台接口、认证或 WebSocket 协议。
- 日期和数量意图无法完整解析时必须报错，不能发送空 `keyword` 的全量查询。
- 数量限制为正整数并设合理上限，避免意外大查询。
- 保持既有订单号缺料、齐套查询契约。
- 型号、名称和关键字不得被当成精确物料编码；中台不支持的条件必须明确报错，不得猜测字段。

## Review Focus

- 八类业务查询的每个已支持筛选字段都必须生成对应中台参数；由 Task 1 表驱动单测锁定。
- 数字前缀物料型号（如 `3.1.JFX27-B1WA45-ZJ2-10-001`）必须完整保留，并经库存 `keyword` 检索；由 Task 1 单测锁定。
- “近 3 天订单”必须包含合同交期范围和 `page_size`；由 Task 1 单测锁定。
- “前 5 个供应商”必须使用 suppliers path 而非 material supplies；由 Task 1 单测锁定。
- 没有可解析订单号的缺料/齐套、没有物料锚点的库存必须拒绝；由 Task 1 回归测试锁定。
- “近 X 天”或“前 X 个”中的非法、超限数量不得派单；由 Task 1 边界测试锁定。

---

### Task 1: 八类查询条件的可测试意图解析器

**Files:**
- Create: `public/execution-query-intent.js`
- Modify: `public/app.js:739-766`
- Test: `test/execution-query-intent.test.ts`

**Interfaces:**
- Consumes: `parseExecutionQuery(text: string)` 当前由 AI 港湾聊天派单调用。
- Produces: `parseExecutionQuery(text: string, now?: Date): { path: string, params: Record<string, string | number> } | { error: string }`。

- [x] **Step 1: Write the failing test**

```ts
assert.deepEqual(parseExecutionQuery('查询近3天的订单', new Date('2026-10-14T00:00:00Z')), {
  path: '/external/orders/list',
  params: { date_from: '2026-10-11', date_to: '2026-10-14', page_size: 20 },
});
assert.deepEqual(parseExecutionQuery('查询前5个供应商列表'), {
  path: '/external/suppliers/list', params: { page_size: 5 },
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/execution-query-intent.test.ts`

Expected: FAIL because `public/execution-query-intent.js` does not exist.

- [x] **Step 3: Implement `parseExecutionQuery` in `public/execution-query-intent.js`**

Recognize supplier intent before generic supply intent; derive ISO date-only boundaries from supplied `now`; retain dotted identifiers; distinguish exact IDs from model/name keywords; map all documented, user-expressible filters for each of the eight query types; parse relative/explicit date ranges, `前 N 个` and `第 N 页`; always emit bounded pagination; reject unavailable filters and unresolved scopes.

- [x] **Step 4: Replace the inline parser in `public/app.js`**

Import the new parser and remove only the old inline implementation. Keep dispatch, polling and result rendering unchanged.

- [x] **Step 5: Run focused tests**

Run: `node --test test/execution-query-intent.test.ts test/execution-plane.test.ts test/execution-capabilities.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/execution-query-intent.js public/app.js test/execution-query-intent.test.ts docs/superpowers/specs/2026-10-14-execution-query-intent.md docs/superpowers/plans/2026-10-14-execution-query-intent.md
git commit -m "fix: parse execution query dates and limits"
```

### Task 2: 查询回显、静态资源版本与安全回归

**Files:**
- Modify: `public/app.js:896-930`
- Modify: `public/index.html:716`
- Create: `public/execution-query-summary.js`
- Test: `test/execution-query-intent.test.ts`, `test/execution-query-summary.test.ts`

**Interfaces:**
- Consumes: `parseExecutionQuery` from Task 1.
- Produces: 用户提交前可见的准确查询说明；解析失败时不创建 dispatch。

- [x] **Step 1: Write the failing test**

```ts
assert.match(describeExecutionQuery(parseExecutionQuery('查询前5个供应商列表')), /前 5/);
assert.match(describeExecutionQuery(parseExecutionQuery('查询近3天的订单', fixedNow)), /2026-10-12/);
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/execution-query-intent.test.ts`

Expected: FAIL because the query description helper does not exist.

- [x] **Step 3: Implement `describeExecutionQuery` and show it in the pending chat message**

Show the selected business scope, filters and limit before polling. Render each of the eight endpoint categories with its business fields (for example, inventory on-hand/locked/available/in-transit quantities) rather than a generic title only. Bump the app module version in `index.html` so reverse-proxy/browser caches cannot retain the old query dispatcher. Do not expose credentials or internal tokens.

- [x] **Step 4: Run focused tests and static checks**

Run: `node --check public/app.js && npm run check:types && node --test test/execution-query-intent.test.ts test/execution-plane.test.ts test/execution-capabilities.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/execution-query-intent.js test/execution-query-intent.test.ts
git commit -m "feat: show execution query scope"
```

## Self-Review

- Spec coverage: Task 1 covers path/parameter correctness, bounded quantities and existing query regressions; Task 2 makes the actual scope visible before results arrive.
- Step scan: each test, implementation and verification action has one concrete outcome.
- Type consistency: Task 1 exports both parser result shapes; Task 2 consumes the successful parser shape only.
- Review focus: every listed ambiguity is assigned to Task 1 test coverage.
- Proportion: two small tasks match one browser-only query path without changing the middle platform.
