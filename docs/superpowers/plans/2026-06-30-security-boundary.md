# Security Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the audit's high-risk authentication, protected-room, admin-chat, screenshot-upload, and production-startup bypasses.

**Architecture:** Add Socket.IO integration tests that start the real server on ephemeral localhost ports. Enforce access on the server with admin sessions, an admin Socket.IO room, short-lived room access tokens, participant checks, and production startup guards. Update the React client to store only opaque room tokens and to present a direct-link password gate.

**Tech Stack:** Node.js 24, Express, Socket.IO, `node:test`, `socket.io-client`, React 18, Vite, TypeScript.

---

### Task 1: Security Integration Tests

**Files:**
- Modify: `package.json`
- Modify: `server/package.json`
- Modify: `server/package-lock.json`
- Create: `server/test/security-boundary.test.js`

- [x] **Step 1: Add server test command and dependency**

Run:

```bash
npm install --prefix server --save-dev socket.io-client
```

Expected package scripts:

```json
{
  "verify": "npm test --prefix server && npm run build",
  "server:test": "node --test test/*.test.js"
}
```

- [x] **Step 2: Write RED integration tests**

Create `server/test/security-boundary.test.js` with tests for:
- production refusing bundled admin credentials
- production refusing wildcard `CLIENT_URL=*`
- production refusing missing `client/dist/index.html`
- protected room state/chat requiring `roomAccessToken`
- admin chat updates reaching only authenticated admins
- screenshot upload requiring live/finished participant/admin access, with replacements admin-only
- admin login rate limiting

- [x] **Step 3: Verify RED**

Run:

```bash
npm test --prefix server -- --test-reporter=spec
```

Expected: failures on the old code for every listed boundary.

### Task 2: Server Boundary Guards

**Files:**
- Modify: `server/auth.js`
- Modify: `server/server.js`
- Modify: `server/roomManager.js`
- Modify: `.env.example`
- Modify: `server/.env.example`
- Modify: `README.md`
- Modify: `DEPLOY_TIMEWEB.md`

- [x] **Step 1: Add production admin validation**

`server/auth.js` exports `validateAdminConfig()`. `server/server.js` calls it after `loadDotEnv()`. Production throws when admin login/hash/salt are missing or equal bundled defaults.

- [x] **Step 2: Add admin login limiter**

`server/server.js` tracks invalid attempts by socket address and login, using `ADMIN_LOGIN_MAX_ATTEMPTS` and `ADMIN_LOGIN_WINDOW_MS`.

- [x] **Step 3: Isolate admin chat**

Authenticated admins join the `admins` Socket.IO room. Admin chat update events use `io.to('admins')`.

- [x] **Step 4: Add room access tokens**

`room:checkPassword`, `room:join`, and `rooms:create` return `roomAccessToken`. `room:get`, `chat:room:get`, and `chat:room:send` require admin, participant, unprotected room, or valid token.

- [x] **Step 5: Gate screenshot upload**

`match:uploadScreenshot` requires `live`/`finished` stage plus admin or current participant. `replaceIndex` requires admin.

- [x] **Step 6: Add production runtime guards**

Production rejects wildcard CORS and missing client build. `HOST` is configurable and defaults to `127.0.0.1` in production. Public summaries mask server/GOTV/screenshot details for locked rooms.

- [x] **Step 7: Verify GREEN**

Run:

```bash
npm test --prefix server -- --test-reporter=spec
```

Expected: all server security tests pass.

### Task 3: Client Room Access Flow

**Files:**
- Create: `client/src/roomAccess.ts`
- Modify: `client/src/components/Hub.tsx`
- Modify: `client/src/components/Room.tsx`
- Modify: `client/src/components/RoomChat.tsx`

- [x] **Step 1: Add room token utility**

`client/src/roomAccess.ts` stores tokens under `room-access-token:<roomId>`.

- [x] **Step 2: Store tokens instead of passwords**

`Hub.tsx` stores `response.roomAccessToken` after password checks and room creation.

- [x] **Step 3: Add direct URL password gate**

`Room.tsx` sends `adminToken` and `roomAccessToken` to `room:get`. On `ROOM_PASSWORD_REQUIRED`, it renders a password form, stores the returned token, and retries loading.

- [x] **Step 4: Pass room token to protected actions**

`RoomChat.tsx` and screenshot upload payloads include `roomAccessToken`.

- [x] **Step 5: Hide unauthorized upload/replace controls**

`MatchControl` accepts `currentPlayer`. Admins and participants may upload; only admins may replace screenshots.

- [x] **Step 6: Build**

Run:

```bash
npm run build --prefix client
```

Expected: TypeScript and Vite build pass.

### Task 4: Full Verification and PR

**Files:**
- All changed files above.

- [x] **Step 1: Full local verification**

Run:

```bash
npm run verify
```

Expected: server tests pass and client build passes.

- [ ] **Step 2: Commit, PR, CI, merge**

Run:

```bash
git add .
git commit -m "fix security boundary"
git push -u origin codex/security-boundary
gh pr create --title "[codex] fix security boundary" --body "<summary and tests>"
gh pr checks <PR_NUMBER> --watch --interval 10
gh pr merge <PR_NUMBER> --merge --delete-branch
```

Expected: GitHub CI is green and the branch is merged to `main`.

## Self-Review

- Spec coverage: default admin credentials, brute-force limiting, admin chat broadcast scope, protected room state/chat, screenshot authorization/stage gating, HOST/CORS production guards, missing client build guard, protected public summaries, deploy docs, and direct-link password flow.
- Deferred by design: durable state, reconnect/session identity, Veto captain UI, bracket backend source, Google Sheets timeout/cache, and wider Timeweb automation.
- Placeholder scan: no TBD/TODO/implement-later placeholders.
