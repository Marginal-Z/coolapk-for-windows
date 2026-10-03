# 收藏单、动态管理与消息扩展

协议依据为已下载的 MIT 项目 [daimiaopeng/coolapk-desktop](https://github.com/daimiaopeng/coolapk-desktop) 中 `src-tauri/src/coolapk/client.rs`。这些新增写操作通过 mock 契约测试验证字段和权限边界；未使用真实账号创建、修改或删除内容。

| 桌面操作 | 接口与关键字段 |
| --- | --- |
| `collection` | GET `/v6/collection/detail?id` |
| `collectionStatus` | GET `/v6/collection/list?uid=&id={feedId}&type=feed&showDefault=1` |
| `collectionFeeds` | GET `/v6/collection/itemlist?id&listType=allFeedType`，保留独立条目字段 `collection_item_info` |
| `createCollection` | POST multipart `/v6/collection/create`，顺序 `isOpen,pic,description,title,sourceId` |
| `updateCollection` | POST 表单 `/v6/collection/update`，`id,title,description,pic,isOpen` |
| `deleteCollection` | POST 表单 `/v6/collection/delete`，`id` |
| `updateCollectionItems` | POST 表单 `/v6/collection/addItem`，`id,cancelId,targetId,type=feed,trace` |
| `removeCollectionItem` | POST 表单 `/v6/collection/removeItem`，`itemId` 是收藏条目编号，不能代入动态编号 |
| `clearCollectionInvalid` | POST 表单 `/v6/collection/removeUnUseItem`，`colId` |
| 收藏单关注/点赞 | GET `/v6/collection/follow,unFollow,like,unLike?id` |
| `editableFeed` | GET `/v6/feed/changeDetail?id&rid=&noticeId=&fromApi=` |
| `editFeed` | 重新读取 `changeDetail`，确认本人内容与编辑许可，POST 表单 `/v6/feed/changeFeed` |
| `deleteFeed` / `deleteReply` | 先读取对应详情确认本人内容，POST `/v6/feed/deleteFeed,deleteReply?id`，`X-Requested-With: XMLHttpRequest` |
| `sendMessage` | POST multipart `/v6/message/send?uid&quick_reply=1`，`message,message_pic,message_extra`；`message_pic` 为单个 `/message/` 相对路径，可发送纯图 |
| `followingFeeds` | GET `/v6/page/dataList?url=V15_HOME_TAB_FOLLOW&title=关注` |
| `notificationCount` | GET `/v6/notification/checkCount` |
| `clearNotificationCount` | POST `/v6/notification/clearCount?type=feed,message,all` |

所有写操作、本人收藏单、消息、关注流和通知操作必须先登录。编辑普通动态保留原始地理位置、关联板块和其它协议字段；文章、视频及特殊动态暂不能在这个编辑入口提交，避免丢失结构。没有找到可靠的评论编辑协议，所以未猜测新增评论编辑接口。评论图片仍通过现有官方上传链路，最多 9 张。

`clearNotificationCount` 的 `all` 会同时清理消息未读数，界面需要由用户明确选择。公开接口错误继续原样呈现，不使用其它接口的空结果掩盖失败。
