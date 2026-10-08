# coolapk desktop 官网

[访问官网](https://z-yo-yi.github.io/coolapk-for-windows/) · [应用仓库](https://github.com/Z-YO-YI/coolapk-for-windows)

第三方非官方 Windows 客户端的项目主页。纯 HTML、CSS 与 JavaScript，无构建依赖。包含产品截图、功能介绍、材质示意、下载、使用帮助及第三方声明；不展示更新日志，不处理酷安账号或凭据。

## 自动跟随应用发行

页面通过 GitHub 公共 API 读取 `Z-YO-YI/coolapk-for-windows` 的最新正式发行版。版本号、文件大小、安装版及便携版链接来自同一发行版。下载时再次检查，因此已打开的页面也能跟随新版本。应用发布流程成功公开新版后，官网无需修改版本号或重新部署。

仅接受固定仓库下的 HTTPS GitHub 资产地址和对应版本的文件名；排除草稿、预发布、未上传及重复资产。请求失败、限流或关闭 JavaScript 时，下载入口仍指向 GitHub 最新发行页，不把旧版本标为最新版。官网不保存 GitHub 令牌。

## 本地预览与检查

在 **WSL Ubuntu**（或 **PowerShell 7**）中，从本目录执行：

```sh
node preview.mjs
```

打开 `http://127.0.0.1:5294/`。另一个终端执行：

```sh
node --test release.test.mjs
node check.mjs
```

界面检查复用应用项目的 Playwright 依赖，默认使用 Chrome。CI 使用 Chromium。覆盖未来版本自动同步、限流与无 JavaScript 备用入口、截图和键盘交互、三种材质、320–1920 像素布局、减少动态效果和 200% 文字放大。

## 部署与素材

GitHub Pages 的自动部署工作流发布 `dist/`；开发预览与 QA 文件不发布。官网地址为仓库的 Pages 项目站点。

截图与应用图标沿用用户提供的素材；部分截图可能展示旧版布局。社区图片、酷安名称与标识归相应权利人所有，不能视为本项目可任意再授权的素材。材质演示是网页示意，实际效果以客户端与设备表现为准。
