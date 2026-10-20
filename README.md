# typora_plugin（含 image_rename）

本仓库 = [obgnail/typora_plugin](https://github.com/obgnail/typora_plugin)（MIT，已署名）＋ 自研插件 **image_rename**，打包为可直接安装的一体化版本。

## image_rename 是什么

Typora 图片自定义重命名插件：粘贴 / 拖入本地图片时，按模板自动重命名磁盘文件，并同步更新 Markdown 链接与图片别名（alt），不断链。命名模板与冲突策略对齐 Obsidian 的 Image Converter 插件。详见 [`image_rename/README.md`](image_rename/README.md)。

## 安装

1. 把本仓库根目录下的全部内容（`index.js`、`image_rename/`、`bin/`、`global/` …）整体复制到 Typora 安装目录下的对应文件夹：
   - 正式版：`Typora/resources/`
   - 测试版 / 免费版：`Typora/resources/app/`
2. 在该文件夹内以管理员身份运行 `bin/install_windows.ps1`，它会把加载脚本注入 `window.html` 并授予权限。
   - macOS / Linux 用对应的 `install_linux.sh` / `typora-plugin.sh`。
3. 重启 Typora，右上角「A 插件」→ 偏好设置 → 左侧即可看到「图片自定义重命名」。

> 插件默认已启用；命名模板等可在偏好面板或 `global/settings/settings.user.toml` 的 `[image_rename]` 段配置（默认值见 `global/settings/settings.default.toml`）。

## 目录说明

- `image_rename/`：本仓库新增的插件本体（自研）。
- 其余目录 / 文件：来自 obgnail/typora_plugin 框架（MIT）。本仓库在其基础上仅增加 image_rename 插件，以及少量 GUI 注册（`preferences/schemas.js` 的 `schema_image_rename`、`global/locales/` 三语翻译、`global/settings/settings.default.toml` 的 `[image_rename]` 默认段）。

## 许可

- 框架部分：遵循 obgnail/typora_plugin 的 MIT 许可（版权归原作者）。
- image_rename 插件：© 本仓库作者，沿用 MIT。
