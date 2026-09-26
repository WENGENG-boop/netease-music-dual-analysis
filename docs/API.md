# API

All versioned endpoints are under `/api/v1` and return `{success,data}` or `{success:false,error:{code,message}}`. Authentication is HttpOnly SameSite Strict cookie. Implemented: register/login/logout/me, pair creation, session creation/get/end, event batch, health/readiness, Swagger.
