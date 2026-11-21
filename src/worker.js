/**
 * ============================================================================
 * 3D FLAPPY BIRD ONLINE — CLOUDFLARE WORKERS + SQLITE DURABLE OBJECT ENTRY
 * ============================================================================
 * Runs the full authoritative Node.js game API (`src/routes/apiRoutes.js` +
 * `src/services/database.js` + 60Hz anti-cheat + duels + chat + /database)
 * on Cloudflare Workers Free Plan using:
 *   1. Static Assets (`public/`) served directly from Cloudflare's edge
 *   2. Singleton SQLite-backed Durable Object (`FlappyGameServerDO`) for
 *      authoritative live state & durable zero-loss persistence
 * ============================================================================
 */

import { DurableObject } from 'cloudflare:workers';
import database from './services/database.js';
import apiRoutes from './routes/apiRoutes.js';

const CHUNK_SIZE = 256 * 1024; // 256 KB per SQLite chunk (well under 2 MB DO SQLite cell cap)

function splitChunks(str, size = CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks;
}

export class FlappyGameServerDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this._lastDuelTickAt = 0;
    this._lastGiveawayTickAt = 0;
    this._lastLbPeriodTickAt = 0;

    if (env && env.SESSION_SECRET && typeof process !== 'undefined' && process.env && !process.env.SESSION_SECRET) {
      process.env.SESSION_SECRET = String(env.SESSION_SECRET);
    }

    // Initialize embedded SQLite tables (included on Cloudflare Workers Free Plan)
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS db_chunks (
        idx INTEGER PRIMARY KEY,
        chunk TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_media_meta (
        u_key TEXT PRIMARY KEY,
        version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_media_chunks (
        u_key TEXT NOT NULL,
        idx INTEGER NOT NULL,
        chunk TEXT NOT NULL,
        PRIMARY KEY (u_key, idx)
      );
    `);

    this._installStorageBridge();
    database.loadDatabase(false);
  }

  _installStorageBridge() {
    const sql = this.ctx.storage.sql;
    const storage = this.ctx.storage;

    globalThis.__FLAPPY_CF_WORKER__ = true;
    globalThis.__FLAPPY_CF_STORAGE__ = {
      loadDb: () => {
        const rows = sql.exec('SELECT chunk FROM db_chunks ORDER BY idx ASC').toArray();
        if (!rows || rows.length === 0) return null;
        return rows.map(r => r.chunk).join('');
      },
      saveDb: (jsonStr) => {
        const chunks = splitChunks(jsonStr);
        storage.transactionSync(() => {
          sql.exec('DELETE FROM db_chunks');
          for (let i = 0; i < chunks.length; i++) {
            sql.exec('INSERT INTO db_chunks (idx, chunk) VALUES (?, ?)', i, chunks[i]);
          }
        });
      },
      loadUserMedia: (uKey) => {
        const key = String(uKey || '').toLowerCase();
        const rows = sql.exec(
          'SELECT chunk FROM user_media_chunks WHERE u_key = ? ORDER BY idx ASC',
          key
        ).toArray();
        if (!rows || rows.length === 0) return null;
        return rows.map(r => r.chunk).join('');
      },
      saveUserMedia: (uKey, version, jsonPayload) => {
        const key = String(uKey || '').toLowerCase();
        const ver = Number(version) || 1;
        const chunks = splitChunks(jsonPayload);
        storage.transactionSync(() => {
          sql.exec('DELETE FROM user_media_chunks WHERE u_key = ?', key);
          for (let i = 0; i < chunks.length; i++) {
            sql.exec(
              'INSERT INTO user_media_chunks (u_key, idx, chunk) VALUES (?, ?, ?)',
              key,
              i,
              chunks[i]
            );
          }
          sql.exec(
            'INSERT OR REPLACE INTO user_media_meta (u_key, version) VALUES (?, ?)',
            key,
            ver
          );
        });
      }
    };
  }

  _runMaintenanceTicks() {
    const now = Date.now();
    if (now - this._lastDuelTickAt >= 250) {
      this._lastDuelTickAt = now;
      try {
        if (typeof apiRoutes.runBackgroundCleanupTick === 'function') {
          apiRoutes.runBackgroundCleanupTick();
        }
      } catch (_) {}
    }
    if (now - this._lastGiveawayTickAt >= 1500) {
      this._lastGiveawayTickAt = now;
      try {
        if (typeof database.settleExpiredGiveaways === 'function') {
          database.settleExpiredGiveaways(now);
        }
      } catch (_) {}
    }
    if (now - this._lastLbPeriodTickAt >= 60 * 1000) {
      this._lastLbPeriodTickAt = now;
      try {
        if (typeof database.settleCompletedLeaderboardPeriods === 'function') {
          database.settleCompletedLeaderboardPeriods(now, { saveOnAward: true });
        }
      } catch (_) {}
    }
  }

  async fetch(request) {
    // Re-ensure bridge points to this DO's SQLite handle
    this._installStorageBridge();
    this._runMaintenanceTicks();

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-User, X-Device-Id, X-Device-Fingerprint, X-Ban-Token, X-Known-Accounts, X-Cookie-Consent',
          'Access-Control-Allow-Credentials': 'true',
          'Cache-Control': 'no-store'
        }
      });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // Build Node-compatible headers (skip manual gzip so Cloudflare Edge handles Brotli/Gzip cleanly)
    const headersObj = {};
    for (const [k, v] of request.headers.entries()) {
      headersObj[k.toLowerCase()] = v;
    }
    headersObj['accept-encoding'] = 'identity';
    if (!headersObj['host']) {
      headersObj['host'] = url.host;
    }

    // Read body upfront for write methods (up to 15 MB for HD drawings / 30 FPS videos / DB recovery imports)
    let rawBody = '';
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        rawBody = await request.text();
        if (rawBody.length > 15 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: 'Payload too large' }), {
            status: 413,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
          });
        }
      } catch (bodyErr) {
        return new Response(JSON.stringify({ error: 'Failed to read request body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
        });
      }
    }

    const remoteIp = headersObj['cf-connecting-ip'] || headersObj['x-forwarded-for'] || '0.0.0.0';
    const nodeReq = {
      method: request.method,
      url: url.pathname + url.search,
      headers: headersObj,
      socket: { remoteAddress: remoteIp },
      _rawBody: rawBody,
      on: () => {},
      destroy: () => {}
    };

    let responseStatus = 200;
    let responseHeadersObj = {};
    let responseBody = '';
    let resolved = false;
    let resolveDone = null;
    const donePromise = new Promise((resolve) => { resolveDone = resolve; });

    const nodeRes = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      _acceptGzip: false,
      on: () => {},
      writeHead(code, hdrs) {
        responseStatus = code;
        responseHeadersObj = hdrs || {};
        this.headersSent = true;
      },
      end(chunk) {
        if (resolved) return;
        resolved = true;
        this.writableEnded = true;
        if (chunk !== undefined && chunk !== null) {
          responseBody = chunk;
        }
        if (resolveDone) resolveDone();
      }
    };

    try {
      await apiRoutes.handleApiRequest(nodeReq, nodeRes, pathname, 443);
      if (!resolved) {
        await Promise.race([
          donePromise,
          new Promise((_, rej) => setTimeout(() => rej(new Error('API response timeout')), 15000))
        ]);
      }
    } catch (err) {
      if (!resolved) {
        return new Response(JSON.stringify({ error: (err && err.message) || 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
        });
      }
    }

    const outHeaders = new Headers();
    for (const [key, val] of Object.entries(responseHeadersObj)) {
      if (val === undefined || val === null) continue;
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item !== undefined && item !== null) outHeaders.append(key, String(item));
        }
      } else {
        outHeaders.set(key, String(val));
      }
    }
    if (!outHeaders.has('Content-Type')) {
      outHeaders.set('Content-Type', 'application/json; charset=utf-8');
    }

    return new Response(request.method === 'HEAD' ? null : responseBody, {
      status: responseStatus,
      headers: outHeaders
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 1. All /api/* endpoints run on our singleton SQLite Durable Object
    if (pathname.startsWith('/api/')) {
      if (!env || !env.FLAPPY_GAME_DO) {
        return new Response(JSON.stringify({ error: 'Server storage binding (FLAPPY_GAME_DO) is not configured.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
      const id = env.FLAPPY_GAME_DO.idFromName('global-flappy-server');
      const stub = env.FLAPPY_GAME_DO.get(id);
      return stub.fetch(request);
    }

    // 2. Serve Live Database Manager UI at /database or /database/
    if ((request.method === 'GET' || request.method === 'HEAD') && (pathname === '/database' || pathname === '/database/')) {
      if (env && env.ASSETS) {
        const adminUrl = new URL('/admin-db.html', url.origin);
        const assetRes = await env.ASSETS.fetch(new Request(adminUrl.toString(), request));
        const headers = new Headers(assetRes.headers);
        headers.set('Cache-Control', 'no-cache');
        return new Response(assetRes.body, {
          status: assetRes.status,
          statusText: assetRes.statusText,
          headers
        });
      }
    }

    // 3. Serve static frontend files from public/ via Workers Static Assets
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response(JSON.stringify({ error: 'Not found: ' + pathname }), {
      status: 404,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
};
