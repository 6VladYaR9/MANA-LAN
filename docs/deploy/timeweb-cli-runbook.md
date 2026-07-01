# Timeweb CLI Runbook

## Install

Install `pipx`, expose its user scripts path, then install the Timeweb CLI:

```bash
python -m pip install --user pipx
python -m pipx ensurepath
pipx install twc-cli
```

Open a new shell after `ensurepath` if `pipx` is not immediately available.

## Authenticate

Configure the CLI from an operator workstation:

```bash
twc config
```

Use an operator-owned Timeweb token. Do not place Timeweb tokens in git, GitHub Actions, release artifacts, or server env files.

## Inspect Account

Confirm that the CLI is authenticated against the expected account:

```bash
twc whoami
```

## SSH Keys

List known SSH keys before creating or rebuilding servers:

```bash
twc ssh-key list -o json
```

Use a dedicated deploy key for the server login used by GitHub Actions.

## Server Presets And Images

Inspect the available server shapes and OS images:

```bash
twc server list-presets -o json
twc server list-os-images -o json
```

Record the chosen preset and image IDs in the operator notes for the deployment.

## Create Server

Infrastructure creation stays operator-run. Use the selected preset, OS image, SSH key, and region from the JSON inspection commands, then create the VPS from an operator shell with the current `twc-cli` server creation syntax.

GitHub Actions must not create, resize, delete, or rebuild infrastructure. It deploys release artifacts to an already prepared server only.

## Firewall

Inspect firewall resources:

```bash
twc firewall list -o json
```

The production server should expose SSH plus HTTP and HTTPS. The Node app must bind to `127.0.0.1:3001`, behind Caddy.

## DNS

Inspect managed domains:

```bash
twc domain list -o json
```

Point `manalan.ru` and `www.manalan.ru` to the production server address before enabling public traffic checks.

## Useful JSON Output Commands

These commands are useful for auditable operator notes:

```bash
twc ssh-key list -o json
twc server list-presets -o json
twc server list-os-images -o json
twc firewall list -o json
twc domain list -o json
```

Keep JSON snapshots free of secrets before sharing them.

## Operator Boundaries

Timeweb `twc-cli` is for operator-run infrastructure provisioning and inspection. Operators own account auth, SSH keys, server creation, firewall changes, and DNS changes.

GitHub Actions deploys releases only. The release workflow may upload artifacts, update `/opt/manalan/current`, and restart `manalan.service`; it must not manage Timeweb infrastructure.
