# AEOS Hub ↔ 公司中控平台执行智能体接入交接单

**交接日期：** 2026-10-14  
**对接目标：** 中控平台部署一个只读查询执行智能体，主动连接 AEOS Hub，接收查询派单并回传结构化结果。  
**环境：** 试点/UAT（未授权任何业务写入）。

## 1. 双方责任

| 事项 | AEOS Hub 团队 | 中控平台团队 |
|---|---|---|
| 控制通道地址、网络放行 | 提供 | 使用并验证出站连通 |
| 接入令牌 | 生成后通过独立安全渠道下发 | 仅写入部署平台密钥/环境变量，不写日志、不提交代码 |
| 智能体进程/容器 | 提供协议与验收 | 部署、保活、重连、日志采集 |
| 中控只读 API 凭证 | 不持有 | 按最小权限配置并保管 |
| 业务查询和结果 | 发起受控查询任务、保留审计记录 | 仅执行白名单查询并回传结构化结果 |

## 2. 中控平台部署配置

请在中控平台智能体的部署环境中配置以下变量。尖括号内容由双方在部署前确认；不要把实际 token 写到邮件、群聊或截图。

```env
# AEOS Hub 当前试点控制通道（由 AEOS Hub 团队填写实际内网 DNS 或 IP）
EXECUTION_WS_URL=ws://<HUB_内网_DNS或IP>:8788/execution-agent

# 由 AEOS Hub 管理员通过独立安全渠道提供
EXECUTION_PLANE_TOKEN=<单独下发的接入令牌>

# 本试点与 Hub 已预置 Runtime 的固定桥接标识，不要自行改名
EXECUTION_AGENT_ID=runtime-control-platform-agent

# 在 Hub 执行面仪表盘中展示的来源系统名称
EXECUTION_SOURCE_SYSTEM=公司中控平台（UAT）
```

> 当前试点使用独立的 `ws://` 控制端口。跨网、生产或长期部署前，AEOS Hub 团队会提供统一网关地址 `wss://<企业Hub域名>/execution-agent`；中控平台切换到该地址即可，其他协议字段不变。

## 3. 网络要求

- 中控平台智能体所在主机/容器必须能**主动出站**访问 `<HUB_内网_DNS或IP>:8788`。
- AEOS Hub 所在主机防火墙仅放行经双方确认的中控平台源网段访问 TCP 8788。
- 不要求 AEOS Hub 反向连接中控平台，也不要求中控平台暴露入站端口。
- 生产环境必须使用企业 DNS、TLS/WSS、网络隔离（VPN/专线/零信任）和受控源地址；不得使用本机演示域名 `aeos-hub.test` 作为企业接入地址。

## 4. 注册与心跳协议

传输为 WebSocket JSON 文本帧。握手请求头必须携带：

```http
x-aeos-execution-token: <EXECUTION_PLANE_TOKEN>
```

连接建立后立即发送注册消息：

```json
{
  "type": "register",
  "agentId": "runtime-control-platform-agent",
  "name": "中控平台查询智能体",
  "version": "<中控平台发布版本>",
  "sourceSystem": "公司中控平台（UAT）",
  "capabilities": [
    {
      "name": "query_control_platform",
      "description": "中控平台只读查询：path + params"
    }
  ]
}
```

收到 Hub 的确认后：

```json
{
  "type": "registered",
  "agentId": "runtime-control-platform-agent",
  "heartbeatIntervalMs": 5000
}
```

请按 `heartbeatIntervalMs` 发送心跳：

```json
{ "type": "heartbeat", "status": "idle" }
```

执行中可发送 `status: "working"`。若连续超过 3 个心跳周期未上报，Hub 会将该智能体标记为离线并停止派单。断线后请自行退避重连并重新发送 `register`。

## 5. 派单、回传与召回

Hub 会下发：

```json
{
  "type": "dispatch",
  "runId": "exec-run-<Hub生成ID>",
  "capability": "query_control_platform",
  "input": {
    "path": "/external/material-kitting/results",
    "params": {
      "demand_no": "HJY20260903-261",
      "demand_line_no": "18"
    }
  }
}
```

执行智能体应只调用中控平台白名单内的只读 API。开始时可上报：

```json
{ "type": "run_update", "runId": "exec-run-<Hub生成ID>", "state": "running" }
```

成功回传：

```json
{
  "type": "run_complete",
  "runId": "exec-run-<Hub生成ID>",
  "result": { "<中控平台返回的结构化data>": "..." }
}
```

失败回传：

```json
{
  "type": "run_failed",
  "runId": "exec-run-<Hub生成ID>",
  "error": { "code": "UPSTREAM_UNAVAILABLE", "message": "中控上游不可用" }
}
```

若收到 `{ "type": "recall", "runId": "..." }`，请立即取消当前查询、释放资源，且**不要再发送该 run 的完成或失败结果**。

## 6. 只读与数据边界

- 本接入只允许查询，不允许修改 ERP、中控、质量、生产或供应系统任何数据。
- 仅接受能力 `query_control_platform`，并仅处理由 Hub 下发的白名单 `path`。
- 上游返回 `{ code, message, data }` 时，只有 `code = 0` 才能以 `data` 回传；其他情况发送 `run_failed`。
- 对数据缺失、上游不可用、超时或过期，不得伪造成功结果；请返回可诊断的错误码与简短信息。
- 日志可记录 runId、能力名、耗时和错误码；不得记录 token、上游密钥或个人敏感数据。

## 7. 联调验收清单

中控平台部署完成后，请双方按顺序验收：

- [ ] 中控平台进程/容器启动后能连通 Hub 控制通道。
- [ ] Hub 执行面仪表盘出现 `runtime-control-platform-agent`，状态为“在线/远程”，来源显示“公司中控平台（UAT）”。
- [ ] Hub 收到心跳，5 秒内更新最后心跳时间。
- [ ] Hub 下发一次物料齐套或订单查询，智能体收到 `dispatch` 并回传 `run_complete`。
- [ ] AEOS 任务页“查看运行与历史”可看到该 run 的结构化回传；项目工作区可看到关联任务的同一回传。
- [ ] 模拟上游不可用时，Hub 显示失败/待人工决策，且不生成“已完成业务”的结论。
- [ ] 断开智能体后，Hub 在 15 秒左右标记离线；恢复连接后自动重新在线。
- [ ] 发送 `recall` 后，中控平台停止请求且不回传被召回 run 的结果。

## 8. 双方交付物

### AEOS Hub 团队提供

- 实际 `EXECUTION_WS_URL`（内网 UAT 地址）
- 接入 token（独立安全渠道）
- 已确认的源网段与防火墙规则
- 验收任务和结果确认

### 中控平台团队提供

- 智能体镜像/部署单元、版本号与回滚方式
- 实际 `agentId`、能力声明与 `sourceSystem`
- 健康检查、自动重连和日志定位方式
- 中控上游只读凭证已按最小权限配置的确认
- 联调日志：连接、注册、心跳、一次成功 run、一次失败 run、一次召回（均须脱敏）

## 9. 联调联系人填写区

| 项 | 内容 |
|---|---|
| AEOS Hub 实际控制通道地址 | `<待填写>` |
| 允许的中控平台源网段 | `<待填写>` |
| Token 下发方式与负责人 | `<待填写，不在本文填写 token>` |
| 中控平台部署负责人 | `<待填写>` |
| AEOS Hub 联调负责人 | `<待填写>` |
| 计划联调时间 | `<待填写>` |

---

协议的完整技术细节与当前端点白名单见 [执行面智能体接入契约](./execution-plane-agent-contract.md)。
