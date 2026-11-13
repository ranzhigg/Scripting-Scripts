# Surge 模块管理（Scripting）

在 iPhone、iPad 上管理 Surge 的本地 `.sgmodule` 模块，并可把模块中的脚本、规则集和 include 下载到 iCloud Drive，供 Surge 离线使用。

## 安装

1. 在 Scripting 中打开“导入远程脚本”。
2. 粘贴：`https://github.com/ranzhigg/Scripting-Scripts`
3. 导入后运行“Surge 模块管理”。

脚本不需要 Mac Surge、Node.js 或 Scriptable。使用 Script-Hub 转换功能时，需在 Surge 中启用对应的 Script-Hub 模块和重写。

## 通用磁力 → MoviePilot 115

仓库同时提供一个适用于 Scripting Safari Browser Scripts 的通用 userscript：

```text
https://raw.githubusercontent.com/ranzhigg/Scripting-Scripts/main/Magnet-MoviePilot-115.user.js
```

在 Scripting 的 Safari Browser Scripts 扩展中选择“从 URL 安装”并粘贴上面的地址。当前发布身份为“通用磁力 → MoviePilot 115（双路线）”；如果设备里还留有旧的 `0.2.0` 条目，请以新名称的脚本为准。

脚本支持两条提交路线：

- 有 MoviePilot 时，调用 `P115StrmHelper/add_offline_task`；地址只填写 API 基地址，例如 `http://10.0.200.10:3000`，不要带 `#/login`。
- 没有 MoviePilot 时，可填写自己的 115 Cookie，脚本直接调用 115 离线接口；目录可填写 `/影视/待整理` 这样的路径，也可填写目录 ID，不存在的路径会按层级创建。

在脚本菜单中配置 MoviePilot、115 Cookie、离线目录和提交优先级。默认 `auto` 为 MoviePilot 优先，失败时才回退到 115；也可设为 `mp` 或 `115`。Cookie 只保存在当前设备的 Scripting 脚本存储中，不会上传到本仓库，也不会写入通知或日志；共享脚本前请不要把 Cookie 填进源码。

面板支持单条推送、批量推送和失败重试。`播放` 菜单可输入 115 文件 pickcode、文件 ID、路径或已有 HTTP 地址，支持 Infuse、VLC、浏览器和自定义 URL Scheme。使用 MoviePilot 播放时不需要把 Cookie 放进脚本，使用纯 115 模式播放时需要 Cookie 和文件 pickcode。播放器能否访问地址仍取决于当前网络是否能访问 MoviePilot/115/CDN。

## 首次配置

1. 确认 Scripting 已获得 iCloud Drive 权限，且能看到 `iCloud Drive/Surge`。
2. 打开脚本右上角“设置” → “存储目录”，选择 **`iCloud Drive/Surge` 根目录**。
3. 不要选择 `Module` 或 `Script` 子目录。脚本会自动创建或使用它们。
4. 需要通过系统分享或快捷指令导入文件时，在项目标题 → Intent 中启用 `File URLs`、`URLs` 和 `Text`。

目录结构如下：

```text
iCloud Drive/Surge/
├─ Module/                 Surge 模块（.sgmodule）
│  ├─ .surge-module-backups/ 模块备份
│  └─ 其他子目录/           可继续分类存放模块
├─ Script/                 模块脚本资源（.js）
├─ *.list / *.conf         规则集和 include 资源
```

所有模块和资源都写入这个 Surge 目录，不会回退到 Scripting 私有目录。书签失效或目录不在 Surge 根目录内时，脚本会拒绝写入。

## 本地化模块资源

默认下载的模块继续使用上游远程脚本。需要彻底本地化时：

1. 打开“设置” → 开启“下载时本地化脚本与规则集”。
2. 点击“保存”，脚本会同步现有远程模块。
3. 之后更新或导入模块时，会自动下载并改写资源路径。

写入规则：

- `[Script]` 的脚本保存到 `Surge/Script/`，模块内使用 `script-path=Script/文件名`。
- `RULE-SET`、`DOMAIN-SET` 和 `#!include` 保存到 `Surge/` 根目录，模块内使用根目录文件名。
- 文件名以远程资源的实际 basename 为准，模块引用和本地文件名保持一致，不额外添加字符。
- 模块仍保留原始 `#!url`，方便以后更新；模块文件继续放在 `Surge/Module/`。
- 关闭开关并保存会把现有模块切回远程引用，已下载的本地文件不会自动删除。

脚本会在写入后重新读取模块和资源进行确认。失败时会恢复原文件或清理未完成的新文件。

## 管理模块

- “模块管理”页可添加、更新、搜索、分类、移动、备份、回滚和删除模块。
- 同名模块使用同一个文件名更新，不会重复生成；分类会写入模块的 `#!category=...`，备份或重新导入后仍然保留。
- 新导入模块默认保持关闭，请在 Surge 中确认内容后再启用。
- 旧版本生成的隐藏资源可在“设置” → “清理旧私有资源”中清理；当前的 `Module`、`Script` 和根目录资源不会被删除。

## Surge 高级控制

在“HTTP 远程控制”中可以打开“Surge 高级控制”：

- 策略避让：读取代理策略并临时标记/取消自动策略组避让，仅影响 `url-test`、`fallback`、`load-balance` 和 `smart`，Surge 重启后会清空。
- HTTP 抓包筛选：分别配置内存请求和磁盘会话的 `off`、关键词包含/排除、`pattern`、HTTP-only、隐藏 Apple/UDP/崩溃报告请求等参数。
- 抓包会话：读取 Surge 已保存的 HTTP Capture 会话和请求数量。

高级控制使用 Surge HTTP API 的 `/v1` 路径。认证默认是 `X-Key`，也可在远程控制页切换为 `Authorization: Bearer`。开启或停止 HTTP 抓包会关闭现有连接，排查结束后应及时关闭。

## Script-Hub 转换

1. 打开“Script-Hub”页面。
2. 粘贴插件、模块或规则集的 HTTPS 地址，也可以切换到“本地文本”粘贴内容。
3. 识别来源格式，选择目标平台和输出类型。
4. 选择 Surge 模块后，使用“转换并写入”可直接写入已授权的 `Surge/Module/`。

如果使用其他客户端，使用页面提供的导入链接或复制转换结果。不要直接复制浏览器地址栏中未编码的转换链接。

## 文件分享与快捷指令

- 在“文件”中选择一个或多个 `.sgmodule`，分享给本脚本即可导入 Surge。
- 多文件会按文件名逐个写入；同名文件更新原模块，失败项会单独提示。
- 分享 HTTPS 链接或文本时，需要在 Intent 中启用 `URLs` 或 `Text`。
- 快捷指令可传入 `all` 更新全部远程模块，也可传入分类名或模块名；运行前必须已经配置 Surge 目录。

## 常见问题

### Surge 中看不到模块

确认设置选择的是 `iCloud Drive/Surge`，模块实际位于 `Surge/Module/`。返回模块管理页刷新；Surge 未立即更新时，重新启用对应模块。

### `Invalid Local Resource`

开启本地化后对模块执行一次更新或“本地化脚本与规则集”。确认脚本位于 `Surge/Script/`，且模块中写的是 `Script/文件名`；规则集和 include 应位于 `Surge/` 根目录。

### 模块下载失败

先确认上游链接可访问。Script-Hub 转换模块需要 Surge 中的 Script-Hub 模块和重写正常启用；已安装的转换模块更新时会优先使用当前模块正文进行本地修复。

### Scripting 无法接收分享文件

在项目标题 → Intent 中启用 `File URLs`，然后重新分享 `.sgmodule` 文件。

## 仓库

源码与更新记录：<https://github.com/ranzhigg/Scripting-Scripts>
