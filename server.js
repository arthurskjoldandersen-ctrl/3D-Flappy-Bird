/**
 * ============================================================================
 * 3D FLAPPY BIRD ONLINE - RENDER-READY MODULAR WEB SERVER
 * ============================================================================
 * Entry Point: `node server.js` (or `npm start`)
 *
 * Modular Architecture:
 * - server.js                   : HTTP server & static asset router (public/)
 * - src/config/physicsConfig.js : Shared 60Hz deterministic physics & PRNG
 * - src/services/antiCheat.js   : Authoritative server-side replay verifier
 * - src/services/database.js    : Live auto-updating player & leaderboard DB
 * - src/routes/apiRoutes.js     : REST API & Live Database Manager endpoints
 * - public/index.html           : Main game page
 * - public/admin-db.html        : Live Database Explorer & Record Editor (/database)
 * - public/css/*.css            : Modular stylesheets (main.css, themes.css)
 * - public/js/*.js              : Modular client scripts (config, skins, sound,
 *                                 textures, models-3d, ui-views, game)
 * ============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleApiRequest, getLocalAddresses } = require('./src/routes/apiRoutes');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  try {
    // 1. Handle API Routes (/api/*)
    if (pathname.startsWith('/api/')) {
      return await handleApiRequest(req, res, pathname, PORT);
    }

    // 2. Serve Live Database Manager UI at /database or /admin-db.html
    if (req.method === 'GET' && (pathname === '/database' || pathname === '/database/' || pathname === '/admin-db.html')) {
      const dbHtmlPath = path.join(PUBLIC_DIR, 'admin-db.html');
      if (fs.existsSync(dbHtmlPath)) {
        const html = fs.readFileSync(dbHtmlPath, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'
        });
        return res.end(html);
      }
    }

    // 3. Serve Static Files from `public/`
    if (req.method === 'GET' || req.method === 'HEAD') {
      const relativePath = (pathname === '/' || pathname === '/index.html')
        ? 'index.html'
        : pathname.replace(/^\/+/, '');

      const safePath = path.normalize(path.join(PUBLIC_DIR, relativePath));
      if (!safePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Forbidden');
      }

      if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
        const ext = path.extname(safePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const content = fs.readFileSync(safePath);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache'
        });
        return res.end(req.method === 'HEAD' ? undefined : content);
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not found: ' + pathname }));
  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const fallbackPort = PORT + 1;
    console.warn(`\n⚠️  Port ${PORT} is currently in use. Falling back to port ${fallbackPort}...`);
    server.listen(fallbackPort, '0.0.0.0');
  } else {
    console.error('Server error:', err);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const currentPort = server.address()?.port || PORT;
  const isSimulation = Boolean(process.env.SIMULATION_MODE === '1' || process.env.LOCAL_TEST === '1');
  const lanIPs = getLocalAddresses();

  let userCount = 0;
  let totalRuns = 0;
  try {
    const db = require('./src/services/database').getDb();
    userCount = Object.keys(db.users || {}).length;
    const easyRuns = db.runs?.easy?.length || 0;
    const medRuns = db.runs?.medium?.length || 0;
    const hardRuns = db.runs?.hard?.length || 0;
    totalRuns = easyRuns + medRuns + hardRuns;
  } catch (_) {}

  console.log('============================================================');
  if (isSimulation) {
    console.log(' 🧪 3D FLAPPY BIRD — LOCAL TEST & SIMULATION SERVER ACTIVE');
    console.log('============================================================');
    console.log(' -> Mode:           PRIVATE LOCAL SIMULATION (Safe Pre-Release Testing)');
    console.log(' -> Safety:         Isolated from Render — Only YOU are playing!');
    console.log(` -> Loaded Data:    ${userCount} registered players, ${totalRuns} verified runs`);
    console.log(` -> Play & Test:    http://localhost:${currentPort}`);
    console.log(` -> DB Manager:     http://localhost:${currentPort}/database (Login: MeDonut / JohnPork)`);
    console.log(' -> Test your code freely! Press Ctrl+C in this window to stop.');
  } else {
    console.log(' 🐦 3D FLAPPY BIRD ONLINE SERVER (RENDER & GITHUB EDITION)');
    console.log('============================================================');
    console.log(` -> Play Game:          http://localhost:${currentPort}`);
    console.log(` -> Live DB Manager:    http://localhost:${currentPort}/database`);
    lanIPs.forEach(ip => {
      console.log(` -> LAN / Wi-Fi URL:    http://${ip}:${currentPort}`);
    });
  }
  console.log('============================================================');
});
