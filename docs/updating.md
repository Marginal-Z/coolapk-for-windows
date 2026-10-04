# 软件更新

从 [GitHub Releases](https://github.com/Z-YO-YI/coolapk-for-windows/releases/latest) 下载 Windows x64 安装版 `Coolapk-Desktop-Setup-版本-x64.exe`。完成首次安装后，可在“设置 → 软件更新”中检查、下载并安装后续版本。软件启动时检查新版本；下载和退出安装需要用户操作。安装前请保存正在编辑的内容。

便携版使用同一更新源，但更新时启动安装器，将应用迁移到安装版。安装器使用用户级安装，不需要管理员权限；账号和设置仍使用原来的本机用户目录。0.4.0 及更早版本没有更新入口，需要先下载新版一次。

更新来自固定的公开仓库 `Z-YO-YI/coolapk-for-windows` 的稳定版 GitHub Releases，不需要酷安账号或 GitHub 登录。酷安账号凭据不会用于更新请求。更新元数据包含安装器的 SHA-512，下载由 Electron Updater 校验。当前发行包没有 Windows 代码签名，文件摘要不能代替发行者签名。

## 开发与发布

Windows 安装包使用 [Electron Builder 26 的 NSIS 目标](https://www.electron.build/v26/docs/features/auto-update/)，自动生成 `latest.yml`、安装器和 `.blockmap`。便携版继续独立提供。`latest.yml` 指向 NSIS 安装器。打包中的 `resources/app-update.yml` 固定配置公开 GitHub 仓库，不接受界面传入更新 URL。

在 **PowerShell 7** 中执行：

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm test:updates-ui
pnpm test:updates-native
pnpm package
pnpm verify:release
Copy-Item -LiteralPath research/release-manifest.json -Destination release/release-manifest.json
node scripts/publish-release.mjs --dry-run
```

`verify:release` 比较 ASAR 中的核心文件和规范化包元数据，核对 scrcpy 资源与许可证，并检查安装器、便携版、更新元数据和固定发布源。`latest.yml` 的版本、文件名、大小和 SHA-512 必须与本次 NSIS 安装器一致。生成的清单记录本次构建的摘要；不同构建应使用各自附带的清单。

发布前提升 `package.json` 的稳定版本，并同步锁文件。先推送 `main` 并等待 Windows 构建全部通过，再为同一个提交创建 `v版本` 标签。在 **WSL Ubuntu** 中执行，示例版本须替换为此次实际版本：

```bash
cd '/mnt/d/coolapk desktop'
git tag v0.6.2
git push origin v0.6.2
```

`v*` 标签触发完整 Windows 检查与打包。所有检查通过后，独立的发布 job 验证标签与包版本、提交和 `main` 历史，重新核对下载产物的大小和 SHA-256，先建立草稿并上传五个资产，再确认 GitHub 记录的摘要后公开：

- `Coolapk-Desktop-Setup-版本-x64.exe`
- `Coolapk-Desktop-Setup-版本-x64.exe.blockmap`
- `Coolapk-Desktop-版本-x64.exe`
- `latest.yml`
- `release-manifest.json`

`main`、拉取请求与手动构建仅提供 Actions 产物，不发布更新。写入权限只授予标签发布 job。已有公开版本的资产不会被覆盖；完全一致的重跑直接确认已发布。失败的草稿可在资产完全一致时补齐后继续，遇到任何冲突立即失败。需要替换发行文件时，须提升版本号并创建新标签。

草稿从已认证的 release 列表中查找，再按 REST ID 读取、公开和复核，避免标签查询未返回草稿。发布 job 使用仓库级固定并发组，在公开前再次检查最新版本，防止两个版本同时发布时将更新源回退。

0.5.1 的实际 GitHub 更新验证记录见 [`research/updates-live-checks.json`](../research/updates-live-checks.json)：运行真实打包程序，确认 0.5.1 识别当前版本，0.5.0 发现并下载公开的 0.5.1 安装器，下载文件的 SHA-512 与发布元数据一致。测试使用 D 盘隔离账号和缓存目录，没有执行真实安装。
