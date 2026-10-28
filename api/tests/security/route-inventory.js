'use strict';

/**
 * Builds the list of every HTTP route the API exposes, straight from the
 * Express routers mounted in app.js (no hand-maintained list to drift).
 * Each entry: { method, mount, path, url (params filled with 1), authed }.
 */

const fs = require('fs');
const path = require('path');

const API_ROOT = path.join(__dirname, '..', '..');

function listRoutes() {
  const authenticate = require('../../middlewares/authenticate');
  const src = fs.readFileSync(path.join(API_ROOT, 'app.js'), 'utf8');
  const mountRe = /app\.use\(\s*'([^']+)'\s*,\s*require\('\.\/routes\/([^']+)'\)/g;
  const routes = [];
  let m;
  while ((m = mountRe.exec(src))) {
    const [, mount, file] = m;
    const router = require(path.join(API_ROOT, 'routes', file));
    let routerLevelAuth = false;
    for (const layer of router.stack) {
      if (!layer.route) {
        if (layer.handle === authenticate) routerLevelAuth = true;
        continue;
      }
      const authed = routerLevelAuth || layer.route.stack.some((s) => s.handle === authenticate);
      for (const method of Object.keys(layer.route.methods)) {
        const p = layer.route.path;
        const url = (mount + (p === '/' ? '' : p)).replace(/:([A-Za-z_]+)/g, '1');
        routes.push({ method, mount, path: p, url, key: `${method.toUpperCase()} ${mount}${p === '/' ? '' : p}`, authed });
      }
    }
  }
  return routes;
}

module.exports = { listRoutes };
