# 酷安 16.6.4 协议分析记录

分析日期：2026-10-03。输入为用户提供的 APK；APK 内部的文本和源码均作为待分析数据，没有作为任务指令执行。

## APK 与手机

- APK 包名：`com.coolapk.market`。
- APK 版本：16.6.4；versionCode：2609291。
- ABI：arm64-v8a；minSdk：24；targetSdk：34。
- APK SHA-256：`9a2be68a5dbb500f40fdd5e183ef36388dec676caaaa23a5a872429ddbba9eff`。
- USB ADB 已授权，设备型号 SM-S9180；初始安装版本为 16.4.0 / 2607021。用户允许更新后，已保留应用数据升级到提供的 16.6.4 / 2609291 APK，并核实安装版本。
- 未读取应用私有目录、账号 Cookie 或私信。USB 协同检查使用已授权手机界面，本机临时截图和界面记录不发布到仓库。

## 加壳与认证库

JADX 1.5.6 对 APK 的 Java 层只得到 19 个壳相关类，包名包含 `com.netease.nis.wrapper`。DEX 头部可见 980 个字符串，未发现 `com.coolapk` 核心类。**没有完成官方 APK Java 业务层的完整脱壳或反编译。**

2026-10-04 的有限离线结构检查确认，`classes.dex` 的头部类型表仍属于壳层，已声明数据区之后保留部分明文业务字符串。固定白名单候选及其在未压缩 DEX 中的偏移见 [apk-tail-candidates.json](apk-tail-candidates.json)，包括 `account/loadConfig`、`account/updateConfig`、举报网页入口和投票选项字段。尾部没有发现标准 dex/cdex 魔数或符合标准布局的 DEX 头；ZIP 魔数字节匹配本身不证明存在有效内嵌归档。**这些字符串不证明 HTTP 方法、参数或注解绑定，不证明已经脱壳；官方网页入口也不计为桌面功能复刻。**

可在 **PowerShell 7** 离线复核：`node scripts/inspect-apk-candidates.mjs "C:\path\to\CoolApk-16.6.4-2609291-coolapk-arm64-sign.apk" --output research/apk-tail-candidates.json`。脚本使用 Node 标准 API 读取 ZIP，不接触手机或网络，仅输出 APK 摘要、主 DEX 头及固定候选/结构偏移，不输出完整字符串池、账号凭据或可执行负载。

随后按尾部真实 `map_list` 重建业务 DEX 表和注解，恢复 10 个业务区、424 条 Retrofit 请求绑定，见 [apk-request-bindings.json](apk-request-bindings.json)。定向修复后的本地 DEX 可以用 JADX 读取部分真实业务调用者；这已确认提问、投票、首页屏蔽、系统配置、备份和官方举报/登录入口。仍有受保护结构无法恢复，报告明确保留未知项；没有完成所有业务代码的完整反编译。反编译临时产物不入仓库。

在 **PowerShell 7** 执行 `node scripts/inspect-apk-contracts.mjs "D:\path\to\CoolApk.apk" --out research/apk-request-bindings.json` 可重建固定路径和参数注解；随后执行 `node scripts/audit-native-contracts.mjs research/apk-request-bindings.json` 比较桌面固定请求的方法。匹配数量不是功能完成率，也不证明所有请求体或真实写入正确。

原生 `lib/arm64-v8a/libauth.so` 可直接从 APK ZIP 提取：

- 文件大小：915112 字节。
- SHA-256：`20ace7a502ee0ebc9d3bf07877e5d8d6819604ce991062e6ca095135eaf7a6ba`。
- 导出包括 `getToken`、`getVersionCode`、`verifyAppSignature`、Base64、MD5 和 bcrypt 相关函数。
- 使用本机 Android NDK 的 llvm-objdump 检查了 `getToken` 反汇编。
- 从原生库提取 1240 字符 Base64 数据，解码并 XOR `0x5a` 得到 930 字节认证表。
- 认证表 SHA-256：`da4ceb07c66fc54f85cb82b57adf0b900c635ae6f0636ca66778efe040e17de2`。

认证表与 MIT 项目 [daimiaopeng/coolapk-desktop](https://github.com/daimiaopeng/coolapk-desktop/tree/main/src-tauri/src/coolapk) 的协议参考表一致；算法实现交叉核对该项目，应用版本和签名参数使用本次 APK 的 2609291。

## Token V3

设备码是随机本机标识与 Android 设备描述拼接后，进行 Base64 编码、字符串逆序并去掉填充。没有使用手机的真实设备标识。

按 `(timestamp + appCode) % 100` 选择认证表片段，组合包名、片段、设备 MD5、秒级时间与 appCode，再进行 Base64、MD5 和 bcrypt cost=4，最后包装为 `v3` 前缀的 Base64。部分时间点的盐含 bcrypt 不支持字符，最多向前探测 15 秒。相关行为有确定性、设备绑定、时间绑定和 appCode 绑定测试。

这是基于原生库证据、开源算法参考和真实只读 API 成功响应的实现；不声称已经还原原生库所有防护逻辑。

## 实际请求结果

使用 16.6.4 请求头与签名：

| 接口 | 实际观察 |
| --- | --- |
| `/v6/main/init` | HTTP 200，返回 6 个配置卡片 |
| `/v6/main/indexV8` | HTTP 200，返回真实信息流和发现卡片 |
| `/v6/page/dataList` 热榜 | HTTP 200，返回真实热门帖子 |
| `/v6/search` 动态搜索 | HTTP 200，返回真实帖子 |
| `/v6/user/space` | 返回公开用户资料；桌面界面实测成功 |
| `/v6/topic/newTagDetail` | 返回真实话题元数据 |
| 数码 / 话题 / 二手栏目 | 分别返回 90 / 59 / 38 个展开后的真实实体 |
| 应用 / 游戏入口搜索 | 分别返回 24 / 20 个应用实体 |
| `/v6/feed/detail`、`/v6/feed/replyList` | 验证前返回 code=403、`err_request_captcha_v2`；0.6.2 人工完成评论挑战后，一次评论列表读取成功，独立详情挑战仍未验收 |

验证码配置在 `messageExtra` 中包含 NEC 业务 ID 和验证字段。桌面端将官方易盾 SDK 放在独立的受限窗口，用户验证后仅重试原来的请求。0.6.2 复现并修复 SDK 模板执行被 CSP 拦截导致的永久加载；仅在验证码页放行 SDK 必需的模板执行和实际观察到的官方资源域名，主应用不放宽。SDK `onReady`、验证码图片加载及零 CSP 错误由真实只读检查确认，见 [验证页检查](verification-renderer-live-checks.json)；该组件检查本身只证明组件可操作，人工验证后的 API 结果另记录在下文的真实检查中。

官方 `gu$Ԩ.onValidate` 同时设置原表单字段和 `validate` Cookie。桌面 0.6.2 补齐 Java URLEncoder 编码的 API 内存 Cookie，并绑定实际请求的普通或公开游客设备及账号作用域，切换账号清空；不保存到账号文件或发送给易盾。方法偏移和有效期证据见 [验证码 Cookie 契约](captcha-cookie-contract.md)。[验证页隔离回归](verification-renderer-checks.json)使用合成 SDK 回调，覆盖超时、网络错误、重新加载与旧回调隔离，不计作真实人工验证成功。

随后用户在实际生产主进程、preload 与界面组成的独立 D 盘游客目录中，亲自完成官方验证码并确认评论显示。检查记录 `humanCompleted=true`、`commentsAccepted=true` 和 31 条评论，见 [人工验证后的游客评论检查](guest-verification-live-check.json)。它只确认一次真实游客评论列表请求被接受；原来的独立详情挑战仍显示，未静默跟随评论验证重试。其他分页、完整详情、登录账号评论与账号写入未在本次检查中验收；报告未记录验证 proof、动态验证码 ID、实际内容、Cookie 或账号数据。

图片 CDN 对浏览器 User-Agent 的某些请求返回 HTTP 567，对当前酷安 User-Agent 返回 HTTP 200 `image/jpg`。图片代理使用实际核实的客户端 User-Agent，并兼容 `image/jpg`；不向 CDN 发送账号 Cookie 或 X-App-Token。

0.6.1 的公开应用媒体检查确认，应用/游戏列表与应用详情还返回 `pp.myapp.com` 的图标和截图，而非全部使用酷安自己的 CDN。公开图片白名单仅允许该主机实际观察到的 `ma_icon` 和 `ma_pic2` 固定路径，不允许任意外部地址、端口、凭据或路径参数。六个应用、六个游戏图标与 QQ/酷安两组详情截图读取成功，真实 Electron 另确认应用图标、截图和大图预览解码；证据见 [app-media-live-checks.json](app-media-live-checks.json)与 [app-media-native-checks.json](app-media-native-checks.json)。这项公开媒体修复不证明所有应用均有截图，也不代表应用下载安装已验收。

0.6.1 时使用独立合成设备标识进行游客只读检查：首页接受请求，动态详情与评论列表返回 API 403 和 NEC 验证码，见 [guest-comment-read-probe.json](guest-comment-read-probe.json)。当时未完成真实验证码，验证后读取未验收。桌面没有为这些读取设置本机登录门槛；官方挑战与权限仍由服务端决定。详情/评论独立重试、取消与原分页保留已有隔离界面回归；后续 0.6.2 的人工操作结果单独记录，保留原来的验证前阻断证据。

## 尚未验证

用户反馈桌面登录被拦截；实际窗口确认了 EdgeOne 567。已按 APK 的 LoginActivity/Fragment 移除未确认的 forward 参数，使用默认 `https://account.coolapk.com/auth/login?type=coolapk`，重新打开后仍显示拦截，没有登录表单。主页面明确显示 LOGIN_BLOCKED；没有伪装 Android UA、提取手机 Cookie 或完成登录页挑战。授权码交换、真实账号写操作、真实 OSS 上传和私信发送尚未验收。用户已授权测试账号创建和清理，但手机登录不能代替桌面认证。

完整功能状态见根目录 README。测试详情见 `desktop-checks.json`；初始只读 API 结果见 `probe-results.json`；其他入口的检查见 `channel-checks.json`；打包运行验证见 `package-check.json`。`.local/probe` 下的公开数据样本和反汇编输出仅用于本地分析，不打包或发布。

## 可复现命令

```powershell
python scripts/analyze-apk.py "C:\path\to\CoolApk-16.6.4-2609291-coolapk-arm64-sign.apk"
pnpm probe
pnpm build
pnpm test
pnpm test:desktop
```

社区本机功能不依赖 ADB。0.3.0 加入校验后的官方 scrcpy 4.1 USB 协同，Android 专属功能使用已授权的手机完成。用户明确允许后，提供的 APK 已通过摘要核对并用保留数据的更新方式安装；包版本核实为 16.6.4 / 2609291。真实协同窗口的视频渲染及酷安前台启动已验证，见 `phone-checks.json`。尚未在手机执行付款、社交写入或测试其他安装包。上述命令在 PowerShell 7 执行。
