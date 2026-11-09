import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT || 4173);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`本地预览：http://localhost:${PORT}`));
