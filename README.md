# Surge 模块管理（Scripting）

用于在 iPhone、iPad 上管理 Surge 本地 `.sgmodule` 模块的 Scripting 脚本。

## 导入地址

```text
https://github.com/ranzhigg/Scripting-Scripts
```

在 Scripting 的“导入远程脚本”中直接粘贴仓库地址即可。当前脚本清单位于仓库根目录，不需要进入子目录。

源码和文档：[GitHub 仓库](https://github.com/ranzhigg/Scripting-Scripts)

## 能力与平台

脚本启动后分为两个页面：

- `模块管理`：管理、搜索、分类、刷新和写入 Surge 本地 `.sgmodule` 模块，支持备份、回滚、健康检查、批量选择与 ShareSheet 分享、快捷指令和可选 Surge HTTP 控制。
- 模块资源本地化：设置页可选“下载时本地化脚本与规则集”。开启并保存后，脚本会直接读取 Surge 中现有的模块正文，再处理 `[Script]` 中的远程 `script-path`、`[Rule]`/`[Ruleset]` 中的 `RULE-SET`/`DOMAIN-SET`，以及远程 `#!include`，避免把 boxjs、Script-Hub 这类转换地址误当成普通模块重新下载。资源直接保存到 `iCloud Drive/Surge` 根目录，并在模块中写入与远程一致的文件名；例如 `Module/Offline/Demo.sgmodule` 使用 `script-path=timecard.js`，实际文件为 `Surge/timecard.js`。关闭并保存后现有远程模块会切回远程引用，已有本地文件不会自动删除。旧版本的隐藏 `.scripting-resources`、`Scripts/...` 和哈希文件名会在手动本地化时自动迁移。
- `Script-Hub`：调用上游 Script-Hub 测试版完成格式识别与转换；本仓库只负责 UI、平台导入链接、结果复制和 Surge 本地写入。

Script-Hub 页的目标平台会同步目标格式、扩展名和快速操作：

| 平台 | 快速导入/写入 | 目标范围 |
| --- | --- | --- |
| Quantumult X | `quantumult-x:///add-resource` | QX 重写或规则集远程资源 |
| Loon | `loon://import` | `.plugin` 或规则集 |
| Surge | `surge:///install-module`，或写入已授权目录 | `.sgmodule` 模块 |
| Egern | `egern:/` | Surge 兼容模块或规则集 |
| Shadowrocket | `shadowrocket://install?module=...` | Shadowrocket 模块；规则集不提供直接 Scheme，需复制结果 |
| Scripting（模块导入） | `scripting://import_module` | `.sgmodule`（Surge）或 `.plugin`（Loon） |

Scripting 在这里是原生模块导入入口，不是另一套代理配置格式；选择 Scripting 后，输出格式决定导入 Surge 模块还是 Loon 插件。Shadowrocket 使用原生模块导入 Scheme，拉起失败时复制链接；规则集没有可靠的一键导入 Scheme，直接复制转换结果。Scriptable 仅作为兼容导入入口保留，不参与转换核心。来源和目标无法表达等价语义时，页面会提示并提供复制结果，不会伪装成可直接导入。

应用不内置在线模块市场、不维护第三方站点列表，也不会自动扫描或分发第三方内容。单个插件或模块使用 HTTPS 直链即可。

## 依赖

- iOS/iPadOS 上安装 Scripting
- Surge 已开启 iCloud，并能看到 `iCloud Drive/Surge` 文件夹
- 首次运行后，在“设置”中选择 iCloud Drive 的 `Surge` 文件夹；脚本会自动使用或创建其中的 `Module` 子目录，不会回退到 Scripting 私有目录
- Script-Hub 转换需要启用 Script-Hub 测试版对应模块和重写
- 使用 Shadowrocket 平台时需要安装 Shadowrocket；上游不支持的脚本触发器或专属语义会显示兼容性提示
- Scripting 原生“模块导入”不需要脚本名；选择 Scripting 平台后会通过 `scripting://import_module?url=...` 拉起模块导入页
- “更多”中的旧版 Scripting 脚本桥接仍需要填写 Scripting 中显示的脚本名；如果重命名脚本，必须同步修改该桥接设置
- 转换按钮会按你的选择把远程来源或本地文本、请求头和高级参数发送到 Script-Hub 测试版；不要填写 Cookie、Token 等敏感凭据

脚本不需要 Scripting Pro API、Mac Surge、Node.js 或 Scriptable。普通版 Scripting 即可运行。

## 安装

1. 打开 Scripting 的“导入远程脚本”。
2. 粘贴 `https://github.com/ranzhigg/Scripting-Scripts` 并导入。
3. 打开脚本，在“设置”中选择 iCloud Drive 的 `Surge` 文件夹；`.sgmodule` 写入其中的 `Module` 子目录，脚本和规则资源直接写入 `Surge` 根目录。
4. 在项目标题的 Intent 设置中启用 `File URLs`、`URLs` 和 `Text`。

## 使用 Script-Hub 页面

1. 在 Script-Hub 测试版中完成源格式和目标格式转换设置。
2. 需要手动转换时，打开本脚本的“Script-Hub”页面，粘贴插件/模块 HTTPS 直链，或切换到“本地文本内容”粘贴文本。
3. 点击“识别来源格式”，必要时在“格式”中手动修正。
4. 按需展开“高级转换参数”配置请求头、筛选、脚本兼容和运行参数。
5. 先在“格式与目标”中选择目标平台；目标格式和快速操作会自动同步。
6. 目标为 Surge 模块时，点击“转换并写入”会直接写入 `iCloud Drive/Surge/Module`；也可以在结果页生成远程安装链接。
7. QX、Loon、Egern、Shadowrocket、Scripting 的可用目标会生成对应 URL Scheme；Scripting 可在 Surge 模块与 Loon 插件之间切换。不支持直接拉起的组合请复制转换结果交给客户端。

不要打开转换链接后复制浏览器地址栏内容。浏览器地址栏中的链接可能未正确编码，复制后会导致参数异常。

如果使用“转换并写入 Surge”，脚本会通过 Intent 接收转换结果，并写入已授权目录；这条路径不依赖脚本名。只有“更多”中的旧版脚本桥接才要求脚本名与 Scripting 中显示的名称完全一致。

## 管理模块

- 打开“模块管理”页面可刷新模块列表。
- 远程模块可以单独更新，也可以批量更新；覆盖前会自动备份。
- 远程脚本和规则集默认继续使用上游 URL。需要彻底本地化时，可在设置中开启“下载时本地化脚本与规则集”，或长按模块执行同名操作；资源会写入 `Surge` 根目录，模块内容保留原始 `#!url` 以便继续更新。旧版本若已显示 `Invalid Local Resource`，对该模块执行一次本地化会把隐藏目录、`Scripts/...` 或带哈希文件名的旧资源迁移到根目录，并改写为 `timecard.js` 这样的裸文件名。
- 本地化有硬路径校验：只有解析成功的 Surge iCloud 书签目录允许写入资源；未选择、失效或越界时会拒绝操作，不会把资源落到 Scripting 私有目录。
- 设置页提供“清理旧私有资源”，只删除旧版本生成的 `.scripting-resources`，不会删除模块、备份或配置；若旧目录与当前 Surge 书签重叠，会自动跳过。
- 新增或首次导入的模块默认保持关闭；确认内容后再在 Surge 中手动启用。批量本地化不会逐个关闭/开启现有模块，避免短时间连续触发 Surge 配置重载；如果当前 Surge 版本没有立即识别文件变化，完成后手动重新启用对应模块即可。
- 长按模块可预览更新、编辑、复制链接、查看内容、回滚或删除。
- 添加模块时可以填写自定义分类，分类会以单条 `#!category=...` 元数据持久化写入模块；更新、备份恢复、批量导入和 iCloud 元数据同步都会沿用该分类，不需要重复手动设置。
- `.sgmodule` 文件可通过“文件”分享 → Scripting → 本脚本直接写入。
- 模块写入后会重新读取目标文件，避免只提示成功但实际没有落盘。

### iCloud 目录结构与子目录

模块始终写入已授权的 `iCloud Drive/Surge/Module`，资源写入同一个 `Surge` 根目录，不会落到 Scripting 私有目录。设置只需授权 `Surge` 根目录，`Module` 不存在时会自动创建；模块放在子目录时，资源仍使用根目录文件名：

```text
Surge/
├─ timecard.js
├─ rules.list
├─ Module/
│  └─ Providers/
│     └─ Demo.sgmodule
└─ .surge-module-backups/
```

模块内的 `script-path`、`RULE-SET`、`DOMAIN-SET` 和 `#!include` 会改写为 `Surge` 根目录下的裸文件名；普通规则、重写目标、图标和请求参数不会被误改。文件名保持远程 URL 的 basename，不再追加哈希字符。

### 批量分享与导入

1. 在“模块管理”进入批量选择，使用“全选”或“反选”，再点“分享”。
2. 在系统分享面板中选择“快捷指令”或本脚本；也可以在“文件”中多选 `.sgmodule` 后直接分享。
3. 脚本通过 Scripting 的 `File URLs` 接收文件列表，按文件名逐个读取、写入已授权的 Surge 目录并回读校验，不会只处理第一个文件。
4. 同名文件会覆盖已有本地模块；某个文件失败不会阻止其他文件继续处理，结果会分别列出成功和失败项。

若要交给快捷指令继续处理，请在脚本标题 → Intent 设置中启用 `File URLs`，并在快捷指令中使用“运行脚本”接收分享的文件。这个批量路径处理的是已有 `.sgmodule` 文件，不经过 Script-Hub 转换。

## 快捷指令

可以通过 Scripting 的“运行脚本”调用：

- 直接把一个 HTTPS 插件/模块链接分享到本脚本：脚本会按 Script-Hub 逻辑识别、转换并写入 Surge 模块目录
- 也可以传入 JSON 指定转换选项：`{"url":"https://example.com/a.js","name":"模块名称","category":"脚本","sourceFormat":"qx-script","targetFormat":"surge-module"}`
- 不传参数或传入 `all`：更新全部远程模块
- 传入分类名：只更新指定分类
- 传入 JSON：`{"category":"广告拦截","name":"模块名称"}`
- 传入多个模块名：`{"names":["模块1","模块2"]}`

分享链接转换需要在项目标题 → Intent 设置中启用 `URLs`；如果通过文本分享链接，也请启用 `Text`。进入页面后会自动填入来源并收起键盘，转换后的默认目标是 Surge / Egern 模块，写入前仍需先在脚本设置中授权 Surge 模块目录。

## 常见问题

### Scripting 提示“没有可运行的脚本”

在项目标题 → Intent 设置中启用 `File URLs`，然后重新导入或刷新脚本。

### 打开客户端但没有导入模块

先确认目标格式与平台一致：Scripting 原生入口只能接收 `.sgmodule` 或 `.plugin`；Surge 本地写入还需要已授权的 iCloud 模块目录。不要复制未编码的浏览器地址栏链接。若使用“更多”中的旧版 Scripting 脚本桥接，再检查脚本名、Script-Hub 模块和重写是否启用。

### 转换失败或识别不准

先点击“识别来源格式”；在线读取失败时可以在“格式”中手动选择。`.snippet` 按 QX 重写处理，`.js` 按 QX 脚本处理；脚本默认转换为 Surge / Egern 模块，只有需要独立执行时才选择“Surge 脚本（兼容）”。

### 只想导入本地文件

直接使用“文件”分享 → Scripting → 本脚本，不需要经过 Script-Hub 网络转换；多选文件时会逐个写入 Surge 目录。

### 模块资源本地化失败或想恢复远程资源

本地化只处理 `[Script]` 中的远程 `script-path`、`[Rule]`/`[Ruleset]` 中的远程 `RULE-SET`/`DOMAIN-SET` 和远程 `#!include`，不会改写普通规则、重写目标、图标或请求参数。下载失败时不会写入新的模块内容，并会回滚本次已经写入的资源；模块更新前的版本仍在自动备份中，可通过“回滚版本”恢复。关闭并保存开关会立即用远程模块文本移除本地资源引用，但已下载的根目录文件保留，避免误删。旧版隐藏目录只作为迁移源保留，不再生成新文件。

### 分类丢失、重复导入或出现重复模块

分类不是只保存在 Scripting 配置里，而是写进模块正文的 `#!category=分类名`。同名模块导入会写回同一目标文件，已有模块的本地化操作也只更新原文件；重复执行时会去重 `#!category`、`#!local` 和本地化标记，不会追加第二个模块。若手动移动模块文件，无需移动脚本资源；根目录文件名保持不变即可。

## 社区贡献

本仓库只维护 Scripting 端的通用兼容层和 UI。欢迎提交 Script-Hub 格式兼容、平台 URL Scheme 适配、Scripting API 适配、性能优化和文档改进 PR；请不要把单一第三方站点、账号信息、Cookie、Token 或私有地址写入默认代码。

当前版本见 [`script.json`](script.json)。
