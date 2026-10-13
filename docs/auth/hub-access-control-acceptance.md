# Hub 三模块验收清单

## 前置条件

- 使用 M01 human `manager` 登录，当前 tenant/organization 与已就绪 G0 scope 完全一致。
- 重新运行 `scripts/provision-m01-personnel-admin.ps1`，再重启 Hub，使服务客户端获得角色管理所需权限。
- 不使用真实密码做测试，不截图或复制 `.env`、Token、Cookie、Client Secret。

## 验收步骤

1. 系统配置能看到“用户管理”“角色管理”“权限管理”；普通 `operator` 看不到管理入口，接口请求返回拒绝。
2. 角色管理新增 `quality_reviewer` / “质量复核人”；列表显示使用人数、权限数量，每行有“权限”和“删除”。
3. 为该角色勾选一个真实资源的 `read`，保存后重新打开仍能回显；尝试授予资源不支持的操作应失败且不产生半份配置。
4. 用户管理把 `quality_reviewer` 分配给测试用户，同时保留其已准入的 `operator` 或 `owner` 角色；重新登录后账号仍可进入 Hub。
5. 已使用的 `quality_reviewer` 不可删除；移除用户分配后可以删除。`manager`、`operator`、`owner` 始终不可删除。
6. 权限管理新增顶级权限和子级，验证名称、编码、路由、CRUD、排序和启停；父级含子级时删除父级必须失败。
7. 用浏览器请求伪造 actor、tenant 或 organization，确认服务端仍只使用认证会话和 G0 scope。
8. 即使角色拥有权限，G0/G1 scope 不匹配、最后 manager 保护、Owner/Verify 或任务绑定门禁仍必须拒绝。
9. OA 投影用户显示员工号、部门、岗位和同步来源；Hub 不允许删除 OA 用户，OA 离职同步只停用账号。

## 当前不在范围

供应商绑定、企业微信绑定、SPC 部门岗位数据、真实 OA 数据库适配器尚未接入。它们不能用演示字段冒充；OA 适配器须待只读视图和字段契约确认后另行验收。
