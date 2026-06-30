const crypto = require('crypto');

const DEFAULT_LOGIN = 'admin';
const DEFAULT_SALT = 'mana-admin-2026';
const DEFAULT_HASH = 'e89541960cd655bffd5020123b56ccc73a5b24bca6997c7f96be94ad8c446f17';
const PBKDF2_ITERATIONS = 120000;

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

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  verifyAdmin,
  createToken,
  hashPassword,
  DEFAULT_LOGIN,
  DEFAULT_SALT,
  DEFAULT_HASH
};
