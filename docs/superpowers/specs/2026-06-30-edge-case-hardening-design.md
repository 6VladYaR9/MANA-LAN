# Edge Case Hardening Design

## Goal

Close the remaining deep-audit edge cases before Timeweb deployment. The site must fail closed around auth and private rooms, preserve state safely, avoid stale frontend state after navigation or auth changes, and expose enough production configuration to deploy intentionally.

## Current Baseline

The repository already has CI, server behavior tests, player session reconnect support, JSON persistence, and backend bracket state. The latest audit found gaps around token revocation, save ordering, image and asset validation, private-room redaction, stale frontend acknowledgements, and production deployment defaults.

## Recommended Approach

Ship one focused hardening branch with regression tests first. The changes are cross-cutting but belong together because they share the same trust and durability boundaries:

- Socket.IO authorization must be checked at emit time, not only at join time.
- State mutations must only acknowledge success after persistence succeeds.
- Uploaded and persisted image data must be validated before entering live state.
- Frontend socket acknowledgements must be guarded against late responses and timeouts.
- Production must require explicit data/config paths instead of silently using development defaults.

This is safer than splitting every audit item into a separate PR because several fixes touch the same server helpers and tests. It is still bounded: no database migration, no visual redesign, no Timeweb credentials, and no multi-process scaling.

## Backend Security Design

Admin and private-room sockets will be treated as revocable memberships. Admin logout, admin token expiry, deleted room access tokens, and invalid player sessions must remove or stop serving affected sockets. Broadcast helpers must re-check access before sending private `room:update` payloads.

Room passwords will be stored as salted hashes for new rooms, with legacy plaintext verification retained only for already-persisted state. Password checks and admin login checks will use rate limiting keyed by a trusted client IP helper that can honor reverse-proxy headers only when explicitly enabled.

Locked public rooms will return redacted metadata: enough to show that a room exists and requires a password, but not tournament-sensitive team names, maps, score, winner, or player lists.

## Persistence And Asset Design

State-changing handlers will save before acknowledging success where the client depends on the mutation being durable. On save failure, handlers must return an error acknowledgement instead of telling the client the change succeeded.

Image uploads will be decoded and checked by bytes, MIME family, and size instead of trusting a data URL prefix. Persisted image assets will use constrained markers under the configured assets directory. During hydration, path traversal markers and missing asset files must not be silently dropped and overwritten as valid state.

Production startup will require an explicit state location through `DATA_DIR` or `STATE_FILE`; health/log output will include the resolved state path without leaking secrets.

## Frontend Resilience Design

Room loading will ignore late `room:get` acknowledgements after route changes or newer requests. Admin auth will be centralized so localStorage changes, socket reconnects, and auth errors clear stale admin UI state. Socket form submissions that wait for acknowledgements will use timeouts and pending guards.

Bracket editor `activeTab` will remain local UI state, not shared persisted state. Bracket load failures will leave admin controls recoverable through safe defaults or retry instead of locking the page in a disabled state.

Tournament images from saved state will be normalized to safe display sources with fallback behavior.

## Testing Strategy

Server tests will cover revocation, private-room redaction, password hashing/rate limits, stale player sessions, asset marker safety, missing asset hydration, image validation, production state configuration, and save-before-ack behavior.

Client verification will use TypeScript build plus targeted code-level checks where the current project lacks a browser test harness. If a server behavior can prove the contract, prefer a server regression test over brittle UI-only coverage.

## Non-Goals

- No committed Timeweb credentials, server IPs, or tokens.
- No full database migration.
- No multi-process/session-store redesign.
- No broad visual redesign.
- No unrelated refactors outside the audited edge cases.

## Success Criteria

- `npm run verify` passes locally.
- New regression tests fail against the old behavior and pass after the fixes.
- Private sockets stop receiving protected updates after logout, expiry, deletion, or invalid session state.
- Locked-room public metadata is redacted.
- State and assets fail closed instead of silently corrupting live state.
- Frontend room/admin/bracket flows ignore stale responses and recover from transient errors.
- Deployment docs make production data paths and proxy trust explicit.

## Self-Review

- Placeholder scan: no TBD, TODO, or incomplete sections.
- Scope check: this is one implementation plan focused on audit edge cases and deployment readiness.
- Ambiguity check: legacy room passwords are supported for verification but new passwords are stored as salted hashes.
- Non-goals explicitly exclude database migration, secrets, and visual redesign.
