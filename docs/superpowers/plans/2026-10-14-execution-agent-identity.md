# 执行面智能体身份标识 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在执行面仪表盘为每个接入智能体同时清晰展示“本机/远程”与来源系统，并让这两项身份信息可由注册契约稳定传递和保存。

**Architecture:** 管理面从 WebSocket 对端地址计算本机标识，避免由执行面自行声明；来源系统则作为注册消息的必填业务元数据。执行面注册表持久化两项字段，前端列表用名称后的徽标展示，现有历史记录在加载时归一化为明确的历史来源占位值。

**Tech Stack:** TypeScript、Node.js `ws`、浏览器原生 JavaScript、node:test。

**Spec:** 用户在 Claude Code 最新会话中留下的两项未完成需求：为在线本地智能体提供标识；以后每个接入智能体在名称后注明来自哪个系统。

## Global Constraints

- 仅修改执行面身份注册、展示、模拟器、接入契约及其直接测试；不改动其他业务模块。
- 管理面只读展示身份；不改变派单、召回、查询能力或权限边界。
- `sourceSystem` 必须在新注册时为非空字符串，最长 160 字符；历史持久化记录缺失时标作“历史记录（来源待补充）”。
- `local` 必须由管理面根据 WebSocket 对端是否为 `127.0.0.1`、`::1` 或 IPv4-mapped loopback 判断，不接受执行面上报值。
- 每项任务先补/调整测试，再实现，且只在本任务关联测试通过后进行下一项。

## Review Focus

- 历史 `execution-plane.json` 缺少新字段时仍可启动并显示明确的来源占位值；由 Task 1 测试固定。
- 非回环远程地址即使注册消息伪造 `local: true` 也显示为远程；由 Task 2 的地址判定测试固定。
- 空白、超长来源系统不能注册成功；由 Task 1 测试固定。
- 本机与来源系统徽标均应紧跟名称，并同时显示，不应挤掉在线/离线状态；由 Task 3 的 HTML 渲染断言固定。
- 模拟器在未设置环境变量时仍注册为“公司中控平台（本机演示）”；由 Task 4 的协议/源代码断言固定。

---

### Task 1: 扩展执行面注册记录与持久化兼容

**Files:**
- Modify: `src/execution-plane.ts:17-190`
- Test: `test/execution-plane.test.ts`

**Interfaces:**
- Consumes: `ExecutionPlaneRegistry.onRegister(input, send)`。
- Produces: `ExecutionAgentRecord` 增加 `sourceSystem: string`；`onRegister` 接收并校验 `sourceSystem`，同时继续接收由服务端传入的 `local`。

- [ ] **Step 1: 写失败测试，覆盖来源系统必填、合法保存和历史记录归一化**

```ts
assert.equal(registry.list().agents[0]?.sourceSystem, '公司中控平台');
assert.throws(() => registry.onRegister({ /* sourceSystem: '' */ }, () => {}), /sourceSystem 不能为空/);
assert.equal(reloaded.list().agents[0]?.sourceSystem, '历史记录（来源待补充）');
```

- [ ] **Step 2: 运行执行面注册测试，确认新断言先失败**

Run: `npm test -- --test-name-pattern="来源系统|注册后 agent" test/execution-plane.test.ts`
Expected: FAIL，因为记录和注册输入尚未包含 `sourceSystem`。

- [ ] **Step 3: 在 `src/execution-plane.ts` 实现 `sourceSystem` 的校验、记录及历史加载归一化**

`onRegister(input, send)` 以 `requireString(input.sourceSystem, 'sourceSystem', 160)` 生成记录字段；`load()` 对旧记录缺失/空白来源时写入固定历史占位文案，保留已存的 `local` 布尔值（缺失时为 `false`）。

- [ ] **Step 4: 运行执行面注册测试，确认通过**

Run: `npm test -- --test-name-pattern="来源系统|注册后 agent|重启后" test/execution-plane.test.ts`
Expected: PASS。

### Task 2: 由控制通道判定本机或远程身份

**Files:**
- Modify: `src/server.ts:1854-1890`
- Test: `test/execution-plane.test.ts`（纯函数测试）

**Interfaces:**
- Consumes: WebSocket `ws._socket.remoteAddress`（仅在服务端连接回调内读取）。
- Produces: 导出的或同文件可测的 `isLoopbackExecutionPeer(address?: string): boolean`，并将其结果作为 `local` 传入 `executionPlane.onRegister`。

- [ ] **Step 1: 写失败测试，覆盖 IPv4、IPv6、IPv4-mapped loopback 与普通远程地址**

```ts
assert.equal(isLoopbackExecutionPeer('127.0.0.1'), true);
assert.equal(isLoopbackExecutionPeer('::ffff:127.0.0.1'), true);
assert.equal(isLoopbackExecutionPeer('10.0.0.25'), false);
```

- [ ] **Step 2: 运行地址判定测试，确认失败**

Run: `npm test -- --test-name-pattern="loopback" test/execution-plane.test.ts`
Expected: FAIL，因为尚未实现地址判定。

- [ ] **Step 3: 实现地址判定，并在 register 分支传入服务端计算的 `local` 和客户端的 `sourceSystem`**

地址判定不信任客户端消息；注册消息只传入 `sourceSystem`，`local` 强制来自连接对端地址。

- [ ] **Step 4: 运行地址判定和执行面测试，确认通过**

Run: `npm test -- --test-name-pattern="loopback|注册后 agent|来源系统" test/execution-plane.test.ts`
Expected: PASS。

### Task 3: 在执行面聊天列表展示身份徽标

**Files:**
- Modify: `public/app.js:831-848`
- Modify: `public/style.css:2339-2344`
- Test: `test/chinese-copy.test.ts` 或新增最小前端源代码测试

**Interfaces:**
- Consumes: `/api/execution/agents` 的 `agent.local` 与 `agent.sourceSystem`。
- Produces: 每张 `.execution-agent-item` 在名称后显示本机/远程及来源系统徽标，保留已有在线/离线状态徽标和选择行为。

- [ ] **Step 1: 写失败断言，锁定前端使用 `agent.local` 和 `agent.sourceSystem`**

```ts
assert.match(app, /agent\.local/);
assert.match(app, /agent\.sourceSystem/);
assert.match(app, /本机/);
assert.match(app, /来源：/);
```

- [ ] **Step 2: 运行前端源代码测试，确认失败**

Run: `npm test -- --test-name-pattern="执行面身份" test/chinese-copy.test.ts`
Expected: FAIL，因为列表尚未渲染身份信息。

- [ ] **Step 3: 渲染两枚身份徽标并增加最小 CSS**

在名称行中使用转义后的 `agent.sourceSystem`；`agent.local === true` 显示“本机”，其余显示“远程”，来源显示为“来源：<系统名>”。为徽标增加紧凑、可换行的样式，避免影响可点击区域。

- [ ] **Step 4: 运行前端源代码测试，确认通过**

Run: `npm test -- --test-name-pattern="执行面身份" test/chinese-copy.test.ts`
Expected: PASS。

### Task 4: 更新模拟器与接入契约

**Files:**
- Modify: `scripts/execution-plane-simulator.mjs:20-101`
- Modify: `docs/execution-plane-agent-contract.md:28-46,135-147`
- Test: `test/execution-plane.test.ts`（契约字段断言）

**Interfaces:**
- Consumes: `EXECUTION_SOURCE_SYSTEM` 环境变量。
- Produces: 模拟器 `register` 消息的 `sourceSystem`，默认值为 `公司中控平台（本机演示）`；契约将 `sourceSystem` 标记为新接入智能体的必填字段，说明 `local` 由管理面自动计算。

- [ ] **Step 1: 写失败断言，锁定模拟器与文档中的来源字段**

```ts
assert.match(simulator, /EXECUTION_SOURCE_SYSTEM/);
assert.match(contract, /sourceSystem/);
assert.match(contract, /管理面.*回环地址/);
```

- [ ] **Step 2: 运行契约断言，确认失败**

Run: `npm test -- --test-name-pattern="执行面身份契约" test/execution-plane.test.ts`
Expected: FAIL，因为模拟器和文档尚未包含该字段。

- [ ] **Step 3: 实现模拟器默认来源并更新契约表格、部署参数说明**

模拟器只发送来源系统，不发送本机标识；文档明确新接入端必须提供来源系统，且本机/远程由 Hub 控制通道对端地址自动标记。

- [ ] **Step 4: 运行全部相关测试**

Run: `npm test -- --test-name-pattern="执行面|Chinese" test/execution-plane.test.ts test/chinese-copy.test.ts test/execution-plane-runtime-adapter.test.ts`
Expected: PASS。

- [ ] **Step 5: 审查限定差异并提交**

Run: `git diff --check && git diff -- src/execution-plane.ts src/server.ts public/app.js public/style.css scripts/execution-plane-simulator.mjs docs/execution-plane-agent-contract.md test/execution-plane.test.ts test/chinese-copy.test.ts`
Expected: 仅包含上述身份标识与测试变更，无空白错误。
