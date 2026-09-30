# MCP 包接入与去重规则

## 单一规范目录

每个业务系统只保留一个 MCP 源码目录。`company-control` 的唯一目录为项目根的
`mcp-company-control/`；版本号只记录在该目录的 `server.json`、`CHANGELOG.md` 与 Git 提交中，
不得新建 `mcp-company-control-v*` 的并行目录。

`mcp/registry.json` 是 MCP 运行配置和只读工具白名单的唯一来源。新能力必须更新规范目录的
`server.json` 与此注册表，不能通过新增第二个包目录接入。

## 新链路接入流程

1. 将外部包与规范目录进行差异比对，确认新增 Tool、上游端点、测试和依赖。
2. 将经评审的源码合并到 `mcp-company-control/`；保留既有兼容 Tool，除非有明确的破坏性变更批准。
3. 不复制或提交 `.env`、Token、AppSecret；由部署环境注入，或由负责人安全迁移。
4. 同步更新 `server.json`、`mcp/registry.json`、接口文档与回归测试。
5. 运行 MCP 自测、注册表策略测试和调用方回归测试。
6. 验证通过后删除外部临时副本和旧版并行目录。

## 自动防重复

`src/mcp-registry.ts` 会在加载注册表时强制要求 `company-control` 使用规范目录，并拒绝项目根中
任何 `mcp-company-control-v*` 目录。这样重复包无法进入运行时配置。

## 齐套链路上线前置条件

MCP 适配层已注册齐套结果、缺料、需求、库存可用量和未来供给 Tool。SPC 上游还必须实际发布对应
只读端点并给 API Key 授权；若返回 `404`、`UPSTREAM_UNAVAILABLE` 或过期数据，AEOS 必须标注
“数据置信度不足”，不得将其解释为无缺料或已齐套。
