const crypto = require('crypto');

const DEFAULT_LOGIN = 'admin';
const DEFAULT_SALT = 'mana-admin-2026';
const DEFAULT_HASH = 'e89541960cd655bffd5020123b56ccc73a5b24bca6997c7f96be94ad8c446f17';
const PBKDF2_ITERATIONS = 120000;
const ADMIN_PLACEHOLDERS = new Set([
  'admin-manalan',
  'change-this-generated-salt',
  'change-this-generated-pbkdf2-hash',
  '<admin-login>',
  '<generated-salt>',
  '<generated-hash>'
]);

function safeEqualHex(a, b) {
  const first = Buffer.from(String(a || ''), 'hex');
  const second = Buffer.from(String(b || ''), 'hex');
  if (first.length !== second.length || first.length === 0) return false;
  return crypto.timingSafeEqual(first, second);
}

function hashPassword(password, salt = process.env.ADMIN_PASSWORD_SALT || DEFAULT_SALT) {
  return crypto.pbkdf2Sync(String(password || ''), String(salt || ''), PBKDF2_ITERATIONS, 32, 'sha256').toString('hex');
}

function verifyAdmin(login, password) {
  const expectedLogin = process.env.ADMIN_LOGIN || DEFAULT_LOGIN;
  const expectedHash = process.env.ADMIN_PASSWORD_HASH || DEFAULT_HASH;
  const salt = process.env.ADMIN_PASSWORD_SALT || DEFAULT_SALT;
  if (String(login || '').trim() !== expectedLogin) return false;
  return safeEqualHex(hashPassword(password, salt), expectedHash);
}

function isPlaceholder(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ADMIN_PLACEHOLDERS.has(normalized) || normalized.startsWith('change-this-');
}

function validateAdminConfig() {
  if (process.env.NODE_ENV !== 'production') return;

  const login = String(process.env.ADMIN_LOGIN || '').trim();
  const hash = String(process.env.ADMIN_PASSWORD_HASH || '').trim();
  const salt = String(process.env.ADMIN_PASSWORD_SALT || '').trim();
  if (!login || !hash || !salt) {
    throw new Error('ADMIN_LOGIN, ADMIN_PASSWORD_HASH, and ADMIN_PASSWORD_SALT are required in production. Default admin credentials are disabled.');
  }

  if (login === DEFAULT_LOGIN || hash === DEFAULT_HASH || salt === DEFAULT_SALT) {
    throw new Error('Production cannot use bundled default admin credentials. Set non-default ADMIN_LOGIN, ADMIN_PASSWORD_HASH, and ADMIN_PASSWORD_SALT.');
  }

  if ([login, hash, salt].some(isPlaceholder)) {
    throw new Error('Production admin credentials still contain deploy-template placeholders. Generate a private ADMIN_LOGIN, ADMIN_PASSWORD_SALT, and ADMIN_PASSWORD_HASH.');
  }

  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    throw new Error('ADMIN_PASSWORD_HASH must be a 64-character hex PBKDF2-SHA256 hash.');
  }

  if (salt.length < 16) {
    throw new Error('ADMIN_PASSWORD_SALT must be at least 16 characters.');
  }
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  verifyAdmin,
  createToken,
  validateAdminConfig,
  hashPassword,
  DEFAULT_LOGIN,
  DEFAULT_SALT,
  DEFAULT_HASH
};
