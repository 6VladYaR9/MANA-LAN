import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const packageName = 'cs2-lan-mana-veto-bracket-update';
const baseRef = process.argv[2] || '';

function changedChangesets() {
  if (!baseRef) {
    return fs.readdirSync('.changeset', { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
      .map((entry) => path.posix.join('.changeset', entry.name));
  }

  const output = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`, '--', '.changeset/*.md'], { encoding: 'utf8' });
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && path.basename(line) !== 'README.md');
}

function readFrontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match?.[1] || '';
}

const files = changedChangesets();
const packageNamePattern = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patchFiles = files.filter((file) => {
  const frontmatter = readFrontmatter(file);
  const packagePattern = new RegExp(`["']?${packageNamePattern}["']?\\s*:\\s*patch`);
  return packagePattern.test(frontmatter);
});

const nonPatchFiles = files.filter((file) => {
  const frontmatter = readFrontmatter(file);
  return /\b(minor|major)\b/.test(frontmatter);
});

if (patchFiles.length === 0 || nonPatchFiles.length > 0) {
  console.error(`Every normal PR must add one patch changeset for ${packageName}.`);
  console.error('Run: npm run changeset');
  if (nonPatchFiles.length > 0) {
    console.error(`Only patch changesets are allowed for this project policy: ${nonPatchFiles.join(', ')}`);
  }
  process.exit(1);
}

console.log(`Patch changeset found: ${patchFiles.join(', ')}`);

