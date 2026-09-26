# Netease Music Dual Analysis

后端-first 的双人听歌行为分析服务。当前实现包含 Fastify、PostgreSQL/Drizzle schema、Argon2id Cookie Session、Pair/Session 状态约束、Raw Event batch 幂等接口、Provider contract、区间统计核心和 OpenAPI。

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm test && pnpm typecheck && pnpm build
pnpm dev
```

文档：`docs/`，Swagger：`/docs`，OpenAPI：`/openapi.json`。
