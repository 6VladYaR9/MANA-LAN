# Changesets

Every normal PR should include a patch changeset:

```bash
npm run changeset
```

Choose `patch` for `cs2-lan-mana-veto-bracket-update` and write a short user-facing summary. After the PR is merged into `main`, GitHub opens a version PR that bumps `package.json`, refreshes `package-lock.json`, and updates `CHANGELOG.md`.

