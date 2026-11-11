# M01 ↔ AEOS Hub Agent 注册部署证据

日期：2026-11-02

本次部署将 HUB 中枢 Agent `agent-aeos-hub` 接入 M01，并启用新建 HUB Agent 自动注册到 M01 的流程。密钥、密码和完整签名请求体不写入本文件。

## 非敏感配置

- HUB 分支：`aeos/phase1-v1.1`
- M01 分支：`aeos/phase1-v1.1`
- HUB 容器：`AEOS`
- M01 容器：`aeos-m01-kernel`
- HUB 对外端口：`8787`
- M01 对外端口：`3101`
- HUB 登录账号：与 M03 统一，当前账号为 `admin`；密码从部署环境注入，不写入仓库。
- HUB → M01 注册路径：`/integrations/m13`
- 租户：`TENANT_A`
- 当前为本地 M01 DEMO，HTTP 注册仅通过显式 `M01_AGENT_REGISTRATION_ALLOW_INSECURE_HTTP=true` 开启；生产必须改为 HTTPS。
- 中枢 Agent：`agent-aeos-hub`

## 执行命令

在 `work/AEOS-hub` 下执行：

```text
docker compose -p aeos-hub -f docker-compose.yml build aeos-hub aeos-init
docker compose -p aeos-hub -f docker-compose.yml up -d --no-build
docker exec aeos-m01-kernel node --input-type=module -e "...调用 /kernel/v1/master/register，使配置的 Owner 处于 active..."
docker exec AEOS npm run register:m01-hub-agent
```

## 观察结果

1. HUB `/healthz` 返回 `200`，状态为 `ok`。
2. HUB 使用 M03 账号登录返回 `200`；旧 `demo` 账号返回 `401`；退出后会话返回 `401`。
3. 中枢 Agent 注册脚本返回 `state=active`。
4. M01 返回的有效权限为 `task:execute`，无越权权限被写入 HUB。
5. 通过 HUB 登录态调用重试接口返回 `200`，重复注册仍为 `active`，事件保持幂等。
6. M01 状态查询显示 `agent-aeos-hub=active`、权限为 `task:execute`。
7. M01 `/kernel/v1/authorize` 对 `agent-aeos-hub / task / execute` 返回 `ALLOW`。

## 验证命令

```text
cd work/AEOS-hub
$env:NODE_OPTIONS='--experimental-strip-types'
npm run test:m01-bridge
npm run test:m01-registration
npm run test:m01-console
npm run check:types
npm test

cd ../Kernel-M01/demo
npm test
```

结果：HUB 定向测试、类型检查、HUB 全量测试和 M01 DEMO 测试均通过；M01 DEMO 集成测试为 14/14 通过。

## 运行边界

当前 M01 为 DEMO 模式，Agent 状态存于内存，重启 M01 会重新导入人员并需要重新执行中枢 Agent 注册。生产环境必须替换为持久化存储、正式 OIDC/密钥管理和可审计的撤权传播机制。
