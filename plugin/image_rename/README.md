# image_rename

Typora 图片自定义重命名插件（基于 [obgnail/typora_plugin](https://github.com/obgnail/typora_plugin) 框架）。

命名模板与冲突策略对齐 [xRyul/obsidian-image-converter](https://github.com/xRyul/obsidian-image-converter) 的「自定义图片名称 / 如果输出文件已存在」设置：粘贴 / 拖入本地图片时，自动按模板重命名磁盘文件，并同步更新 Markdown 链接，不断链。

## 安装

1. 先按框架文档装好 `typora_plugin` 主体。
2. 把 `image_rename/` 文件夹整体复制到框架的 `plugin/` 目录下：
   `Typora安装目录/resources/plugin/image_rename/`（正式版）
   或 `Typora安装目录/resources/app/plugin/image_rename/`（测试版）
3. 配置写入框架**全局用户配置** `plugin/global/settings/settings.user.toml`，追加 `[image_rename]` 段（默认段已含在 `plugin/global/settings/settings.default.toml`，可仅用默认值）。
4. 让插件出现在偏好面板（GUI），需给框架核心补充 4 处注册（见下方「升级后重加」）：
   - `plugin/preferences/schemas.js` —— 注册 `schema_image_rename` 与 `RAW_SCHEMAS` 条目
   - `plugin/global/locales/zh-CN.json` / `en.json` / `zh-TW.json` —— 加 `image_rename` 翻译段
5. 重启 Typora。

## 在偏好面板中配置（GUI）

重启后打开 Typora 右上角「A 插件」图标 → **偏好设置** → 左侧菜单找到 **「图片自定义重命名」**，即可可视化修改：

- **命名模板**（`PATTERN`）：支持占位符（见下表），带格式提示
- **文件名冲突时**（`CONFLICT_MODE`）：`increment` 加数字后缀 / `skip` 保留原名
- **插入图片时自动重命名**（`RENAME_AUTO`）：关掉后可手动触发
- **仅重命名近期生成的图片**（`RECENT_MS`）：毫秒，避免误改旧图

> 面板里改完点保存后，一般需**重启 Typora** 才生效（框架设置的通用行为）。

若偏好面板里找不到该入口，说明第 4 步的 schemas 注册没生效，可直接编辑 `settings.user.toml` 的 `[image_rename]` 段。

## 配置项（settings.user.toml 的 `[image_rename]` 段）

| 键 | 说明 | 默认 |
|----|------|------|
| `ENABLE` | 是否启用插件 | `true` |
| `PATTERN` | 自定义图片名称模板 | `Image{notename}-{date}  {HH}：{mm}` |
| `CONFLICT_MODE` | `increment`=添加数字后缀（-1、-2 等）；`skip`=同名保持原名 | `increment` |
| `RECENT_MS` | 只对最近 N 毫秒内新建的图片自动改名 | `20000` |
| `RENAME_AUTO` | 粘贴/拖入时是否自动改名 | `true` |
| `KEEP_URL_RAW` | 链接保留可读中文（启动时关闭 Typora 的图片URL转义 autoEscapeImageURL） | `true` |

### 占位符（同 Image Converter）

`{notename}` `{notename_nospaces}` `{notefolder}` `{parentfolder}` `{imagename}` `{filetype}`/`{ext}` `{date}` `{time}` `{YYYY}` `{MM}` `{DD}` `{HH}` `{mm}` `{ss}` `{date:FORMAT}` `{timestamp}` `{weekday}` `{month}` `{today}` `{yesterday}` `{tomorrow}`

默认模板 `Image{notename}-{date}  {HH}：{mm}` 生成示例：
`Image午信项目自发放版件步骤-2026-10-16  18：44.png`

> 模板里若写半角冒号 `:`，生成时会自动转全角 `：`（Windows 文件名不允许半角冒号）；其余非法字符转下划线。

## 手动命令（可绑定到 hotkeys / commander 插件）

- `rename-all`：对当前文档内全部图片执行一次重命名（整理已有文档）
- `rename-selected`：重命名光标所在图片
- `decode-links`：把文档内所有图片链接里的 %XX 编码还原为可读中文
- `sync-alt`：把文档内所有图片的别名（alt）同步为其文件名（不含扩展名），用于修正存量图片
- `preview`：在控制台打印当前模板的命名预览

## 原理

监听编辑区 `#write` 的 DOM 变动，图片插入后调用 Typora **原生** `imgEdit.moveImageTo_`（与右键「重命名/移动图片到…」同一条链路）：复制文件到新名 → 按当前图片设置把路径相对化 → 重写该块 Markdown 源码 → 删除原文件 → 记录 undo。因此磁盘文件名、预览、Markdown 源码三者始终一致，不断链。旧版 Typora 无此 API 时自动降级为手动改名 + 更新 `<img src>`。

原生链路不会更新图片别名（alt），但插件在调用 `moveImageTo_` **之前**就先把源码里的 `![alt](路径)` 改成新文件名（仅当图片处于含 `.md-content` 的源码态时生效），原生 N 改写路径时会把新 alt 一并带出——**一次到位、零轮询**。若该态不可用，则退回改名后轮询兜底（`POSTFIX_DELAY`/`POSTFIX_TRIES` 可调）。

笔记名取自官方属性 `File.filePath`（`File.bundle.filePath` 兜底），未打开的草稿显示「未命名」。

## 升级 typora_plugin 框架后需要重加的内容

`typora_plugin` 更新时会覆盖其框架核心文件，导致本插件的 GUI 入口消失（功能不受影响，因配置在 `settings.user.toml`）。更新后请重新应用以下 4 处：

1. `plugin/preferences/schemas.js`：加入 `schema_image_rename` 函数，并在 `RAW_SCHEMAS` 对象里加一行 `image_rename: schema_image_rename,`
2. `plugin/global/locales/zh-CN.json`：加入 `"image_rename": { ... }` 翻译段
3. `plugin/global/locales/en.json`：同上（英文）
4. `plugin/global/locales/zh-TW.json`：同上（繁体）

插件本体 `image_rename/` 目录与 `settings.user.toml` 的 `[image_rename]` 段不受框架更新影响，无需重加。
