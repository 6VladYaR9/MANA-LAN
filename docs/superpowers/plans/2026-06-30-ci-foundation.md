# CI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible npm dependency and CI baseline before Timeweb deployment work begins.

**Architecture:** Keep the current root/server/client package layout and add lockfiles to each package. The root package owns human-facing commands, while GitHub Actions runs deterministic installs with `npm ci` and the same root `verify` command used locally.

**Tech Stack:** npm, Node.js 24, TypeScript/Vite build, GitHub Actions.

---

### Task 1: Package Scripts And Lockfiles

**Files:**
- Modify: `package.json`
- Create: `package-lock.json`
- Create: `server/package-lock.json`
- Create: `client/package-lock.json`

- [ ] **Step 1: Update root scripts**

Change `package.json` scripts to:

```json
{
  "dev": "concurrently \"npm run dev --prefix server\" \"npm run dev --prefix client\"",
  "install:all": "npm install && npm install --prefix server && npm install --prefix client",
  "ci:install": "npm ci && npm ci --prefix server && npm ci --prefix client",
  "build": "npm run build --prefix client",
  "verify": "npm run build",
  "start": "npm start --prefix server",
  "prod": "npm run build && npm start"
}
```

- [ ] **Step 2: Generate lockfiles**

Run:

```powershell
npm install --package-lock-only
npm install --prefix server --package-lock-only
npm install --prefix client --package-lock-only
```

Expected: root, server, and client lockfiles are created or updated without installing package contents into git.

- [ ] **Step 3: Validate deterministic install**

Run:

```powershell
npm run ci:install
```

Expected: root, server, and client dependencies install from lockfiles with exit code 0.

### Task 2: Ignore Generated Build Metadata

**Files:**
- Modify: `.gitignore`
- Delete: `client/tsconfig.tsbuildinfo`

- [ ] **Step 1: Ignore TypeScript build info**

Append this line to `.gitignore`:

```gitignore
*.tsbuildinfo
```

- [ ] **Step 2: Remove tracked build metadata**

Run:

```powershell
git rm client/tsconfig.tsbuildinfo
```

Expected: `client/tsconfig.tsbuildinfo` is staged as deleted and future builds keep it ignored.

### Task 3: Local Scripts And Documentation

**Files:**
- Modify: `START_MANA_SITE.bat`
- Modify: `START_SITE_ONLY_DEV.bat`
- Modify: `README.md`
- Modify: `DEPLOY_TIMEWEB.md`
- Modify: `docs/INSTRUCTIONS.txt`

- [ ] **Step 1: Make Windows scripts relocatable**

In both BAT files, replace the hardcoded project path line:

```bat
cd /d "C:\cs2-lanonline"
```

with:

```bat
cd /d "%~dp0"
```

- [ ] **Step 2: Stop deleting lockfiles in `START_MANA_SITE.bat`**

Remove the block that deletes `package-lock.json`, `server\package-lock.json`, and `client\package-lock.json`.

- [ ] **Step 3: Use normal npm install commands in docs**

Update docs so local setup keeps lockfiles and production deploy uses:

```bash
npm run ci:install
npm run build
```

Expected: no docs tell operators to delete lockfiles or install with `--package-lock=false`.

### Task 4: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Add workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

jobs:
  verify:
    name: Verify
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: npm
          cache-dependency-path: |
            package-lock.json
            server/package-lock.json
            client/package-lock.json

      - name: Install dependencies
        run: npm run ci:install

      - name: Verify
        run: npm run verify
```

- [ ] **Step 2: Validate workflow syntax by running local commands**

Run:

```powershell
npm run verify
```

Expected: TypeScript build and Vite production build complete with exit code 0.

### Task 5: Commit And PR

**Files:**
- Review all changed files.

- [ ] **Step 1: Check status**

Run:

```powershell
git status -sb
```

Expected: only CI foundation files are modified, plus generated lockfiles.

- [ ] **Step 2: Commit**

Run:

```powershell
git add -A
git commit -m "set up ci foundation"
```

- [ ] **Step 3: Push and open PR**

Run:

```powershell
git push -u origin codex/setup-ci-foundation
gh pr create --draft --base main --head codex/setup-ci-foundation --title "[codex] set up ci foundation"
```

Expected: a draft PR opens against `main`.
