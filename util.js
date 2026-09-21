const crypto = require('crypto');
const { verifyToken } = require('./auth');

function uid(prefix) { return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}`; }

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '', size = 0;
    const MAX = 8 * 1024 * 1024;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX) { reject(new Error('Request body too large')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) { resolve({}); return; }
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function getAuthUser(req) {
  const header = req.headers['authorization'] || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  return verifyToken(match[1]);
}
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || ''); }

module.exports = { uid, readJsonBody, sendJson, getAuthUser, isValidEmail };
