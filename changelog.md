# 更新日志

## v4.2.24

- 按 Surge HTTP API 新能力迭代远程控制：支持规范化 `/v1` 路径、X-Key/Bearer 认证和更明确的超时/错误回读。
- 新增“Surge 高级控制”：查看并切换临时策略避让，配置内存/磁盘 HTTP 抓包筛选参数，读取已保存抓包会话。
- 抓包开关保留 Surge 的运行时语义提示：开启或停止会关闭现有连接，筛选范围、匹配类型、关键词、HTTP/Apple/UDP 隐藏项均按官方接口字段提交。

## v4.2.23

- 模块、脚本、规则集和 include 统一写入已授权的 `iCloud Drive/Surge` 目录。
- 脚本统一保存到 `Surge/Script`，模块中的路径同步为 `Script/<文件名>`。
- 规则集和 include 保存到 Surge 根目录，文件名与模块引用保持一致。
- 更新、导入、本地化、分类和回滚失败时自动恢复，避免生成不可用的本地资源。
- 设置页可开启或关闭本地化；关闭后恢复远程引用，已下载文件保留。

## 2026-11-13

- 新增 `Magnet-MoviePilot-115.user.js`：适用于 Scripting Safari Browser Scripts 的通用磁力推送脚本。
- 直接调用 P115StrmHelper 的 115 离线任务接口，支持用户自定义目录，不绑定单一站点。
- 自动清理 MoviePilot 地址中的 `#/login`、`/login` 等前端路由，避免拼接 API 时产生无效 URL。
