/**
 * boot.js — resilient entrypoint for Render (and any other host).
 *
 * The real server is backend/server.js. This file's only job is to find it
 * and start it, even if the process's working directory does not exactly
 * match the expected repo layout — the #1 cause of the error:
 *
 *   Error: Cannot find module '/opt/render/project/src/backend/server.js'
 *
 * That error means Render could not find backend/server.js at the path it
 * expected. The two real causes are almost always:
 *   1. Your GitHub repo has an extra wrapper folder (e.g. the whole project
 *      folder was committed as a subfolder, so the real path is
 *      some-folder/backend/server.js, not backend/server.js), OR
 *   2. Render's "Root Directory" setting (Dashboard → your service →
 *      Settings → Build & Deploy) does not match where package.json
 *      actually lives in your repo.
 *
 * This script does NOT fake or replace the server. It searches the
 * filesystem starting from this file's own directory for a real
 * backend/server.js and requires that exact file. If it has to search
 * (i.e. the file isn't exactly where expected), it prints a clear WARNING
 * telling you what's misconfigured so you can fix the root cause — it does
 * not hide the problem.
 */
const fs = require('fs');
const path = require('path');

function findServerEntry(startDir, maxDepth) {
  const direct = path.join(startDir, 'backend', 'server.js');
  if (fs.existsSync(direct)) return direct;
  if (maxDepth <= 0) return null;

  let entries = [];
  try { entries = fs.readdirSync(startDir, { withFileTypes: true }); }
  catch (e) { return null; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const found = findServerEntry(path.join(startDir, entry.name), maxDepth - 1);
    if (found) return found;
  }
  return null;
}

const expected = path.join(__dirname, 'backend', 'server.js');
const entry = fs.existsSync(expected) ? expected : findServerEntry(__dirname, 3);

console.log(`boot.js: running from ${__dirname}`);

if (!entry) {
  console.error('FATAL: backend/server.js could not be found anywhere under this directory.');
  console.error('This means backend/server.js was never committed/pushed to the branch');
  console.error('that Render is actually building. Check GitHub directly (in the browser,');
  console.error('not just locally) and confirm backend/server.js is visible on the branch');
  console.error('configured in Render (see render.yaml "branch" and the Dashboard).');
  process.exit(1);
}

if (entry !== expected) {
  console.warn('WARNING: backend/server.js was NOT at the expected path (backend/server.js');
  console.warn(`relative to the repo root). Found it instead at: ${entry}`);
  console.warn('This means your repository has an extra wrapper folder, or Render\'s');
  console.warn('"Root Directory" setting is wrong. The server will start anyway, but you');
  console.warn('should fix this properly — see README.md "Render deployment" section.');
}

require(entry);
