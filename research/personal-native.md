# 个人功能原生协议与核对记录

依据：用户提供的官方 Android APK 16.6.4 / 2609291、根任务在已连接手机上的只读页面核对，以及 `.local/reference/coolapk-desktop-main` 的 MIT 参考实现。本文不包含账号响应、Cookie、手机号、手机原始界面文件或反编译源码。APK 分析中受保护字符串保留为 unknown，没有据此猜测写入参数。

## 当前实现

`core/personal.mjs`、`core/personal-models.mjs` 和 `src/Personal.tsx` 提供以下功能：

| 手机入口 | 原生桌面行为 | 验证范围 |
| --- | --- | --- |
| 我的数码 | 关注 / 机主 / 想买 / 买过四标签；分页、空、错误、重试；打开产品详情 | 手机四标签及顺序已核对；请求与界面采用模拟数据验证 |
| 我的看看号 | 我关注的 / 我管理的两标签；右上添加更多打开推荐订阅；查看看看号详情 | 手机两标签、添加入口已核对；请求与界面采用模拟数据验证 |
| 推荐订阅 | 保留服务器分组标题与查看更多链接；三列卡片；订阅/取消订阅复用已有 Catalog 操作 | 手机小编推荐/站内订阅及按钮已核对；查看更多仅验证链接交给统一导航，尚未逐个核对真实目的栏目 |
| 我的清单 | 仅查看当前账号创建的产品清单，并打开已有原生产品专辑详情 | 手机当前账号无创建按钮；请求与界面采用模拟数据验证 |
| 备份列表 | 当前账号的云端备份单、详情、应用记录；删除前重新核对 ID 与归属并确认 | 官方 Retrofit / BackupInfo 契约已恢复；手机应用备份创建和恢复安装通过可选手机协同回调交给根任务 |
| 首页屏蔽管理 | 节点 / 用户 / 关键字分类；云端读取、添加、确认取消、读回验证和幂等重试 | 手机三分类、关键字提示、节点选择器已核对；请求与界面采用模拟数据验证 |

这不是全部手机功能完成的声明。装备、抽奖、备份创建所需 packageInfo 尚缺可验证原生写入契约；没有创建猜测参数的 API。测试期间没有实际云写入、订阅、删除或手机操作。

## 请求契约

| operation | 请求 | 固定字段或备注 |
| --- | --- | --- |
| personalProductFollowing | GET `/v6/page/dataList` | `url=#/product/followProductList?&title=我关注的数码吧`；title/subTitle/page/firstItem/lastItem/pageContext |
| personalBackups | GET `/v6/backList/list` | page/firstItem/lastItem；当前账号 |
| personalBackup | GET `/v6/backList/detail` | id；校验返回 id/uid |
| personalBackupDelete | GET `/v6/backList/delete` | id；先读取详情验证当前账号归属 |
| personalHomeBlocks | GET `/v6/user/spamWordList` | 无查询字段 |
| personalHomeBlockUpdate | POST `/v6/account/updateConfig` | form key=`spam_word_config`，value 为精确变更 JSON；写入后再次读取确认 |
| personalNodePicker | GET `/v6/page/dataList` 或 `/v6/search` | 有限分类与固定 descriptor；不接受任意端点或账号字段 |
| personalDyhRecommendations | GET `/v6/page/dataList` | `url=#V8_CHANNEL_DYH_RECOMMEND`，title=`推荐订阅`；分页上下文 |

个人看看号“我关注的”复用 `catalogDyhFollowing` → GET `user/dyhFollowList`；“我管理的”复用 `catalogDyhEditing` → GET `user/editorDyhList`。这是个人页，与全局 Catalog 看看号探索页的四标签分别实现。

### 首页屏蔽

读取返回 `spam_word_config` 的 JSON 字符串和 `spam_word_config_max_count`。存储结构是 `custom[].title`、`node[].targetFullId/title/logo`、`user[].uid/name/logo`，与提交使用的 `word` 名称不同。

增删提交结构：

```json
{"word":{"add":"关键字"}}
{"word":{"cancel":"关键字"}}
{"node":{"add":[{"tid":"7000000017","name":"数码名称"}]}}
{"node":{"cancel":[{"tid":"7000000017","name":"数码名称"}]}}
{"user":{"add":"123456"}}
{"user":{"cancel":"123456"}}
```

关键字新增使用官方 `String.length` 的 2–15 长度规则，并拒绝 Unicode P/S 标点和符号；匹配忽略大小写。取消已有规则可处理旧版本留下的词语。操作先读当前状态，已应用的相同变更直接返回，避免写入后读回丢失导致重复提交。读回未确认不会显示成功。

官方搜索节点选择器的空关键词四页：

| 分类 | DataList url | 有关键词时 search type |
| --- | --- | --- |
| 最近 | `/member/recentFeedTargetList` | apkAndProduct（标签变为“综合”） |
| 话题 | `/topic/hotTagList?hotType=total&recommend=1` | feedTopic |
| 数码 | `/product/categoryDetailList?type=category&id=0` | product |
| 应用 | `/apk/apkStatList?type=today&column=commentnum` | localApkGame |

最近来自云端参与的数码或应用讨论，没有用本机选择历史冒充。搜索接口字段为 type/cat/sort/searchValue/page/firstItem/lastItem/pageContext；官方 caller 中 cat/sort 为 null，桌面省略。

`BlockNodeListFragment` 对选中的 Product/Topic/ServiceApp 取 `id % 1000000000`，分别加 7000000000 / 3000000000 / 1000000000。与动态菜单 `FeedBlockSpamInterceptor` 的转换区分：后者 Product id+7B、App/Game id+1B、话题 tid=0/name。话题临时 tid=0 与已存储 targetFullId 前缀 300 的名称匹配遵循官方 BlockContentManager。

`personalHeadlineVisible(feed, config, ignoredRenderedText?)` 供根 App 过滤首页头条。第三个旧参数兼容保留，不覆盖官方原始正文匹配。AccountScope、资源请求和验证重试均限制在当前账号与当前页面请求代次。

已恢复真正的 `EntityBlockSpamHelper`：只筛掉 Feed，递归处理 EntityCard.entities，并由当前或父 EntityListFragment 的 `pageConfig.blockSpamWord > 0` 启用。根 App 当前仅在首页头条启用，没有扩展至未核对的其他页面。关键字逐字段匹配 `messagesource`、`message`、`message_title`、`comment_good`、`comment_general`、`comment_bad` 与 `targetRow.title`，包括原始 HTML 属性；不会误用 `message_source`、`title`、`comment_good_source` 等其他字段。节点通过 FeedTarget 转换后的 ID 相等即可屏蔽，不要求改名后的名称继续相等；话题目标 tid=0 时按名称匹配，另检查去掉 # 后按逗号拆分的 tags。

官方将关键字以 `|` 拼接为 IGNORE_CASE Regex。桌面新建词语已禁止 P/S，普通词语使用字面匹配并按 Java 简单 Unicode 大小写映射折叠；以 Java CASE_INSENSITIVE/UNICODE_CASE 九组对照确认希腊末尾 sigma、土耳其 I、长 s、Kelvin 字母、补充平面字母的匹配，以及 ß/连字不扩展为多字母。旧版本保存的正则符号尚未逐一核对，桌面以字面匹配处理这些旧词语，没有直接执行未经验证的旧版正则表达式。

## 静态证据

`scripts/inspect-apk-contracts.mjs` 恢复真实业务 DEX 的 Retrofit annotations；输出和定向 JADX 源码仅保留在忽略的 `.local/contract-discovery/`，不提交反编译源码。

关键方法索引（业务 DEX 7）：

- `backList/list` 45038；detail 45002；delete 44785；cover 45051；create 45074。cover/create 字段仅作为已知证据，没有在桌面新增猜测写入。
- `user/spamWordList` 45068；`account/updateConfig` 44970。
- `user/dyhFollowList` 44994，个人页 MyDyhListFragment 的 isFollow=true 调用 q32 原始方法 ƚ / 53111。
- `page/dataList` 44913，q32 原始方法 ՙ / 53249。DataListFragment 在业务 DEX 8，原样传入 URL。
- `search` 44917，q32 原始方法 ޖ / 53344。NodePickDataListFragment / NodePickRecentListFragment 调用该方法。

定向类证据：DyhListActivity / MyDyhListFragment、ActionManagerCompat、DataListFragment、NodeRecommendPickerActivity、NodePickDataListFragment、NodePickRecentListFragment、BlockNodeListFragment、BlockContentManager（ue）、FeedBlockSpamInterceptor（xa4 / ya4）、EntityBlockSpamHelper（`com.coolapk.market.view.cardlist.Ϳ`，筛选方法 ށ / 28088）、Feed 的 SerializedName annotations、AddBlockDialog、BackupCreateDialog、BackupInfo Gson adapter。

### 装备和抽奖的证据边界

管理菜单 `q00` 的 TYPE_DEVICE 调用 ActionManager 原始 `ʻ`，通过 WebViewActivity 打开 `MyDeviceWebViewFragment`（external_url/extra_class_name/extra_toolbar_alpha）。URI 工具原始 `ޔ` / 方法索引 23274 构造 `https://m.coolapk.com/myDevice/<uid>`。同工具的个人产品 URI 为 `/mp/do?c=product&uid=<uid>`，分享 URI 为 `/mp/do?c=product&m=productOwnerShare&uid=<uid>&from=home`。

MyDeviceWebViewFragment 的 `onDataSelected` 监听 u32 事件，把 `-` 分隔的四个值传给网页 `addProductOwner(...)`；这只证明桥接形状，没有证明四值含义或装备保存的请求字段。MyDeviceSelectFragment 从 CATEGORY 构造 `searchSpot://product?title=数码吧&showMode=1&category=...`，用于装备产品选择。手机编辑页已核对五类：手机、平板电脑、穿戴设备、耳机、笔记本，以及添加产品/完成。

TYPE_LOTTO 调用通用 WebView，固定地址为 `https://m.coolapk.com/mp/do?c=feedLotto&m=myLotto`。已恢复的 Retrofit 绑定中没有 feedLotto / lottery / productOwner 的原生契约。

2026-10-04 对不携带 Cookie 或 UID 的官方装备 H5 匿名读取返回 HTTP 567，内容为 EdgeOne 访问拦截，未获得正文或静态 bundle；手机装备仍能正常显示。官方手机未暴露常规 WebView devtools socket。没有绕过限制或根据拦截页猜测装备/抽奖写入字段。

完整 `xa4` 反编译后确认 FeedBlockSpamInterceptor 是动态菜单的“屏蔽”入口 modifier，`ya4` 是 FeedTarget 转换辅助类。随后通过 BlockContentManager 规则读取的真实 caller 恢复 EntityBlockSpamHelper，从而确证正文选择范围、节点 ID 优先匹配和配置启用条件；服务端附加过滤细节仍需真实结果核对。

## 可重复验证

PowerShell 7（本机已配置 Node 时）：

```powershell
node --test tests/personal.test.mjs
$env:PLAYWRIGHT_BROWSER_CHANNEL='msedge'
node scripts/test-personal.mjs
node node_modules/typescript/bin/tsc --noEmit
```

目前 19 个单元检查和 14 个浏览器渲染检查通过；浏览器测试阻断外部请求，使用合成账号和响应。覆盖精确请求字段、失败分页原参数重试、推荐分组分页保留、云写读回丢失后的安全重试、错误不伪装空列表、账号切换后的迟到读取/验证不能继续旧账号操作、官方头条筛选字段/节点改名/Unicode 大小写，以及手机入口、订阅、节点综合/应用搜索、用户/词语屏蔽增删的原生交互。
