# 开发与发布说明

当前包名保留 `dsh-planet-news`，产品名为旅行壁纸，版本从 `package.json` 读取。安装 id 与默认数据目录沿用旧版，不能因为仓库改名就擅自迁移用户数据。

## 源码

- `index.js`：本机接口、每日任务与编排。
- `client.js`：DSH 设置页。
- `channels.js`、`vendor/subscriptions.js`：API 与独立订阅适配；上游许可不可删除。
- `skills/`：文生图、图生图与观察世界的提示词规范。
- `about-support.json`：作者明确提供并允许公开的联系方式、支持文案与素材记录。
- `scripts/sync-about-docs.mjs`：同步 README、SUPPORT 与第三方素材说明；保留 README 中对应标记。
- `docs/showcase/`：作者指定的 README 展示图压缩预览，去除原图片附带的 EXIF/XMP/文本元数据，不修改原始文件。它们随说明文档打包，不作为用户旅行图库或默认参考图。

## 检查与打包

```powershell
npm test
npm pack --ignore-scripts
```

必要检查须按当次授权范围运行。运行全套测试不代表获准真实调用模型、生图、播放音效、改变桌面或启动全面实机测试；这些需要作者明确安排。本轮文档发布整理只核对链接、许可、文件和包边界。

仓库的 `dsh.bundle.patch` 指向 `cordis.patch.yml`。不要只保留前端声明而遗漏组合包入口。`engines.dsh` 最低兼容范围尚未作跨版本验证，不应猜测一个范围冒充承诺。

## 发布边界

公开源码不得包含用户的配置、凭据、照片、旅行图库、运行日志或伊甸园未公开资料。仅包含作者本轮明确授权公开的微信号、赞赏图与指定示例。支持说明与第三方许可不是自动取得额外授权的办法。

源码许可证为 Apache-2.0，保留 LICENSE、NOTICE 和 THIRD_PARTY_NOTICES。已有 vendor 原许可原样保留。运行依赖保留其自身许可。

`.tgz` 是朋友试装和正式下载使用的包；源码 ZIP 用于审阅和更新仓库。市场申请、正式 Release 和公开仓库，等完整测试与最后确认后再进行。文档包和源 ZIP 的 SHA-256 应随交付清单记录，避免把旧版本附件当成最新源码。
