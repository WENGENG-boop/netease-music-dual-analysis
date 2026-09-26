# 后端实施计划

## 目标与原则

本计划只覆盖后端、数据库、Provider、统计引擎、测试、Docker 和 API 文档，不开发前端。

不可破坏的领域规则：

1. Mood 属于 Session，不属于歌曲。
2. Heart 属于 Session + Track，不是永久喜欢。
3. 每一次独立播放都必须创建 PlaybackInstance。
4. Raw Events 是唯一事实源，所有 Analytics 可删除并重算。
5. 网易云只是 Provider，业务层不依赖网易云响应结构。

每个阶段必须执行：

```text
实现 → 单元测试 → 集成测试 → 代码审查 → 修复 → 再测试
```

阶段未通过质量门禁，不进入下一阶段。

---

## 阶段 0：工程基线与质量门禁

### 工作项

- 固定 Node.js 22、pnpm、TypeScript 配置
- 完成 ESLint、TypeScript strict、Vitest 配置
- 统一 API Response 和 Error Response
- 增加 requestId、错误处理和 Pino redact
- 完成 Docker Compose 基础环境
- 建立 PostgreSQL integration test 环境
- 建立 GitHub Actions CI

### 验收标准

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
docker compose up
```

全部通过。

---

## 阶段 1：领域模型、数据库和 Migration

### 数据表

完成并保持 Drizzle Schema 与 SQL Migration 一致：

- users
- pair_spaces
- pair_members
- pair_invites
- moods
- playlists
- playlist_snapshots
- playlist_snapshot_tracks
- tracks
- provider_tracks
- artists
- track_artists
- albums
- music_connections
- provider_authorization_attempts
- listening_sessions
- session_queue_items
- playback_instances
- listening_events
- event_batches
- session_track_reactions
- playback_instance_stats
- session_track_stats
- session_summaries
- auth_sessions
- audit_logs
- playback_tokens
- provider_cache

### 约束

- UUID 内部主键
- Provider ID 只能作为 ProviderTrack 外部标识
- Session Mood 保存 snapshot
- Session 保存 playlistSnapshotId
- `UNIQUE(session_id, seq)`
- `UNIQUE(session_id, batch_id)` 只放在 event_batches
- `UNIQUE(session_id, track_id)`
- Pair active member 最多两人
- 所有时间使用 UTC
- coverageRatio 使用精确 numeric 或明确的 basis points
- Raw Event append-only

### 验收标准

- 空数据库可以执行 Migration
- Migration 可重复执行
- Schema 与 Migration 结构一致
- Seed 只创建系统 Mood，不创建生产默认密码
- Migration integration test 通过

---

## 阶段 2：身份、Pair 和隐私权限

### API

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
POST /api/v1/pairs
POST /api/v1/pairs/:id/invite
POST /api/v1/pairs/invite/:token/accept
```

### 工作项

- Argon2id
- HttpOnly、Secure、SameSite=Strict Cookie
- Session 过期检查
- Origin Validation / CSRF 防护
- Pair 成员中间件
- Pair 成员数量并发锁
- Pair 资源统一授权
- private / summary / full 查询过滤
- 重要动作写 Audit Log

### 验收标准

- 非成员不能读写 Pair 数据
- 私有 Session 不进入对方 Couple Analytics
- 邀请 Token 单次使用、Hash 存储、过期失效
- 并发接受邀请不会超过两个成员
- 认证和权限集成测试通过

---

## 阶段 3：Provider 抽象与网易云接入

### Provider Contract

实现并测试：

```text
capabilities
resolveShareLink
getPlaylist
getPlaylistTracks
getTrack
getTracks
getLyrics
getPlayback
beginAuthorization
pollAuthorization
refreshAuthorization
revokeAuthorization
getUser
getUserPlaylists
getLikedTracks
```

### Provider

- MockMusicProvider：只用于测试
- NeteaseEnhancedProvider：当前可运行 MVP
- NeteaseOfficialProvider：明确 NOT_CONFIGURED，不虚构接口
- Provider 工厂：enhanced / official / hybrid
- Provider Capability
- 标准 PlaybackDescriptor
- 标准 Provider 错误
- Timeout
- 仅 GET-like 请求 Retry
- 指数退避
- Rate Limit
- Circuit Breaker

### 安全

- 网易云 Enhanced 只走私网
- 禁止 `/song/url/match`
- 禁止跨平台替代音源
- 分享链接 Host Allowlist
- 每次 Redirect 重新检查 Host
- 最多 3 次 Redirect
- 禁止 localhost、127/8、RFC1918、file、ftp

### 验收标准

所有 Provider Contract Tests 通过；Provider 不可用时历史 Session 和 Analytics 仍能正常访问。

---

## 阶段 4：Playlist、Catalog 和快照

### API

```text
POST /api/v1/playlists/import
POST /api/v1/playlists/:id/sync
GET  /api/v1/playlists/:id
GET  /api/v1/playlists/:id/snapshots
```

### 工作项

- 分享文本、完整 URL、数字 ID 解析
- Playlist 当前状态
- Provider Track 映射到内部 Track
- Artist / Album 关联
- Metadata 保留 provider、providerUpdatedAt、fetchedAt
- Track metadata 不覆盖来源
- SHA-256 contentHash
- 内容未变化不创建 Snapshot
- 内容变化 version + 1
- Snapshot Track position 固化

### 验收标准

歌单从 A B C D 变成 A C E F 后，历史 Session 仍可通过旧 Snapshot 复现原始上下文。

---

## 阶段 5：Music Connection、授权和 Playback Gateway

### API

```text
POST   /api/v1/music-connections/netease/authorization
GET    /api/v1/music-connections/netease/authorization/:id
DELETE /api/v1/music-connections/netease
POST   /api/v1/playback/resolve
GET    /api/v1/playback/:playbackToken
```

### 工作项

- QR / Official Authorization 状态统一映射
- AES-256-GCM 凭据加密
- credentialVersion
- 密钥轮换预留
- Provider Cookie / Token 不进日志
- Playback Token 短 TTL
- Token 绑定 user、pair、session、track、connection
- 默认 302 Redirect
- 不下载、不落盘、不缓存完整音频
- Playback Cache 按 Provider、Track、Connection、Quality 隔离

### 验收标准

- 用户 A 不能使用用户 B 的 Playback Token
- Provider 返回错误统一映射
- 音频 URL 不进入数据库长期字段
- 连接失效不影响历史分析

---

## 阶段 6：Session、Queue 和 PlaybackInstance

### API

```text
POST /api/v1/sessions
POST /api/v1/sessions/:id/start
POST /api/v1/sessions/:id/end
POST /api/v1/sessions/:id/abandon
POST /api/v1/sessions/:id/playback-instances
PATCH /api/v1/playback-instances/:id/end
GET /api/v1/sessions/:id
```

### 工作项

- CREATED → ACTIVE → ENDING → ENDED
- ACTIVE → ABANDONED
- 同一 User 只能一个 ACTIVE Session
- 数据库并发约束
- Shuffle 创建时固化实际 Queue
- Queue 保存 trackId、queueIndex、sourcePosition
- PlaybackInstance sequence
- startedBy
- selectionSource
- endedReason
- Session 创建不复制旧 Heart
- Mood 创建后不可修改

### 验收标准

同一歌曲在同一 Session 中播放三次，得到三个不同 PlaybackInstance；重叠 Session 被拒绝；旧 Playlist 修改不改变历史 Session。

---

## 阶段 7：Raw Events、Reaction 和完整幂等

### API

```text
POST /api/v1/events/batch
POST /api/v1/sessions/:id/reactions
GET  /api/v1/sessions/:id/reactions
```

### 工作项

- 事件类型白名单
- session / user / pair 校验
- PlaybackInstance 所属校验
- Track 一致性校验
- duration + tolerance 校验
- clientWallTime 合理范围
- clientMonotonicMs
- seq 正数和顺序规则
- batch size 限制
- 事务写入 event_batches 和 events
- 并发重复 Batch
- Session End 与最后 Batch 并发
- `heart_on` / `heart_off`
- session_track_reactions 最终状态和 toggleCount

### 验收标准

重复发送同一 Batch 不增加任何统计；半批失败整体回滚；非法事件不进入数据库；新 Session Heart 初始为空。

---

## 阶段 8：Analytics Engine

### 算法模块

- event-rebuilder
- playback-instance
- intervals
- session-track
- session-summary
- pair

### 规则

- Play / Pause 状态重建
- Heartbeat 连续性判断
- 5 秒 Heartbeat
- POSITION_DRIFT_TOLERANCE=1500
- Buffering 不计入有效听歌
- Seek 产生新区间，不计算跳过内容
- Total Listen additive
- Coverage interval merge
- naturalCompleted 独立于 coverage
- early skip
- manual next / previous / track select 分类
- replay / return
- effectiveListenMs >= 2s
- analyticsVersion

### 验收标准

固定 Fixtures 必须验证：

```text
seek
replay
pause
early_skip
buffering
page_close
duplicate_events
```

必须满足：

```text
coveredMs <= durationMs
coverageRatio ∈ [0,1]
totalListenMs >= coveredMs
skipCount >= earlySkipCount
重复事件不会增加 listening time
```

---

## 阶段 9：后台任务和生命周期

### pg-boss Jobs

```text
aggregate-session
close-abandoned-session
refresh-provider-authorization
sync-playlist
recalculate-analytics
cleanup-expired-playback-token
cleanup-auth-attempt
```

### 工作项

- Session End 写 session_end
- 状态置为 ENDING
- 后台聚合 Stats
- 聚合完成后置 ENDED
- lastEventAt 超时标记 ABANDONED
- Abandoned 也执行统计
- Job 幂等
- Job 重试和失败记录
- Provider Down 不影响 Analytics 查询

### 验收标准

Session End API 不等待复杂聚合，但最终可查询到 ENDED 和完整 Summary。

---

## 阶段 10：Analytics API 和隐私过滤

### API

```text
GET /api/v1/analytics/me/moods/:moodId
GET /api/v1/analytics/tracks/:trackId/history
GET /api/v1/analytics/pair/shared-hearts
GET /api/v1/analytics/pair/shared-high-retention
GET /api/v1/analytics/pair/mood-overlap
GET /api/v1/analytics/pair/track-contrast
GET /api/v1/analytics/pair/timeline
```

### 工作项

- mean / median
- sampleSize
- sessionCount
- playCount
- dataQuality
- day / week / month bucket
- timezoneSnapshot
- localStartedDate
- Couple Analytics 只查询 summary / full
- 不做心理结论和 AI 判断

### 验收标准

对方无法通过 API、参数或统计聚合间接读取 private Session。

---

## 阶段 11：数据导出、删除和安全加固

### API

```text
GET    /api/v1/me/export
DELETE /api/v1/me/data
GET    /api/v1/internal/provider-health
```

### 工作项

- JSON Export
- 删除用户自己的 Credential
- 删除自己的 Session、Events、Reactions
- 共享 Playlist Metadata 按引用保留
- 审计删除行为
- Secret Redaction Test
- SSRF Test
- Rate Limit Test
- Body Limit Test
- CORS / Origin Test
- 权限越权测试

---

## 阶段 12：完整测试与发布门禁

### 测试类型

- Unit Tests
- Provider Contract Tests
- Golden Fixtures
- Property Tests
- Concurrency Tests
- Failure Injection
- PostgreSQL Integration Tests
- 完整 E2E
- Migration Validation
- Docker Smoke Test

### E2E 主流程

```text
创建 User A/B
→ 创建 Pair
→ 邀请 B
→ 登录 A
→ 导入 Playlist
→ 生成 Snapshot
→ 创建 Sad Session
→ 固化 Queue
→ 创建 PlaybackInstance
→ Heartbeat
→ Seek
→ Pause
→ Skip
→ 第二个 PlaybackInstance
→ Heart B
→ 返回 A
→ End Session
→ Worker 聚合
→ Session Summary
→ Mood Analytics
→ Pair Analytics
→ Export
→ Delete
```

### 最终命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm db:migrate
docker compose up -d
pnpm test:integration
pnpm test
```

只有全部通过，才标记后端完成。
