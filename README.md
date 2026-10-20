# typora_plugin（含 image_rename）

本仓库 = [obgnail/typora_plugin](https://github.com/obgnail/typora_plugin)（MIT，已署名）＋ 自研插件 **image_rename**，打包为可直接安装的一体化版本。

## image_rename 是什么

Typora 图片自定义重命名插件：粘贴 / 拖入本地图片时，按模板自动重命名磁盘文件，并同步更新 Markdown 链接与图片别名（alt），不断链。命名模板与冲突策略对齐 Obsidian 的 Image Converter 插件。详见 [`plugin/image_rename/README.md`](plugin/image_rename/README.md)。

## 目录结构

- `plugin/`：完整插件包（框架 + image_rename），即**安装单元**。把它放到 Typora 的 `window.html` 同级目录即可。
- `plugin/image_rename/`：本仓库新增的插件本体（自研）。
- `plugin/` 内其余目录 / 文件：来自 obgnail/typora_plugin 框架（MIT）。本仓库仅在其基础上增加 image_rename 插件，以及少量 GUI 注册（`plugin/preferences/schemas.js` 的 `schema_image_rename`、`plugin/global/locales/` 三语翻译、`plugin/global/settings/settings.default.toml` 的 `[image_rename]` 默认段）。

## 安装

1. 将本仓库的 **`plugin/` 文件夹** 整体复制到 Typora 安装目录下、与 `window.html` **同级**的位置，使得：
   - `.../window.html` 与 `.../plugin/index.js` 同时存在。
   - 常见路径：
     - 测试版 / 免费版（如 0.9.98）：`Typora/resources/app/plugin/`（此时 `window.html` 在 `Typora/resources/app/window.html`）。
     - 正式版：`Typora/resources/app/plugin/` 或 `Typora/resources/plugin/`，以 `window.html` 实际所在目录为准。
2. 进入 `plugin/bin/` 目录，以**管理员身份**运行安装脚本：
   - Windows：`install_windows.ps1`（右键「使用 PowerShell 运行」并以管理员启动，脚本会自行提权）。
   - macOS / Linux：`install_linux.sh` / `typora-plugin.sh`。
   脚本会把 `<script src="./plugin/index.js">` 注入 `window.html` 并授予所需权限；若已安装会提示跳过。
3. 重启 Typora，右上角「A 插件」→ 偏好设置 → 左侧即可看到「图片自定义重命名」。

> 插件默认已启用；命名模板等可在偏好面板或 `plugin/global/settings/settings.user.toml` 的 `[image_rename]` 段配置（默认值见 `plugin/global/settings/settings.default.toml`）。

## 卸载

运行 `plugin/bin/uninstall_windows.ps1`（Windows）或 `uninstall_linux.sh`（Linux/macOS），或手动删除 `plugin/` 文件夹并移除 `window.html` 中的 `<script src="./plugin/index.js">` 行（原文件已备份为 `window.html.bak`）。

## 许可

- 框架部分：遵循 obgnail/typora_plugin 的 MIT 许可（Copyright (c) 2023 obgnail）。
- image_rename 插件：© 本仓库作者，沿用 MIT。
