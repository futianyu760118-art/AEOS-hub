# AEOS 用户可见中文化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AEOS Hub 的用户可见英文统一改为清晰的中文，而不改变接口和业务数据。

**Architecture:** 静态页面文案在 HTML 中直接中文化；动态展示通过集中标签映射和错误映射处理。服务端继续输出稳定的机器字段，浏览器负责把可预期的系统错误表达为中文。

**Tech Stack:** 原生 HTML、ES 模块 JavaScript、Node.js 测试。

**Spec:** `docs/superpowers/specs/2026-10-13-user-facing-chinese-copy.md`

## Global Constraints

- 不修改 API 路径、JSON 字段、状态枚举、编号、actor ID、URL、Evidence 引用或审计记录。
- AEOS、M01、MCP、ERP、BOM 等缩写可保留；不翻译用户或外部系统提供的内容。
- 不新增第三方依赖。

## Review Focus

- 未知状态或外部返回值必须显示中文兜底，不向用户裸露英文枚举。
- API 出错时通知必须中文化，且不得掩盖 HTTP 失败。
- 任务、项目、人员、Agent 与港湾页面均不应遗留孤立英文操作文案。
- 搜索、筛选和按钮的可访问名称须与显示文本一致。
- 翻译不能改变权限判断、任务流转、项目创建或数据提交负载。

---

### Task 1: 建立动态中文标签与错误文案

**Files:**
- Modify: `public/task-center.js`
- Modify: `public/task-agent-eligibility.js`
- Modify: `public/personnel-admin.js`
- Modify: `public/app.js`
- Test: `test/chinese-copy.test.ts`

**Interfaces:**
- Consumes: 现有状态枚举与 `taskRequest(path, method, body)`。
- Produces: 面向 UI 的中文状态、角色、异常和提示文本。

- [ ] **Step 1: 写失败测试**

断言前端模块为项目/任务未知状态提供“未知状态”，并且主应用定义项目接口旧实例的中文提示。

- [ ] **Step 2: 运行测试验证失败**

Run: `node --test test/chinese-copy.test.ts`
Expected: FAIL，因为尚未创建测试或中文映射。

- [ ] **Step 3: 集中替换动态可见文案**

保留枚举值和请求负载不变，仅替换渲染标签、通知、错误映射、角色显示和 Agent/运行节点状态的用户可见文本。

- [ ] **Step 4: 运行测试验证通过**

Run: `node --test test/chinese-copy.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add public/task-center.js public/task-agent-eligibility.js public/personnel-admin.js public/app.js test/chinese-copy.test.ts
git commit -m "feat: localize user-facing copy to Chinese"
```

### Task 2: 中文化静态页面与回归验证

**Files:**
- Modify: `public/index.html`
- Modify: `test/task-center-navigation.test.ts`
- Test: `test/chinese-copy.test.ts`

**Interfaces:**
- Consumes: Task 1 的动态文案约定。
- Produces: 完整中文的静态界面和可验证的汉化回归保护。

- [ ] **Step 1: 扩展失败测试**

断言常用导航、任务项目协同表头、Agent/运行节点展示和操作按钮没有英文界面文案，并保留 AEOS/M01/Evidence 的允许缩写。

- [ ] **Step 2: 运行测试验证失败**

Run: `node --test test/chinese-copy.test.ts test/task-center-navigation.test.ts`
Expected: FAIL，指出现有英文用户文案。

- [ ] **Step 3: 替换静态可见文案**

将 HTML 中的用户可见英文名称换为中文或中文加括注，更新相应 `aria-label` 与 `title`；不改 DOM ID、data 属性、接口路径和代码标识。

- [ ] **Step 4: 运行完整回归**

Run: `npm run test:collaboration && npm run check:types && git diff --check`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add public/index.html test/task-center-navigation.test.ts test/chinese-copy.test.ts
git commit -m "feat: translate static workspace copy"
```

## Self-Review

- Spec coverage: Task 1 覆盖动态状态与异常；Task 2 覆盖静态页面与可访问文本。
- Step scan: 每个步骤都有唯一的测试、实现或验证结果。
- Type consistency: 仅调整显示层字符串，不增加或更改数据接口。
- Review focus: 未知值、API 异常、各协同页面、可访问名称、功能回归分别由两项测试和完整回归覆盖。
- Proportion: 两个独立且可验证的任务覆盖本次显示层变更，没有扩展到数据或权限层。
