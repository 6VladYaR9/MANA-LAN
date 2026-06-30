# Audit Fixes Design

## Goal

Fix every issue found in the audit while keeping the project deployable after each merge. The work will be delivered as a sequence of small pull requests, each with tests and CI validation, instead of one large cross-cutting change.

## Current Baseline

The repository now has a CI foundation:

- root, server, and client lockfiles;
- `npm run ci:install`;
- `npm run verify`;
- GitHub Actions `CI / Verify` on `main` and pull requests.

There are still no behavior tests for the server or client. The audit fixes must add the test harnesses needed to prove the fixed behavior.

## Delivery Order

### 1. Security Boundary

Fix the highest-risk trust boundary issues first:

- production must not silently use public default admin credentials;
- admin login must be rate-limited enough to prevent trivial brute force and event-loop abuse;
- admin chat updates must only go to verified admin sockets;
- password-protected rooms must require server-side authorization for `room:get`, room chat reads, room chat sends, and room updates;
- result screenshot upload and replacement must require admin or verified room participant authorization and valid match stage;
- production host and CORS defaults must be explicit and documented.

This PR adds server-side tests for the protected Socket.IO flows.

### 2. Player Session Reconnect

Replace `socket.id` as the durable player identity:

- issue a per-room `playerSessionId` when a player joins;
- store the session id client-side;
- let reconnecting or refreshed clients reclaim the same player slot;
- rejoin the Socket.IO room and refresh room state on `connect`;
- keep captain control stable across refresh and transient LAN disconnects.

This PR adds server and client tests for reconnect/reclaim behavior.

### 3. Veto And UI Contract

Align frontend controls with server authority:

- `Veto.tsx` must use `room.captains[team]` instead of first-slot captain inference;
- disable or hide controls according to the same permissions enforced by the server;
- keep captain transfer behavior consistent through lobby, veto, live, and finished stages.

This PR adds focused frontend tests for captain transfer and veto button availability.

### 4. Durable State

Add a first production-safe persistence layer before Timeweb deployment:

- use a JSON snapshot/journal stored under a configurable data directory;
- persist rooms, server reservations, chats, past tournaments, maintenance mode, and admin logs;
- restore state at server startup;
- write state after mutating operations;
- keep admin sessions in memory unless a later scaling requirement needs shared sessions.

JSON persistence is the first target because the deployment is a single Node.js process on one VPS. It has fewer moving parts than SQLite/Postgres and is enough for LAN tournament continuity. The design should keep persistence isolated so a database backend can replace it later.

### 5. Bracket Source Of Truth

Move bracket state out of browser-only `localStorage`:

- load the public bracket from the backend;
- let admin edits persist server-side;
- broadcast bracket updates over Socket.IO;
- use `localStorage` only as optional draft/cache, not as public source of truth;
- keep Google Sheets import path, but make it timeout- and cache-safe.

This PR adds tests for bracket API/source behavior and frontend smoke tests for loading server data.

### 6. Reliability And Deploy Readiness

Close the remaining operational gaps:

- add Google Sheets fetch timeout and last-good cache;
- add or expand test scripts so CI runs behavior tests plus build;
- document required production env vars;
- add Timeweb deployment workflow or scripts after server details and CLI auth are available;
- keep deploy secrets in GitHub/Timeweb secrets, never in repository files.

## Testing Strategy

Tests are added alongside the PR that needs them:

- server Socket.IO/API tests for auth, room privacy, admin chat, screenshots, reconnect, persistence, and bracket state;
- frontend tests for password gate, reconnect UI, captain/veto UI, and screenshot controls;
- `npm run verify` evolves from build-only to test-plus-build once test scripts exist.

Every PR must:

- add a failing regression test before changing production behavior;
- pass `npm run ci:install`;
- pass `npm run verify`;
- pass GitHub Actions.

## Non-Goals

- No Timeweb credentials, server IPs, or tokens are committed.
- No multi-process scaling until the single-process VPS deployment is working.
- No full database migration unless JSON persistence proves insufficient.
- No broad visual redesign while security and deployment stability are being fixed.

## Success Criteria

The audit is considered fully addressed when:

- each finding has a merged PR or an explicit documented deferral;
- CI runs server/client behavior tests and build;
- a process restart does not lose tournament-critical state;
- passworded rooms, admin chat, screenshots, admin login, reconnect, veto controls, and bracket edits behave correctly in tests;
- Timeweb deployment has a documented, repeatable path.
