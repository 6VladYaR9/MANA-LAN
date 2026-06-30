# Edge Case Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development when tasks can be delegated safely, or superpowers:executing-plans for tightly coupled edits. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all remaining deep-audit edge cases before Timeweb deployment.

**Architecture:** Harden the existing Node/Socket.IO server with revocable room/admin memberships, save-before-ack mutation helpers, validated image/asset persistence, explicit production state configuration, and small frontend guards for stale acknowledgements and auth drift.

**Tech Stack:** Node.js 24, Socket.IO, `node:test`, React 18, TypeScript.

---

### Task 1: Baseline And Red Tests

**Files:**
- Modify/create focused files under `server/test/`

- [ ] Run the current baseline: `npm run verify`.
- [ ] Add failing regression tests for admin/socket revocation, locked-room redaction, password rate limit/hash behavior, stale player sessions, safe asset markers, missing asset handling, image validation, production state config, and save-before-ack behavior.
- [ ] Run focused server tests and confirm the new tests expose current failures before implementation.

### Task 2: Socket Auth And Session Revocation

**Files:**
- Modify: `server/server.js`
- Modify: `server/roomManager.js`

- [ ] Track or validate admin/private-room membership at emit time.
- [ ] Remove admin sockets from `ADMIN_ROOM` on logout and expiry.
- [ ] Stop protected `room:update` emissions to sockets whose room/player/admin authorization is no longer valid.
- [ ] Revoke player sessions on leave, room deletion, and invalid resume attempts.
- [ ] Keep public unlocked-room reads working when a stale player token is present.

### Task 3: Passwords, Rate Limits, And Proxy Trust

**Files:**
- Modify: `server/server.js`
- Modify: `server/roomManager.js`
- Modify: `server/.env.example`
- Modify: `.env.example`
- Modify: `DEPLOY_TIMEWEB.md`
- Modify: `Caddyfile.example`

- [ ] Store new room passwords as salted hashes while accepting legacy plaintext persisted rooms.
- [ ] Add per-room password check rate limiting.
- [ ] Use an explicit trusted-proxy setting before honoring forwarded client IP headers.
- [ ] Document Timeweb/Caddy proxy trust and deployment env vars.

### Task 4: Persistence, Assets, And Images

**Files:**
- Modify: `server/services/stateStore.js`
- Modify: `server/roomManager.js`
- Modify: `server/server.js`

- [ ] Save before success acknowledgements for durable room/player/match/chat/bracket/tournament mutations.
- [ ] Return error acknowledgements on persistence failure instead of silently succeeding.
- [ ] Validate uploaded chat and screenshot data URLs by decoded bytes, supported magic bytes, and size.
- [ ] Constrain asset markers to the configured assets directory.
- [ ] Fail closed or preserve state when asset files are missing instead of silently deleting references.
- [ ] Require explicit `DATA_DIR` or `STATE_FILE` in production and expose the resolved state path in health/logs.

### Task 5: Frontend Race And Recovery Guards

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/Room.tsx`
- Modify: `client/src/pages/TournamentBracket.tsx`
- Modify: `client/src/pages/Hub.tsx`
- Modify: `client/src/pages/PastTournaments.tsx`
- Modify helper files if a local socket ack utility already exists or is worth adding.

- [ ] Ignore stale `room:get` responses after route changes or newer requests.
- [ ] Clear admin state on storage changes, reconnect auth failures, and protected-action auth errors.
- [ ] Add timeout/pending guards to socket forms that wait for acknowledgements.
- [ ] Keep bracket `activeTab` local-only and make bracket load failure recoverable.
- [ ] Fix mojibake and add visible fallback behavior for initial load failures and unsafe tournament image sources.

### Task 6: Verification, Review, And Merge

- [ ] Re-run all focused server tests.
- [ ] Run `npm run verify`.
- [ ] Run `git diff --check`.
- [ ] Dispatch independent review agents for server security, persistence/assets, and frontend edge cases.
- [ ] Address review findings.
- [ ] Commit, push, open PR, wait for CI, and merge after green.

## Self-Review

- Spec coverage: every high, medium, and low audit finding is mapped to a task.
- TDD coverage: server-critical behavior is covered by regression tests before implementation.
- Scope check: deployment docs/config are included, but secrets and live Timeweb operations remain out of scope until credentials are provided.
- Placeholder scan: no TBD/TODO/implement-later placeholders.
