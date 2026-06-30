# State Bracket Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist runtime state across restarts, move bracket editor state to the backend, and make Google Sheets bracket fetches timeout/cache safely.

**Architecture:** Add an atomic JSON state store under `DATA_DIR`/`STATE_FILE` and hydrate `RoomManager` from it. Save after state-changing socket events. Store bracket editor state in `RoomManager` and expose it through admin-protected Socket.IO events. Add fetch timeout plus stale-cache fallback to `server/services/bracketSource.js`.

**Tech Stack:** Node.js 24, Socket.IO, `node:test`, React 18, TypeScript.

---

### Task 1: Persistence RED Test

**Files:**
- Create: `server/test/state-store.test.js`

- [x] Write a test that starts the server with a temp `DATA_DIR`, creates a room, stops, restarts with the same `DATA_DIR`, and confirms the room is still in `rooms:get`.
- [x] Run `npm test --prefix server -- --test-reporter=spec`; expect the new test to fail before implementation.

### Task 2: JSON State Store

**Files:**
- Create: `server/services/stateStore.js`
- Modify: `server/roomManager.js`
- Modify: `server/server.js`
- Modify: `server/.env.example`
- Modify: `DEPLOY_TIMEWEB.md`

- [x] Add atomic JSON load/save with test-mode disable unless `DATA_DIR` or `STATE_FILE` is set.
- [x] Hydrate rooms, chats, logs, maintenance, past tournaments, and bracket state into `RoomManager`.
- [x] Save state after room, player, match, chat, maintenance, past tournament, bracket, and disconnect mutations.
- [x] Verify the persistence test turns green.

### Task 3: Backend Bracket Editor State

**Files:**
- Modify: `server/roomManager.js`
- Modify: `server/server.js`
- Modify: `client/src/App.tsx`
- Modify: `client/src/pages/TournamentBracket.tsx`

- [x] Add `bracket:get`, `bracket:save`, and `bracket:reset`; save/reset require admin.
- [x] Pass `adminToken` into `TournamentBracket`.
- [x] Load bracket editor state from backend, save admin edits to backend, listen for `bracket:update`, and stop using `localStorage` as source of truth.
- [x] Fetch `/api/bracket` for source metadata so the page reflects backend source/cache status.

### Task 4: Google Sheets Timeout And Cache

**Files:**
- Modify: `server/services/bracketSource.js`
- Modify: `server/.env.example`

- [x] Add `BRACKET_FETCH_TIMEOUT_MS` and `BRACKET_CACHE_TTL_MS`.
- [x] Use `AbortController` for fetch timeout.
- [x] Return fresh cache within TTL and stale cache on fetch failure before falling back.

### Task 5: Verification And PR

- [x] Run `npm run verify`.
- [ ] Commit, push, open PR, wait for CI, merge after green.

## Self-Review

- Spec coverage: durable state, backend bracket edits, `/api/bracket` usage, and Sheets timeout/cache.
- Deferred by design: full Timeweb CLI automation and richer database storage.
- Placeholder scan: no TBD/TODO/implement-later placeholders.
