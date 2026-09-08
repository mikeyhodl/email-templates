/**
 * Dev server for the template gallery.
 *
 *   npm run dev
 *
 * Serves the repo over HTTP, rebuilds a template when its source changes, and
 * reloads the browser over Server-Sent Events. No dependencies beyond chokidar
 * (already needed for the watcher) — a static file server and an SSE stream are
 * about ninety lines, which is a better trade than the ~120 transitive packages
 * a general-purpose dev server brings with it.
 *
 * Files are served byte-for-byte as they sit on disk. The single exception is a
 * clearly-marked reload snippet appended to HTML responses, which never touches
 * the file itself. That fidelity is the point: a bundler-style dev server
 * rewrites relative asset URLs (Vite turns url('images/x.jpg') into
 * url('/1/images/x.jpg')), which makes the preview disagree with the file you
 * actually send and hides broken paths.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve, sep, basename } from 'node:path';
import { spawn } from 'node:child_process';
import chokidar from 'chokidar';
import { buildAll, buildOne } from './build.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const OPEN = !process.argv.includes('--no-open');
const RELOAD_PATH = '/__dev-reload';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const RELOAD_SNIPPET = `
<!-- injected by \`npm run dev\` for live reload — not part of the template -->
<script>new EventSource('${RELOAD_PATH}').onmessage = () => location.reload();</script>
`;

const clients = new Set();

function reloadBrowsers() {
  for (const res of clients) res.write('data: reload\n\n');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === RELOAD_PATH) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // The repo ships no favicon; answer the browser's automatic request quietly
  // rather than leaving a 404 in every preview's console.
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }

  // Resolve inside the repo only — never let a request escape the root.
  const requested = resolve(repoRoot, '.' + decodeURIComponent(url.pathname));
  if (requested !== repoRoot && !requested.startsWith(repoRoot + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let file = requested;
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(`<h1>404</h1><p>${url.pathname}</p><p><a href="/">Back to the gallery</a></p>`);
    return;
  }

  try {
    const ext = extname(file).toLowerCase();
    const body = await readFile(file);
    const headers = {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    };
    if (ext === '.html') {
      const html = body.toString('utf8');
      const withReload = html.includes('</body>')
        ? html.replace('</body>', `${RELOAD_SNIPPET}</body>`)
        : html + RELOAD_SNIPPET;
      res.writeHead(200, headers).end(withReload);
    } else {
      res.writeHead(200, headers).end(body);
    }
  } catch {
    res.writeHead(404).end('Not found');
  }
});

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' })
    .on('error', () => {})
    .unref();
}

await buildAll();

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`\n  Gallery:  ${url}`);
  console.log(`  Watching: src/**/*.mjml\n`);
  if (OPEN) openBrowser(url);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`  Port ${PORT} is in use. Try: PORT=3001 npm run dev`);
    process.exit(1);
  }
  throw err;
});

// Editors and filesystems often emit several events for a single save, so
// coalesce them per target before spending a rebuild on it.
const pending = new Map();
function debounce(key, fn, ms = 60) {
  clearTimeout(pending.get(key));
  pending.set(key, setTimeout(() => {
    pending.delete(key);
    fn();
  }, ms));
}

// Rebuild on source changes; reload on built output and image changes.
chokidar
  .watch(join(repoRoot, 'src'), { ignoreInitial: true })
  .on('all', (event, path) => {
    if (!path.endsWith('.mjml')) return;
    const isPartial = path.includes(`${repoRoot}${sep}src${sep}partials${sep}`);
    debounce(isPartial ? '*' : path, async () => {
      console.log(`  [${event}] ${path.replace(repoRoot + sep, '')}`);
      if (isPartial) await buildAll();
      else await buildOne(basename(path));
      reloadBrowsers();
    });
  });

chokidar
  .watch(join(repoRoot, '*', 'images'), { ignoreInitial: true })
  .on('all', () => debounce('images', reloadBrowsers));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const res of clients) res.end();
    server.close(() => process.exit(0));
  });
}
