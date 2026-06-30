# Player Session And Veto Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a player attached to their slot across socket reconnects and make the Veto UI use the same captain contract as the backend.

**Architecture:** Add an opaque per-room player session token returned from `room:join`. The backend can resume a player from that token during `room:get`, updating the player's active `socketId` and `connected` flag. The frontend stores the token in `sessionStorage`, includes it in room load and player actions, and Veto derives captain from `room.captains` instead of first slot.

**Tech Stack:** Node.js 24, Socket.IO, `node:test`, `socket.io-client`, React 18, TypeScript.

---

### Task 1: Reconnect RED Test

**Files:**
- Create: `server/test/player-session.test.js`

- [ ] **Step 1: Write failing reconnect test**

Create a Socket.IO integration test that:
- starts the server on an ephemeral port
- creates a 1v1 Dota room as admin
- joins player A and captures `playerSessionToken`
- disconnects player A
- connects a new socket and calls `room:get` with the token
- asserts the same player id is still in slot A, has the new `socketId`, and can toggle ready

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test --prefix server -- --test-reporter=spec
```

Expected: the new test fails because `room:join` does not return `playerSessionToken` and lobby disconnect removes the player immediately.

### Task 2: Backend Player Sessions

**Files:**
- Modify: `server/server.js`
- Modify: `server/roomManager.js`

- [ ] **Step 1: Add player session store**

In `server/server.js`, add `playerSessions` map plus helpers to grant, validate, and resume player sessions. Tokens expire after the same 12-hour window as room access.

- [ ] **Step 2: Return token from join**

`room:join` returns `playerSessionToken` and remembers it on `socket.data`.

- [ ] **Step 3: Resume on room get**

`room:get` accepts `playerSessionToken`; when valid, it updates the stored player's `socketId` to the current socket, sets `connected=true`, joins the socket room, and grants protected-room access.

- [ ] **Step 4: Keep lobby slots during disconnect**

`RoomManager.handleDisconnect()` marks players disconnected in all stages instead of removing lobby players immediately. Explicit `player:leaveSlot` still frees the slot.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test --prefix server -- --test-reporter=spec
```

Expected: security-boundary tests and player-session tests pass.

### Task 3: Client Session Token And Veto UI

**Files:**
- Create: `client/src/playerSession.ts`
- Modify: `client/src/components/Room.tsx`
- Modify: `client/src/components/Veto.tsx`

- [ ] **Step 1: Add player token utility**

`client/src/playerSession.ts` stores tokens under `player-session-token:<roomId>`.

- [ ] **Step 2: Use token in Room**

`Room.tsx` stores `response.playerSessionToken` after join, includes `playerSessionToken` in `room:get`, and reloads room state on socket reconnect.

- [ ] **Step 3: Use backend captain contract in Veto**

`Veto.tsx` resolves the captain from `room.captains[team]` first and only falls back to slot order for legacy rooms.

- [ ] **Step 4: Build**

Run:

```bash
npm run build --prefix client
```

Expected: TypeScript and Vite build pass.

### Task 4: Full Verification And PR

**Files:**
- All changed files above.

- [ ] **Step 1: Full verification**

Run:

```bash
npm run verify
```

Expected: all server tests pass and the frontend builds.

- [ ] **Step 2: Commit, PR, CI, merge**

Run:

```bash
git add .
git commit -m "fix player session reconnect"
git push -u origin codex/player-session-veto
gh pr create --title "[codex] fix player session reconnect" --body "<summary and tests>"
gh pr checks <PR_NUMBER> --watch --interval 10
gh pr merge <PR_NUMBER> --merge --delete-branch
```

Expected: PR is merged into `main` after green CI.

## Self-Review

- Spec coverage: player identity survives reconnect, socket id updates on resume, slot is not lost on lobby disconnect, and Veto UI follows `room.captains`.
- Deferred by design: durable persistence and long-term stale-slot cleanup belong to the durable-state PR.
- Placeholder scan: no TBD/TODO/implement-later placeholders.
