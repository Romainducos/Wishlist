// Serveur de dev : fichiers statiques + /api/scrape (ce que Vercel fait en prod).
// Usage : node dev-server.js   puis http://localhost:4173/?demo
const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');

process.env.SCRAPE_NO_AUTH = '1'; // pas de vérif du jeton Supabase en local
const scrape = require('./api/scrape.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4173;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/scrape') return scrape(req, res);

  const file = path.join(ROOT, path.normalize(decodeURIComponent(pathname)));
  const target = pathname === '/' ? path.join(ROOT, 'index.html') : file;
  if (!target.startsWith(ROOT + path.sep) || path.basename(target).startsWith('.')) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Wishlist dev : http://localhost:${PORT}/?demo`));
