# 官方验证码凭证契约核对

核对日期：2026-10-04。仅分析提供的官方 APK 静态字节和已有离线 DEX，不连接手机，不读取账号存储，不获取或代做真实验证码。

APK SHA-256：`9a2be68a5dbb500f40fdd5e183ef36388dec676caaaa23a5a872429ddbba9eff`。

## 验证配置与成功回调

业务 DEX 10 的 `gu.ԩ`（code offset `0x1c6418`）从服务端 JSON 读取 `captchaType`、`captchaId`、`captchaField`。在 `captchaType == NEC` 时调用 `gu.Ԩ`（`0x1c6398`），配置网易原生 SDK 的 `CaptchaConfiguration.Builder.captchaId`、listener，随后调用 `Captcha.init` 与 `Captcha.validate`。

业务 DEX 7 的 `gu$Ԩ.onValidate`（`0x19f5b0`）拼装 `NEC:{captchaId前8位}:{validate}`，然后分两路保存：

1. 服务端提供的 `captchaField` 非空时，调用 `ExtraPostFieldInterceptor.addExtraPostField(field, token)`。该拦截器只重建酷安域的 POST FormBody；应用的通用额外字段与另一个一次性的 `_v2_post_token` map 是不同机制。
2. 将同一 token 写入固定 **Cookie key `validate`**。DEX 单元位置 `u97` 是 `const-string v4,"validate"`；`u101` 是 `invoke-static/range {v3..v9}, CookieInterceptor.setCookie$default`。参数为拦截器实例、key、token、`0L`、默认参数 mask `4`、null。

之后才调用原始 `Function0.invoke` 回调继续请求。实际 proof 未记录。

## Cookie 编码、范围与有效期

已恢复的 `CookieInterceptor.setCookie$default` 在 `(mask & 4) != 0` 时令 expiredAt 为 `-1`。`setCookie(key, rawValue, expiredAt)` 使用 `java.net.URLEncoder.encode(rawValue, UTF-8)`；expiredAt 不大于零时删除该 key 的过期时间。它保存在进程内的 ConcurrentHashMap，**没有本地持久化调用、没有固定分钟数 TTL**。`createCoolapkCookieList` 包含未过期的额外 Cookie，`mergeCookieHeader` 覆盖原 Cookie 同名值，`intercept` 只向酷安域请求附带。

因此，原实现只在 GET 查询串或 POST form 放 token，会漏掉官方验证成功路径中的 `validate` Cookie，尤其不能替代 GET 评论请求的凭证。现有 GET query/POST field 暂时保留兼容；静态证据确认 Cookie 路径，不证明额外 GET 查询字段是服务端必需字段，也不证明当前桌面网络的人机验证一定会被官方接受。

## 桌面修复边界

`CoolapkClient` 使用私有内存状态，将 proof 绑定当前 API 设备与 UID；对原 Cookie 和 request-specific Cookie 参数做同名覆盖。编码按 Java URLEncoder 规则（空格为 `+`、`~!'()` 编码、`*` 保留）。原字段和分页参数保持。

显式公开用户读取使用独立、无登录 Cookie 的公共设备 reader；其验证 Cookie 不进入已登录的普通 reader。公共状态额外绑定发起操作的主账号 UID，账号或设备改变后清除。AccountScope 复制的是内存验证状态副本；主进程账号切换清空，不进入账号文件、UI 公开状态、第三方图片请求或验证码 SDK 会话。

`tests/verification-cookie.test.mjs` 和 `tests/guest-verification.test.mjs` 使用真实核心/主进程函数与**合成**服务和 proof，验证编码、GET/POST、分页继承、账号与设备隔离、重新挑战及不确定写入处理。它们是本地契约回归，**不能作为真实验证码通过或游客评论已验收的证据**。
