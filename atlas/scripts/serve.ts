// Tiny static server for dist/ under /civilization/ with gzip (like GitHub Pages), for honest load timings.
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.gz': 'application/gzip',
};
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.svg']);

export function serveDist(root: string, port: number): Promise<Server> {
  const cache = new Map<string, Buffer>();
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (!url.startsWith('/civilization/')) { res.writeHead(404); res.end(); return; }
    let p = normalize(join(root, url.slice('/civilization/'.length)));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
    const ext = extname(p);
    const headers: Record<string, string> = { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' };
    let body: Buffer;
    if (COMPRESS.has(ext) && /gzip/.test(String(req.headers['accept-encoding'] ?? ''))) {
      body = cache.get(p) ?? gzipSync(readFileSync(p), { level: 6 });
      cache.set(p, body);
      headers['content-encoding'] = 'gzip';
    } else body = readFileSync(p);
    headers['content-length'] = String(body.length);
    res.writeHead(200, headers);
    res.end(body);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
