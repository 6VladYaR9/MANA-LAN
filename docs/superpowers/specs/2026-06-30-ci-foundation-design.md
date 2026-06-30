# CI Foundation Design

## Goal

Set up a reproducible baseline for future deployment and fixes. The repository should have one command that installs and verifies the project consistently, plus a GitHub Actions workflow that runs that command on pushes and pull requests.

## Scope

This pass fixes project hygiene needed for CI:

- commit npm lockfiles for the root, server, and client packages;
- replace install commands that disable lockfiles with CI-safe commands;
- add a root `verify` script that runs the project build;
- add GitHub Actions CI for Node.js 24;
- stop tracking generated TypeScript build metadata and ignore it going forward;
- make local Windows start scripts run from their own directory instead of a hardcoded path;
- update docs that currently describe lockfile-free installs.

Security and runtime audit findings such as admin auth hardening, room authorization, screenshot permissions, persistence, and Timeweb deployment automation remain follow-up work. They are not required to make the CI baseline reliable.

## Architecture

The project stays as three npm packages for now: root orchestration, `server`, and `client`. Each package keeps its own `package-lock.json`; this avoids a workspace migration during the CI setup.

Root scripts become the public interface:

- `npm run install:all` for local first-time install;
- `npm run verify` for CI and pre-deploy verification;
- `npm run build` for the existing client production build.

GitHub Actions uses `npm ci` in each package so dependency resolution is locked to reviewed files.

## Validation

Local validation for this change:

- regenerate root/server/client lockfiles;
- run `npm run verify`;
- confirm `git status` does not include `node_modules`, `client/dist`, or `client/tsconfig.tsbuildinfo`;
- push a branch and open a draft PR so GitHub Actions can run on the same command.

## Follow-Up

After server details and Timeweb CLI access are available, add a separate deploy workflow. That workflow should depend on CI and use GitHub secrets for Timeweb credentials rather than embedding server data in the repository.
