# coolapk desktop

**酷安非官方 Windows 桌面客户端。**

[![Windows build](https://github.com/Z-YO-YI/coolapk-for-windows/actions/workflows/windows.yml/badge.svg)](https://github.com/Z-YO-YI/coolapk-for-windows/actions/workflows/windows.yml) [![GitHub Release](https://img.shields.io/github/v/release/Z-YO-YI/coolapk-for-windows?display_name=tag)](https://github.com/Z-YO-YI/coolapk-for-windows/releases/latest) ![Platform](https://img.shields.io/badge/platform-Windows%20x64-0078D4)

coolapk desktop 将酷安社区带到电脑上，提供适合键盘、鼠标和宽屏阅读的浏览、搜索与媒体体验。话题、数码、应用与游戏、二手和资料库支持多列海报浏览。社区界面使用 Electron、React 和 TypeScript 构建；需要 Android 设备的操作通过 USB 手机协同完成。

[下载客户端](https://github.com/Z-YO-YI/coolapk-for-windows/releases/latest) · [更新日志](CHANGELOG.md) · [反馈问题](https://github.com/Z-YO-YI/coolapk-for-windows/issues) · [功能进度](research/parity-gaps.json)

> 项目正在持续开发，尚未完整覆盖酷安手机客户端的全部功能。部分登录后操作已接入，但仍需真实账号流程验收，具体边界见[已知限制](#已知限制)。

## 主要功能

| 功能 | 内容 |
| --- | --- |
| 社区与搜索 | 首页栏目、热榜、话题、用户主页、分类搜索和输入建议；固定栏目、自动分页及刷新回顶 |
| 内容与媒体 | 动态详情、评论与楼中楼、图片和实况照片、视频；独立图片窗口、缩放与原图保存、酷图海报网格 |
| 发布与整理 | 图文、文章、视频、提问与投票创建；账号草稿、收藏单、分享卡及 Markdown / JSON 导出 |
| 账号与消息 | 多账号切换、个人资料和内容分类、关注与粉丝、私信与通知 |
| 数码与应用 | 产品分类、参数、点评与机型比较；应用和游戏列表、介绍、截图及可用版本 |
| 应用下载 | 下载队列、进度与速度、暂停、继续、取消、重试及记录管理；自定义保存目录，确认后安装到手机 |
| 外观与设置 | 多种主题、自定义配色和背景、透明度调节、字号与夜间模式；液态玻璃、背景模糊和半透明材质及独立开关 |
| 手机协同 | 通过 USB 打开手机控制窗口，使用键鼠操作 Android 专属功能；支持手机熄屏时继续协同 |

此外，客户端已接入好物清单、二手列表及发布编辑、账号隐私与订阅设置，并提供本机青少年模式。上述功能受官方服务、账号权限和设备条件约束。

## 下载与安装

当前提供 **Windows x64** 安装版和便携版，请从 [GitHub Releases](https://github.com/Z-YO-YI/coolapk-for-windows/releases/latest) 获取最新版本。

| 文件 | 用途 |
| --- | --- |
| `Coolapk-Desktop-Setup-<版本>-x64.exe` | 安装版，推荐日常使用，支持后续软件内更新 |
| `Coolapk-Desktop-<版本>-x64.exe` | 便携版，下载后直接运行 |
| `release-manifest.json` | 本次发行文件的摘要与构建校验记录 |

### 软件更新

进入 **设置 → 关于酷安 → 检查软件更新**，可以查看更新日志、下载新版本并确认安装。

- 启动时只检查更新，下载和安装由用户主动触发。
- 支持取消和重试下载；关闭更新窗口不会中断下载。
- 便携版更新使用同一安装器，并迁移为安装版；账号、设置和草稿沿用本机用户数据目录。
- 更新文件通过 SHA-512 校验。当前发行包未进行 Windows 代码签名，文件摘要不等同于发行者签名。

更多说明见[更新与发布指南](docs/updating.md)。

## 使用指南

### 浏览与登录

公开内容可以在未登录状态下浏览。需要互动时，点击左下角 **登录酷安**，在官方登录窗口中自行完成登录。客户端支持多账号管理，凭据通过 Windows 系统加密保存在本机。

官方服务可能要求安全验证。点击对应提示中的 **完成验证**，亲自完成滑块或点选题；成功后客户端重试对应的读取请求。登录或验证窗口加载失败时，请检查网络后重试。

### 外观与栏目

在 **设置 → 界面显示** 中调整主题、字号、自定义背景和不透明度，并选择或关闭材质效果。液态玻璃是基于 Windows / Electron 的光学近似；实现和兼容性说明见[界面材质文档](docs/liquid-glass.md)。

在 **设置 → 管理首页栏目** 中调整栏目顺序和显隐。首页活动自动轮播；刷新按钮会回到当前列表顶部并重新读取最新内容。

### 图片与下载

图片在独立窗口中打开，可使用工具栏或 **Ctrl + 鼠标滚轮** 缩放。长图在窗口内滚动，使用系统标题栏关闭按钮或 **Esc** 退出。

在 **应用下载** 中更改保存位置。新位置只作用于新任务，已有任务保留原目录；删除下载记录不会删除已保存的安装包。

### USB 手机协同

1. 在 Android 手机上启用 USB 调试并连接电脑。
2. 在手机上确认调试授权，然后进入客户端的 **手机协同**。
3. 打开手机窗口，使用鼠标和键盘操作；右键返回，中键回到手机桌面。

协同基于 [scrcpy](https://github.com/Genymobile/scrcpy)。手机与桌面账号分别登录；应用安装需要选择已授权设备并确认。**手机熄屏不等于绕过安全锁屏**，系统要求密码时仍需本人解锁。

### 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Ctrl + K` | 聚焦搜索 |
| `Ctrl + R` | 刷新当前列表并回到顶部 |
| `Alt + ←` | 返回上一页 |
| `Esc` | 关闭弹窗或图片窗口 |
| 图片窗口中的 `←` / `→` | 切换图片 |
| 图片窗口中的 `+` / `-` | 放大 / 缩小 |
| 图片窗口中的 `0` / `1` | 适应窗口 / 实际大小 |

## 已知限制

- 尚未完整实现手机客户端的全部功能。完整交易与支付、活动报名、部分内容再次编辑、完整账号安全与绑定、后台系统推送及部分特殊卡片仍有缺口。
- 发布、私信、投票、资料修改等账号写入功能，尚未完成全部真实账号端到端验收。协议和模拟测试通过不代表官方服务已接受所有操作。
- Android 专属操作依赖已授权手机。真实应用下载与安装仍需继续验证，拆分安装包及第三方镜像暂未适配。
- 收藏导出仅覆盖动态类内容，不下载附件，不能作为所有收藏内容的完整备份。
- 官方服务、网络环境和账号权限可能影响登录、验证与内容读取；新出现的官方验证仍需用户亲自完成。

详细实现范围、验证状态和后续事项见[功能完整性清单](research/parity-gaps.json)。历史变更集中记录在 [CHANGELOG.md](CHANGELOG.md)，验证报告保存在 [`research/`](research/)。

## 开发

### 环境要求

- Node.js **24 或更新版本**
- pnpm **11.25.0**，与仓库 `packageManager` 配置一致
- **PowerShell 7**，用于 Windows 原生开发、打包和 USB 协同
- Chrome，用于媒体与浏览器回归测试

Git 和 Linux 相关工作建议在 **WSL2 Ubuntu** 中执行；Windows 原生依赖、Electron 测试和安装包构建在 Windows 中执行。不要混用 Windows 与 Linux 的 `node_modules`。

### 获取源码

下面以 D 盘工作区为例，在 **WSL Ubuntu** 中执行：

```bash
mkdir -p /mnt/d/Projects
cd /mnt/d/Projects
git clone https://github.com/Z-YO-YI/coolapk-for-windows.git
```

安装依赖并启动开发环境，在 **PowerShell 7** 中执行：

```powershell
Set-Location 'D:\Projects\coolapk-for-windows'
pnpm install --frozen-lockfile
pnpm prepare:phone
pnpm dev
```

### 检查与构建

在项目目录的 **PowerShell 7** 中执行：

```powershell
pnpm test
pnpm build
pnpm package
pnpm verify:release
```

`pnpm package` 生成安装版和便携版，并准备手机协同组件。`pnpm verify:release` 核对打包内容、第三方资源及更新元数据。完整检查流程见 [Windows CI](.github/workflows/windows.yml)，发布流程见[更新与发布指南](docs/updating.md)。

浏览器回归使用 Chrome；在 **PowerShell 7** 中设置：

```powershell
pnpm exec playwright install chrome
$env:PLAYWRIGHT_BROWSER_CHANNEL = 'chrome'
pnpm test:desktop-polish
pnpm test:image-viewer-zoom
```

原生窗口测试需先执行 `pnpm build`。隔离测试使用模拟服务或独立测试目录；连接真实手机或执行真实账号操作的测试，应单独确认测试条件。

### 项目结构

```text
core/       协议适配、认证、数据模型与账号存储
electron/   主进程、受限 IPC、登录验证、下载与手机协同
src/        React 桌面界面、主题、媒体与交互
tests/      单元与协议测试
scripts/    构建、发布、界面回归与分析工具
docs/       使用与实现文档
research/   功能清单与脱敏验证记录
```

`.local/` 用于本机临时文件和工具，默认不提交 Git。

## 反馈与贡献

欢迎通过 [Issues](https://github.com/Z-YO-YI/coolapk-for-windows/issues) 反馈问题或提出建议。报告问题时，请提供客户端版本、Windows 环境、复现步骤、预期结果和必要截图；不要提交密码、验证码、Cookie、令牌或未脱敏的私信内容。

提交 Pull Request 时，请说明改动目的与验证方式，保持修改范围清晰。涉及官方接口或账号行为时，应区分源码接入、隔离测试与真实服务验证，避免将尚未验证的能力标记为完成。

## 免责声明与许可

本项目由第三方独立开发，与酷安官方无隶属关系，未获得官方认可或背书。酷安名称、商标及相关内容归各自权利人所有；客户端功能依赖官方服务，官方服务调整可能影响可用性。

本仓库尚未提供独立的项目整体开源许可证。第三方代码、依赖和资源各自的许可及版权声明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)，其中的许可不代表对所有项目代码、品牌标识和图片资源的统一授权。
