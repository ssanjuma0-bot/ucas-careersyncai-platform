require('./db').migrate();

const http = require('http');
const fs = require('fs');
const path = require('path');
const { matchRoute } = require('./lib/routes');
const { readJsonBody, sendJson, getAuthUser } = require('./lib/util');

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const FRONTEND_INDEX = process.env.FRONTEND_INDEX_PATH || path.join(__dirname, '..', 'frontend', 'public', 'index.html');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}
function serveFrontend(req, res) {
  fs.readFile(FRONTEND_INDEX, (err, data) => {
    if (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Frontend build not found on server.' })); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  setCors(res);
  res.sendJson = (status, obj) => sendJson(res, status, obj);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  // Plain, dependency-free liveness probe. Kept separate from /api/health
  // (which also checks the database) so it can never fail due to DB state —
  // useful for Render's healthCheckPath or any external uptime monitor.
  if (pathname === '/health' && (req.method === 'GET' || req.method === 'HEAD')) {
    res.sendJson(200, { status: 'ok', service: 'CareerSync AI' });
    return;
  }

  if (!pathname.startsWith('/api/')) {
    if (req.method === 'GET' || req.method === 'HEAD') { serveFrontend(req, res); return; }
    res.sendJson(405, { error: 'Method not allowed' });
    return;
  }

  const found = matchRoute(req.method, pathname);
  if (!found) { res.sendJson(404, { error: 'Not found.' }); return; }

  try { req.body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJsonBody(req) : {}; }
  catch (e) { res.sendJson(400, { error: e.message || 'Invalid request body.' }); return; }

  req.params = found.params;
  req.query = Object.fromEntries(urlObj.searchParams);
  req.user = getAuthUser(req);

  try { await found.handler(req, res); }
  catch (e) { console.error('Route error:', req.method, pathname, e); res.sendJson(500, { error: 'Internal server error.' }); }
});

server.listen(PORT, HOST, () => {
  console.log(`UCAS CareerSync AI listening on ${HOST}:${PORT}`);
  console.log(`Working directory (cwd): ${process.cwd()}`);
  console.log(`Server file directory (__dirname): ${__dirname}`);
  console.log(`Frontend: http://localhost:${PORT}/`);
  console.log(`Health check: http://localhost:${PORT}/health  and  http://localhost:${PORT}/api/health`);
});
module.exports = server;
