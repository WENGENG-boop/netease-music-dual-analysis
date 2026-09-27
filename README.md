# Netease Music Dual Analysis

后端-first 的双人听歌行为分析服务。当前实现包含 Fastify、PostgreSQL/Drizzle schema、Argon2id Cookie Session、Pair 邀请/权限/隐私过滤、Session 状态骨架、Raw Event batch 幂等接口、Provider contract、区间统计核心和 OpenAPI。

```bash
corepack enable pnpm
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build
pnpm dev
```

> `pnpm test:integration` 需要 `DATABASE_URL` 才会连接 PostgreSQL；未配置时测试会跳过，CI 中会通过 PostgreSQL 16 service 执行。

文档：`docs/`，Swagger：`/docs`，OpenAPI：`/openapi.json`。
