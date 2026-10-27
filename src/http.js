// http.js — Web 收件箱 + REST API（零依赖，原生 node:http）
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './util.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

export function startHttp({ port, host, store, publicDir }) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    try {
      // ---- API ----
      if (path === '/api/boxes') return json(res, store.boxes());

      if (path === '/api/messages') {
        return json(res, store.list({
          box: url.searchParams.get('box') || undefined,
          q: url.searchParams.get('q') || undefined,
          limit: Math.min(+url.searchParams.get('limit') || 200, 1000),
        }));
      }

      const m = path.match(/^\/api\/messages\/([\w-]+)(\/(raw))?$/);
      if (m) {
        const [, id, , what] = m;
        const rec = store.get(id);
        if (!rec) return json(res, { error: 'not found' }, 404);
        if (req.method === 'DELETE') return json(res, { ok: store.delete(id) });
        if (what === 'raw') {
          const f = join(store.rawDir, id + '.eml');
          if (!existsSync(f)) return json(res, { error: 'no raw' }, 404);
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end(readFileSync(f));
        }
        return json(res, rec);
      }

      if (path === '/api/clear' && req.method === 'POST') {
        store.clear(url.searchParams.get('box') || undefined);
        return json(res, { ok: true });
      }

      // ---- 静态页 ----
      if (path === '/' || path === '/index.html') {
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        return res.end(readFileSync(join(publicDir, 'index.html')));
      }
      const staticFile = join(publicDir, path.replace(/\.\./g, ''));
      if (existsSync(staticFile)) {
        res.writeHead(200, { 'Content-Type': MIME[staticFile.slice(staticFile.lastIndexOf('.'))] || 'application/octet-stream' });
        return res.end(readFileSync(staticFile));
      }
      json(res, { error: 'not found' }, 404);
    } catch (e) {
      log('[http] 错误', e.message);
      json(res, { error: e.message }, 500);
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { log(`[http] 收件箱 http://${host}:${port}`); resolve(server); });
  });
}

function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
