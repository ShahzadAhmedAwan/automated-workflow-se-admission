# Auth module contract

Auth owns `sys_users`, `sys_roles`, `sys_permissions`, user-role grants, refresh sessions, and the auth routes. Other modules may import only `authenticate`, `requirePermission`, and permission constants from `index.js`; do not reach into the Auth service or tables for authorization decisions.

## Routes

- `POST /api/v1/auth/login` — email/password; returns access token and user grant summary, sets refresh and CSRF cookies.
- `POST /api/v1/auth/refresh` — requires refresh cookie plus matching `csrf_token` cookie and `X-CSRF-Token` header; rotates session and access token.
- `POST /api/v1/auth/logout` — CSRF protected; revokes the refresh-token family and its access sessions.
- `GET /api/v1/auth/me` — current user and current permission grants.
- `POST /api/v1/auth/change-password` — current password required; revokes the user's sessions.
- `GET/POST /api/v1/auth/users` and `PATCH /api/v1/auth/users/:userId` — user list/create/update, protected by `users.manage`.
- `GET /api/v1/auth/roles` — role definitions and registered permissions, protected by `users.manage`.

Use permission keys such as `verification.documents.review` on module routes. Role names are UI labels and policy groupings; route authorization must always be checked against permissions in the database.
