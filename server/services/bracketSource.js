const fs = require('fs');
const path = require('path');

// Этапы нужны фронтенду для группировки сетки. Сами названия можно менять без изменения логики.
const BRACKET_STAGES = [
  { id: 'seed', title: 'Матч за посев', format: 'BO1' },
  { id: 'groups', title: 'Групповой этап', format: 'BO1' },
  { id: 'quarter', title: 'Четвертьфинал', format: 'BO1' },
  { id: 'semi', title: 'Полуфинал', format: 'BO3' },
  { id: 'final', title: 'Финал', format: 'BO3' }
];

const FALLBACK_ROWS = [
  ['Матч за посев (BO1)', '1', '2', '', '', '', '8', '9'],
  ['Групповой этап (BO1)', '3', '1', '', '5', '6', '', ''],
  ['Четвертьфинал (BO1)', '7', '1', '12-13', '2', '6', '12-13', ''],
  ['Полуфинал (BO3)', '7', '5', '13-14', '4', '6', '13-14', ''],
  ['Финал (BO3)', '', '7', '4', '14-17', '', '', '21-00']
];

let cachedBracket = null;

function readPositiveIntEnv(key, fallback) {
  const value = Number.parseInt(process.env[key] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getFetchTimeoutMs() {
  return readPositiveIntEnv('BRACKET_FETCH_TIMEOUT_MS', 3000);
}

function getCacheTtlMs() {
  return readPositiveIntEnv('BRACKET_CACHE_TTL_MS', 60000);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getFetchTimeoutMs());

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`Google Sheets fetch timed out after ${getFetchTimeoutMs()}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function cloneBracket(bracket, extras = {}) {
  return {
    ...bracket,
    ...extras,
    stages: bracket.stages,
    rows: bracket.rows.map((row) => [...row])
  };
}

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  rows.push(row);
  return normalizeRows(rows);
}

function normalizeRows(rows) {
  const maxRows = Number.parseInt(process.env.BRACKET_MAX_ROWS || '36', 10);
  const maxCols = Number.parseInt(process.env.BRACKET_MAX_COLUMNS || '9', 10);

  // В таблице может быть много закрытой/служебной информации ниже сетки.
  // На сайт пропускаем только верхний диапазон сетки и ограниченное число колонок.
  const cleanRows = rows
    .slice(0, Number.isFinite(maxRows) ? maxRows : 36)
    .map((row) => row.slice(0, Number.isFinite(maxCols) ? maxCols : 9).map((cell) => String(cell ?? '').trim()))
    .filter((row) => row.some(Boolean));

  const width = Math.max(1, ...cleanRows.map((row) => row.length));
  return cleanRows.map((row) => {
    const nextRow = [...row];
    while (nextRow.length < width) nextRow.push('');
    return nextRow;
  });
}

function sheetsValuesUrl() {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const range = process.env.GOOGLE_SHEETS_RANGE || 'A1:I36';
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;

  if (!sheetId || !apiKey) return null;
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?key=${encodeURIComponent(apiKey)}`;
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url, { headers: { 'User-Agent': 'MANA-CS2-Match-Hub/1.0' } });
  if (!response.ok) throw new Error(`Google Sheets вернул HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, { headers: { 'User-Agent': 'MANA-CS2-Match-Hub/1.0' } });
  if (!response.ok) throw new Error(`Google Sheets API вернул HTTP ${response.status}`);
  return response.json();
}

function buildPublicCsvUrlFromSheetId() {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const gid = process.env.GOOGLE_SHEETS_GID || '1436645756';
  if (!sheetId) return null;
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
}

async function loadBracketRowsUncached() {
  const publicCsvUrl = process.env.GOOGLE_SHEETS_PUBLIC_CSV_URL || buildPublicCsvUrlFromSheetId();

  if (publicCsvUrl) {
    const csv = await fetchText(publicCsvUrl);
    return {
      source: 'google-public-csv',
      stages: BRACKET_STAGES,
      rows: parseCsv(csv),
      updatedAt: new Date().toISOString()
    };
  }

  const apiUrl = sheetsValuesUrl();
  if (apiUrl) {
    const payload = await fetchJson(apiUrl);
    return {
      source: 'google-sheets-api',
      stages: BRACKET_STAGES,
      rows: normalizeRows(payload.values || []),
      updatedAt: new Date().toISOString()
    };
  }

  return {
    source: 'fallback-example',
    stages: BRACKET_STAGES,
    rows: FALLBACK_ROWS,
    updatedAt: new Date().toISOString()
  };
}

async function getBracketRows() {
  const cacheTtl = getCacheTtlMs();

  if (cachedBracket && Date.now() - cachedBracket.cachedAt < cacheTtl) {
    return cloneBracket(cachedBracket.bracket, { cached: true });
  }

  try {
    const bracket = await loadBracketRowsUncached();
    cachedBracket = {
      cachedAt: Date.now(),
      bracket
    };
    return cloneBracket(bracket, { cached: false });
  } catch (error) {
    if (!cachedBracket) throw error;

    return cloneBracket(cachedBracket.bracket, {
      cached: true,
      stale: true,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

module.exports = {
  loadDotEnv,
  getBracketRows,
  FALLBACK_ROWS,
  BRACKET_STAGES
};
