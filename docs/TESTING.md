# Testing

Quality gates:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Unit tests cover interval union/data-quality classification, API envelopes/origin guardrails, schema/migration invariants, and provider contract/SSRF guardrails.

Integration tests live under `tests/integration`. They run against PostgreSQL when `DATABASE_URL` is set and skip otherwise, allowing local Node-only checks to pass without Docker. The migration integration test creates an isolated temporary schema, runs the SQL migration twice, verifies the required domain tables, checks event idempotency constraints, and confirms system mood seeding does not create default users or passwords. Auth/Pair/Privacy integration tests cover Argon2id storage, strict cookies, expired sessions, hashed single-use invite tokens, concurrent invite acceptance, pair membership authorization, private-session filtering, summary redaction, and audit-log coverage.

GitHub Actions provides PostgreSQL 16 and executes lint, typecheck, unit tests, integration tests, and build on `main`, Arena branches, and pull requests.
