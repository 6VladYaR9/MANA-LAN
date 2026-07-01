# Timeweb Production Deploy Design

## Goal

Build a production-grade deployment path for MANA LAN on Timeweb Cloud that is reproducible, secure by default, easy to roll back, and aligned with the current single-node Node.js/Socket.IO architecture.

## Current Context

The application is a monorepo with a React/Vite client and a Node.js/Express/Socket.IO backend. In production the backend serves `client/dist`, listens on a configurable host/port, requires explicit production origins through `CLIENT_URL`, requires non-default admin credentials, and requires an explicit persistent state location through `DATA_DIR` or `STATE_FILE`.

The current repo already contains `DEPLOY_TIMEWEB.md` and `Caddyfile.example`, but the deployment story is still operator-run rather than production-operational. It lacks a formal infrastructure workflow, atomic releases, rollback, server bootstrap scripts, a systemd unit, GitHub Actions deployment handoff, and a clear Timeweb CLI runbook.

## Source Facts

- Timeweb Cloud CLI is the official `twc` utility for managing Timeweb Cloud services.
- Official installation guidance recommends `pipx install twc-cli`; the CLI is configured with `twc config` and a Timeweb API token.
- The CLI exposes the service areas needed for this deployment: `server`, `ssh-key`, `firewall`, `domain`, `project`, and `apps`.
- CLI commands support machine-readable output through `-o json` and `-o yaml`.
- `twc server create` can create Ubuntu servers with SSH keys, public IPs, region/availability-zone settings, and disabled SSH password authentication.
- `twc firewall` can create and link firewall rule groups to servers.
- `twc domain` can manage DNS records when the domain is delegated to Timeweb Cloud DNS.

References:

- https://timeweb.cloud/docs/twc-cli
- https://timeweb.cloud/docs/twc-cli/twc-cli-start
- https://github.com/timeweb-cloud/twc
- https://raw.githubusercontent.com/timeweb-cloud/twc/master/docs/ru/CLI_REFERENCE.md
- https://pypi.org/project/twc-cli/

## Deployment Options Considered

### Option A: Timeweb VPS, Caddy, systemd, atomic releases

This uses a normal Timeweb Cloud server as the runtime. `twc-cli` provisions and inspects infrastructure; SSH deploys release artifacts; Caddy terminates TLS and proxies to the Node backend; systemd runs the app as a dedicated non-root user.

This is the recommended option. It fits Socket.IO, local persistent state, uploaded archive assets, the existing backend static serving, and future operational needs such as rollback and log inspection. It keeps the runtime boring and transparent.

### Option B: Timeweb Apps

This would use Timeweb's app platform via `twc apps create`. It may be convenient for simple stateless services, but it is not the right first production target for this app because the project depends on Socket.IO behavior, local persistent runtime state, uploaded images, and server-side static serving. Those can work only if the platform provides stable WebSocket behavior and persistent writable storage with clear operational controls; that must be proven separately before choosing it.

Timeweb Apps can be revisited after the VPS deployment is stable.

### Option C: Docker on VPS

This would package the app as containers and run through Docker Compose. It improves packaging consistency but adds another runtime layer, image build/push workflow, registry decisions, volume management, and container logging. For the current single-process Node app, systemd plus atomic release directories is simpler and more operationally transparent.

Docker can be introduced later if multi-service deployment or image promotion becomes valuable.

## Recommended Architecture

Use Option A.

```text
GitHub main
  -> CI verify
  -> build deploy artifact
  -> SSH upload to Timeweb VPS
  -> unpack into /opt/manalan/releases/<sha>
  -> install production server dependencies
  -> atomically switch /opt/manalan/current
  -> systemctl restart manalan
  -> smoke-check local and public health

Public internet
  -> Timeweb Cloud Firewall 80/443
  -> Caddy :443
  -> 127.0.0.1:3001 Node backend
  -> /var/lib/manalan persistent state/assets
```

## Infrastructure Layer

The provisioning layer uses `twc-cli`, but the server does not need the Timeweb API token. The token stays on the operator machine and in GitHub Secrets only if CI later needs to inspect infrastructure.

Required `twc` workflow:

1. Install CLI with `pipx install twc-cli`.
2. Configure a Timeweb API token with `twc config`, or use `TWC_TOKEN` in non-interactive automation.
3. Confirm account access with `twc whoami`.
4. Upload or select an SSH key with `twc ssh-key list` or `twc ssh-key new`.
5. Inspect server options with `twc server list-presets -o json` and `twc server list-os-images -o json`.
6. Create an Ubuntu 24.04 server with SSH key auth and disabled SSH password auth.
7. Link a firewall group that allows public `80/tcp`, `443/tcp`, ICMP, and restricted `22/tcp`.
8. Manage DNS through `twc domain` only when `manalan.ru` is delegated to Timeweb Cloud DNS; otherwise the DNS step is documented as external registrar work.

Recommended first server size:

- Ubuntu 24.04 LTS.
- 2 vCPU.
- 2-4 GB RAM.
- 30-50 GB NVMe disk.
- Region `ru-1` unless the user chooses another Timeweb region.
- SSH password authentication disabled.

## Runtime Layer

The server runs as a dedicated Linux user:

```text
user: manalan
group: manalan
home: /opt/manalan
```

Filesystem layout:

```text
/opt/manalan/releases/<git-sha>/  immutable release directories
/opt/manalan/current             symlink to active release
/opt/manalan/shared              optional shared operational files
/etc/manalan/manalan.env         production environment file, root-readable
/var/lib/manalan                 persistent app state, uploads, externalized images
/var/log/journal                 logs through journald
```

Node.js listens only on loopback:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
TRUST_PROXY=1
DATA_DIR=/var/lib/manalan
CLIENT_URL=https://manalan.ru,https://www.manalan.ru
```

The app must never listen publicly on `0.0.0.0` in production when `TRUST_PROXY=1`.

## Reverse Proxy And TLS

Use Caddy as the public reverse proxy.

Reasons:

- Automatic HTTPS without separate certbot plumbing.
- WebSocket proxying works with normal `reverse_proxy`.
- Small configuration surface.
- Good fit for one public site and one local backend.

Caddy owns ports `80` and `443`. Node owns `127.0.0.1:3001`.

The Caddy config must proxy both apex and `www` domains:

```caddy
manalan.ru, www.manalan.ru {
    encode zstd gzip

    reverse_proxy 127.0.0.1:3001 {
        header_up X-Forwarded-Proto {scheme}
        header_up X-Forwarded-Host {host}
    }
}
```

## Process Management

Use systemd, not PM2, as the primary production process manager.

Reasons:

- Native service lifecycle on Ubuntu.
- Restart policy and boot ordering without another Node package.
- Logs go to journald.
- Environment is loaded from a root-owned file.
- Easier incident response with `systemctl status manalan` and `journalctl -u manalan`.

The service runs:

```bash
npm start --prefix /opt/manalan/current/server
```

The working directory is `/opt/manalan/current`, and systemd loads `/etc/manalan/manalan.env`.

## Release Strategy

Deploy immutable release directories and an atomic symlink switch:

1. Build and verify in GitHub Actions.
2. Package repository contents needed for production, including `client/dist`.
3. Upload artifact to the server.
4. Unpack into `/opt/manalan/releases/<sha>`.
5. Run `npm ci --prefix server --omit=dev` in the release directory.
6. Check that `client/dist/index.html` exists.
7. Switch `/opt/manalan/current` to the new release with `ln -sfn`.
8. Restart systemd service.
9. Smoke-check local and public health.

Keep the last five release directories. Rollback switches `current` back to the previous release and restarts `manalan`.

## Secrets And Configuration

Secrets never go into the repository.

Server-side secrets:

- `/etc/manalan/manalan.env`.
- Owned by `root:manalan`.
- Mode `0640`.
- Loaded by systemd.

GitHub deployment secrets:

- `TIMEWEB_HOST`
- `TIMEWEB_SSH_USER`
- `TIMEWEB_SSH_KEY`
- `TIMEWEB_SSH_PORT`
- optional `TIMEWEB_TWC_TOKEN` only if workflow needs Timeweb API inspection

Production admin credentials:

- `ADMIN_LOGIN`
- `ADMIN_PASSWORD_SALT`
- `ADMIN_PASSWORD_HASH`

The password hash is generated with the existing PBKDF2 command documented in `README.md`. Plaintext admin passwords are never committed and do not live in GitHub logs.

## Firewall And Network Policy

Use Timeweb Cloud Firewall as the first layer and UFW on the server as the second layer.

Cloud firewall policy:

- Allow `80/tcp` from `0.0.0.0/0`.
- Allow `443/tcp` from `0.0.0.0/0`.
- Allow ICMP from `0.0.0.0/0`.
- Allow `22/tcp` only from known admin IP CIDRs when available.
- Default deny inbound.

Server UFW policy:

- Allow OpenSSH.
- Allow Caddy public ports.
- Deny direct access to `3001/tcp`.

If admin IP CIDRs are not stable, SSH remains protected by key-only auth and fail2ban; the cloud firewall can temporarily allow broader SSH during bootstrap and then be tightened.

## DNS

Primary domain is `manalan.ru` with `www.manalan.ru` as an alias.

If DNS is delegated to Timeweb Cloud:

- Use `twc domain list`.
- Use `twc domain record list manalan.ru -a`.
- Add or update A records to the server public IPv4.

If DNS is not delegated to Timeweb Cloud:

- Keep DNS changes outside `twc`.
- Document exact A records in the deploy checklist.

Caddy validates TLS only after DNS points to the server.

## Observability And Operations

Minimum operational commands:

```bash
systemctl status manalan
journalctl -u manalan -n 200 --no-pager
journalctl -u caddy -n 200 --no-pager
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS https://manalan.ru/api/health
```

Health response must show:

- `ok: true`.
- `maintenanceMode`.
- `stateFile` under `/var/lib/manalan` or the explicit production state file.

The deployment smoke check must fail if `stateFile` points inside a release directory.

## Backup Policy

The first production backup layer is Timeweb disk backups for the VPS disk.

The app-level backup layer is a compressed archive of `/var/lib/manalan`, created before each deploy and before risky maintenance. The archive lives outside release directories, for example:

```text
/var/backups/manalan/manalan-data-YYYYMMDD-HHMMSS.tar.gz
```

This is enough for the first single-node production deployment because the state store writes atomically. A later database migration can add point-in-time database backups when the app outgrows JSON state.

## GitHub Actions Deployment

Add a deployment workflow that is safe but initially manual:

- Trigger: `workflow_dispatch`.
- Optional later trigger: after successful versioned push to `main`.
- Concurrency group: `production`.
- Environment: `production`.
- Required secrets: SSH host/user/key/port.
- Steps:
  1. Checkout.
  2. Install dependencies with `npm run ci:install`.
  3. Run `npm run verify`.
  4. Build deploy artifact.
  5. Upload artifact over SSH.
  6. Run remote deploy script.
  7. Run smoke check.

The workflow does not create infrastructure. Provisioning is a separate operator action through `twc-cli`. This separation avoids accidental server deletion or replacement from a normal deploy workflow.

## Repository Deliverables

Implementation should add or update these files:

```text
DEPLOY_TIMEWEB.md
deploy/caddy/Caddyfile
deploy/env/manalan.env.example
deploy/systemd/manalan.service
deploy/scripts/bootstrap-server.sh
deploy/scripts/deploy-release.sh
deploy/scripts/rollback-release.sh
deploy/scripts/smoke-check.sh
.github/workflows/deploy-production.yml
docs/deploy/timeweb-cli-runbook.md
```

The scripts must be idempotent where practical and must fail fast with clear messages.

## Testing And Verification

Local verification before merging deploy scaffolding:

```bash
npm run verify
bash -n deploy/scripts/bootstrap-server.sh
bash -n deploy/scripts/deploy-release.sh
bash -n deploy/scripts/rollback-release.sh
bash -n deploy/scripts/smoke-check.sh
```

Production verification after first deploy:

```bash
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS https://manalan.ru/api/health
systemctl is-active manalan
systemctl is-active caddy
```

Manual smoke path:

- Open homepage.
- Log in as admin.
- Create protected room.
- Join protected room from player session.
- Complete veto through side choice.
- Upload result screenshot.
- Finish match.
- Open past tournaments.
- Open bracket page.

## Out Of Scope For First Production Deploy

- Kubernetes.
- Multi-node horizontal scaling.
- Moving state to Postgres.
- Docker image registry and compose deployment.
- Blue/green load balancer rollout.
- Automatic infrastructure creation from GitHub Actions.
- Timeweb Apps as the primary runtime.

These are valid future steps, but they add operational surface before the first stable single-node production deploy is proven.

## Acceptance Criteria

- The repo contains a complete production runbook based on Timeweb CLI and VPS operations.
- A fresh Ubuntu 24.04 Timeweb VPS can be bootstrapped without storing secrets in the repo.
- The app runs as a non-root `manalan` user under systemd.
- Caddy serves `https://manalan.ru` and proxies to loopback Node.
- Persistent state lives under `/var/lib/manalan`.
- A deployment can be rolled back to the previous release without rebuilding.
- GitHub Actions can perform a manual production deploy using SSH secrets.
- Smoke checks fail the deploy if local or public health checks fail.
