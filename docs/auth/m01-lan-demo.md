# M01 局域网演示访问

台式机以 `192.168.0.23` 提供仅限专用局域网的演示入口：

- Hub：`https://aeos-hub.test:9444`
- Keycloak 身份中心：`https://aeos-hub.test:9443`

数据库、Keycloak HTTP 管理端口和 Hub 的 `8790` 端口不向局域网开放。Windows 防火墙仅在 Private Profile 从 LocalSubnet 放行 TCP `9443`、`9444`。

## 笔记本一次性准备

1. 将台式机交付的 `AEOS Hub 局域网根证书.cer` 导入“当前用户 → 受信任的根证书颁发机构”。只导入该公开根证书，不复制任何 `.env`、私钥或数据库文件。
2. 以管理员 PowerShell 从代码目录运行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\add-m01-lan-host.ps1
   ```

   该命令只会添加 `192.168.0.23 aeos-hub.test` 的 hosts 映射并刷新 DNS。
3. 在浏览器打开 `https://aeos-hub.test:9444`。首次看到 Keycloak 登录页后，使用已存在的演示账号登录。

## 台式机启停

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-m01-demo.ps1 -NoBrowser
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-m01-demo.ps1
```

不要执行 `docker compose down -v`，它会删除 Keycloak 用户与 Caddy 证书数据。

## 回退

运行 `scripts\disable-m01-lan-firewall.ps1` 删除仅有的两条局域网规则。每次切换前的忽略 `.env` 备份保存在 `%LOCALAPPDATA%\AEOS-Hub\m01-backups`；恢复备份后重启 M01 服务即可回到原配置，Docker 卷不会被删除。
