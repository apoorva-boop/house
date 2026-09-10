// The whole spike, minus the listener. `createApp` takes its dependencies so the test
// can hand it a fake sender and a temp file; `server.js` hands it the real ones.
//
// What it does:
//   GET  /            the page (static, from ./public)
//   GET  /vapid-public-key   the public key the page needs to subscribe
//   POST /subscribe   body: a PushSubscription as JSON. Stored in a JSON file.
//   POST /send        Authorization: Bearer <SEND_SECRET>. Sends ONE hard-coded
//                     declarative message to every stored subscription.
//
// Not here on purpose: a database, a queue, retries, per-user anything. It is a
// throwaway. If a notification lands on the phone it has done its job.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { timingSafeEqual } from "node:crypto";

// Declarative Web Push, per https://webkit.org/blog/16535/meet-declarative-web-push/
//   - `"web_push": 8030` is the marker that opts the message into declarative parsing.
//   - `title` and `navigate` are required. The browser draws the notification itself.
//   - No service worker `push` handler exists anywhere in this spike.
export const WEB_PUSH_MARKER = 8030;
export const TTL_SECONDS = 48 * 60 * 60; // 24–72 h allowed; 48 h chosen.
export const URGENCY = "high";

export function buildPayload(origin, sentAt = new Date()) {
  return {
    web_push: WEB_PUSH_MARKER,
    notification: {
      title: "Push spike: it worked",
      body: `Sent ${sentAt.toISOString()}. If you can read this, #6 gets built.`,
      navigate: `${origin}/?opened-from-push=1`,
      tag: "push-spike",
      lang: "en",
      dir: "auto",
      silent: false,
    },
  };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
};

async function readStore(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return { subscriptions: [] };
    throw err;
  }
}

async function writeStore(file, store) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(store, null, 2) + "\n");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function bearerMatches(header, secret) {
  if (!secret) return false;
  const given = (header ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isSubscription(x) {
  return (
    x &&
    typeof x.endpoint === "string" &&
    x.endpoint.startsWith("https://") &&
    x.keys &&
    typeof x.keys.p256dh === "string" &&
    typeof x.keys.auth === "string"
  );
}

/**
 * @param {object} deps
 * @param {string} deps.dataFile        JSON file holding subscriptions
 * @param {string} deps.vapidPublicKey
 * @param {string} deps.sendSecret
 * @param {string} deps.publicDir       where index.html etc. live
 * @param {(sub: object, payload: string, opts: object) => Promise<{statusCode:number}>} deps.sendNotification
 *        web-push's sendNotification, or a fake in tests
 */
export function createApp(deps) {
  const { dataFile, vapidPublicKey, sendSecret, publicDir, sendNotification } = deps;

  async function serveStatic(res, pathname) {
    const name = pathname === "/" ? "/index.html" : pathname;
    if (name.includes("..")) return json(res, 404, { error: "not found" });
    const type = MIME[extname(name)];
    if (!type) return json(res, 404, { error: "not found" });
    try {
      const data = await readFile(join(publicDir, name));
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      res.end(data);
    } catch {
      json(res, 404, { error: "not found" });
    }
  }

  async function subscribe(req, res) {
    let sub;
    try {
      sub = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: "body must be JSON" });
    }
    if (!isSubscription(sub)) {
      return json(res, 400, { error: "body must be a PushSubscription with endpoint and keys" });
    }
    const store = await readStore(dataFile);
    const existing = store.subscriptions.find((s) => s.endpoint === sub.endpoint);
    if (existing) {
      existing.keys = sub.keys;
      existing.dead = false;
    } else {
      store.subscriptions.push({
        endpoint: sub.endpoint,
        keys: sub.keys,
        addedAt: new Date().toISOString(),
        dead: false,
      });
    }
    await writeStore(dataFile, store);
    return json(res, 201, { stored: store.subscriptions.filter((s) => !s.dead).length });
  }

  async function send(req, res, origin) {
    if (!bearerMatches(req.headers.authorization, sendSecret)) {
      return json(res, 401, { error: "wrong or missing secret; nothing sent" });
    }
    const store = await readStore(dataFile);
    const live = store.subscriptions.filter((s) => !s.dead);
    const payload = JSON.stringify(buildPayload(origin));
    const results = [];
    for (const sub of live) {
      try {
        const r = await sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          payload,
          { TTL: TTL_SECONDS, urgency: URGENCY, contentEncoding: "aes128gcm" },
        );
        sub.lastSentAt = new Date().toISOString();
        sub.lastStatus = r.statusCode;
        results.push({ endpoint: sub.endpoint, statusCode: r.statusCode });
      } catch (err) {
        const statusCode = err.statusCode ?? 0;
        // 404 / 410 from the push service mean the subscription no longer exists.
        // Mark it dead so it is never tried again (issue #6, acceptance 3).
        if (statusCode === 404 || statusCode === 410) sub.dead = true;
        sub.lastStatus = statusCode;
        sub.lastError = String(err.body ?? err.message ?? err);
        results.push({ endpoint: sub.endpoint, statusCode, error: sub.lastError });
      }
    }
    await writeStore(dataFile, store);
    return json(res, 200, {
      sent: results.filter((r) => !r.error).length,
      failed: results.filter((r) => r.error),
      payload: JSON.parse(payload),
    });
  }

  return async function handle(req, res) {
    const url = new URL(req.url, "http://x");
    const proto = req.headers["x-forwarded-proto"] ?? "http";
    const origin = `${proto}://${req.headers.host}`;
    try {
      if (req.method === "GET" && url.pathname === "/vapid-public-key") {
        return json(res, 200, { key: vapidPublicKey });
      }
      if (req.method === "POST" && url.pathname === "/subscribe") return await subscribe(req, res);
      if (req.method === "POST" && url.pathname === "/send") return await send(req, res, origin);
      if (req.method === "GET" && url.pathname === "/subscriptions") {
        const store = await readStore(dataFile);
        return json(res, 200, {
          live: store.subscriptions.filter((s) => !s.dead).length,
          dead: store.subscriptions.filter((s) => s.dead).length,
        });
      }
      if (req.method === "GET") return await serveStatic(res, url.pathname);
      return json(res, 405, { error: "method not allowed" });
    } catch (err) {
      console.error(err);
      return json(res, 500, { error: String(err.message ?? err) });
    }
  };
}
