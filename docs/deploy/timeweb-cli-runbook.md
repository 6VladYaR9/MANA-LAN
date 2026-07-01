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

Sanitized shape to record in operator notes:

```json
[
  {
    "id": 12345,
    "name": "mana-lan-deploy",
    "fingerprint": "SHA256:..."
  }
]
```

Use a dedicated deploy key for the server login used by GitHub Actions. Do not reuse a personal workstation key for automated deploys.

## Server Presets And Images

Inspect the available server shapes and OS images:

```bash
twc server list-presets -o json
twc server list-os-images -o json
```

Sanitized shapes to record:

```json
{
  "preset": {
    "id": 102,
    "name": "2 vCPU / 4 GB RAM",
    "disk": 50
  },
  "image": {
    "id": 987,
    "name": "Ubuntu 24.04"
  }
}
```

Record the chosen preset and image IDs in the operator notes for the deployment.

## Create Server

Infrastructure creation stays operator-run. Use the selected preset, OS image, SSH key, and region from the JSON inspection commands, then create the VPS from an operator shell with the current `twc-cli` server creation syntax.

GitHub Actions must not create, resize, delete, or rebuild infrastructure. It deploys release artifacts to an already prepared server only.

## Firewall

Inspect firewall groups and the firewall status linked to the server:

```bash
twc firewall group list -o json
twc firewall show server <server-id> -o json
```

Inspect rules inside a selected group:

```bash
twc firewall rule list <group-id> -o json
```

Sanitized shape to record:

```json
{
  "group": {
    "id": "00000000-0000-0000-0000-000000000000",
    "name": "mana-lan-production",
    "policy": "DROP"
  },
  "rules": [
    { "direction": "ingress", "proto": "tcp", "port": "80", "cidr": "0.0.0.0/0" },
    { "direction": "ingress", "proto": "tcp", "port": "443", "cidr": "0.0.0.0/0" },
    { "direction": "ingress", "proto": "tcp", "port": "22", "cidr": "<admin-cidr>" }
  ]
}
```

The production server should expose SSH plus HTTP and HTTPS. The Node app must bind to `127.0.0.1:3001`, behind Caddy, and must not be exposed by a firewall rule.

## DNS

Inspect managed domains:

```bash
twc domain list -o json
```

If `manalan.ru` is delegated to Timeweb DNS, inspect records before changing them:

```bash
twc domain record list manalan.ru -a -o json
```

Sanitized shape to record:

```json
[
  { "fqdn": "manalan.ru", "type": "A", "value": "203.0.113.10" },
  { "fqdn": "www.manalan.ru", "type": "A", "value": "203.0.113.10" }
]
```

Point `manalan.ru` and `www.manalan.ru` to the production server address before enabling public traffic checks. If DNS is not delegated to Timeweb, perform the same A-record update at the external registrar instead of through `twc`.

## Useful JSON Output Commands

These commands are useful for auditable operator notes:

```bash
twc ssh-key list -o json
twc server list-presets -o json
twc server list-os-images -o json
twc firewall group list -o json
twc firewall show server <server-id> -o json
twc firewall rule list <group-id> -o json
twc domain list -o json
```

Keep JSON snapshots free of secrets before sharing them. Redact public IPs if the notes are shared outside the operator group.

## Operator Boundaries

Timeweb `twc-cli` is for operator-run infrastructure provisioning and inspection. Operators own account auth, SSH keys, server creation, firewall changes, and DNS changes.

GitHub Actions deploys releases only. The release workflow may upload artifacts, update `/opt/manalan/current`, and restart `manalan.service`; it must not manage Timeweb infrastructure or receive the Timeweb API token.
