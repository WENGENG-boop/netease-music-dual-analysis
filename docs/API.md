# API

All versioned endpoints are under `/api/v1` and return a unified envelope:

```json
{ "success": true, "requestId": "...", "data": {} }
```

Errors return:

```json
{ "success": false, "requestId": "...", "error": { "code": "...", "message": "..." } }
```

Authentication uses an HttpOnly SameSite=Strict cookie. Cookies are marked Secure in production. Unsafe API methods validate `Origin` when `CORS_ORIGIN` is configured.

Implemented endpoints:

```text
GET  /health
GET  /ready
GET  /openapi.json
GET  /docs

POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me

POST /api/v1/pairs
GET  /api/v1/pairs/:id
GET  /api/v1/pairs/:id/sessions
POST /api/v1/pairs/:id/invite
POST /api/v1/pairs/invite/:token/accept

POST  /api/v1/sessions
POST  /api/v1/sessions/:id/start
POST  /api/v1/sessions/:id/end
POST  /api/v1/sessions/:id/abandon
GET   /api/v1/sessions/:id
POST  /api/v1/sessions/:id/playback-instances
PATCH /api/v1/playback-instances/:id/end

POST /api/v1/events/batch
POST /api/v1/sessions/:id/reactions   # writes a heart_on / heart_off raw event plus projection
GET  /api/v1/sessions/:id/reactions
```

Session reads apply Pair membership checks. Another pair member cannot read `private` sessions; `summary` sessions return a redacted public session summary plus aggregated summary when available; `full` sessions return full session context. Pair session listing applies the same visibility filter and omits the other member's private sessions entirely.
