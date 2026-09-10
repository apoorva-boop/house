// Proves /subscribe and /send work against a fake subscription, with a fake sender so
// nothing leaves the machine. Run with: npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import webpush from "web-push";
import { createApp, WEB_PUSH_MARKER, TTL_SECONDS, URGENCY } from "../app.js";

const here = dirname(fileURLToPath(import.meta.url));
const SECRET = "test-secret";
const keys = webpush.generateVAPIDKeys();

const fakeSub = {
  endpoint: "https://web.push.apple.com/fake/abc",
  keys: { p256dh: "BFakeP256dhKey", auth: "fakeAuth" },
};
const deadSub = {
  endpoint: "https://web.push.apple.com/fake/gone",
  keys: { p256dh: "BFakeP256dhKey2", auth: "fakeAuth2" },
};

const sent = [];
let server, base, dataFile;

before(async () => {
  dataFile = join(await mkdtemp(join(tmpdir(), "push-spike-")), "subs.json");
  const handle = createApp({
    dataFile,
    vapidPublicKey: keys.publicKey,
    sendSecret: SECRET,
    publicDir: join(here, "..", "public"),
    sendNotification: async (sub, payload, opts) => {
      sent.push({ sub, payload: JSON.parse(payload), opts });
      if (sub.endpoint === deadSub.endpoint) {
        const err = new Error("gone");
        err.statusCode = 410;
        throw err;
      }
      return { statusCode: 201 };
    },
  });
  server = createServer(handle);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const post = (path, body, headers = {}) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("serves the page, the manifest and the public key", async () => {
  const page = await fetch(base + "/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Subscribe/);
  const manifest = await (await fetch(base + "/manifest.webmanifest")).json();
  assert.equal(manifest.display, "standalone");
  const { key } = await (await fetch(base + "/vapid-public-key")).json();
  assert.equal(key, keys.publicKey);
});

test("rejects a body that is not a subscription", async () => {
  assert.equal((await post("/subscribe", "not json")).status, 400);
  assert.equal((await post("/subscribe", { endpoint: "http://insecure" })).status, 400);
});

test("stores a subscription in the JSON file, once per endpoint", async () => {
  const r1 = await post("/subscribe", fakeSub);
  assert.equal(r1.status, 201);
  assert.deepEqual(await r1.json(), { stored: 1 });
  const r2 = await post("/subscribe", fakeSub);
  assert.deepEqual(await r2.json(), { stored: 1 });
  const store = JSON.parse(await readFile(dataFile, "utf8"));
  assert.equal(store.subscriptions.length, 1);
  assert.equal(store.subscriptions[0].endpoint, fakeSub.endpoint);
});

test("/send with the wrong secret is refused and nothing is sent", async () => {
  const before = sent.length;
  assert.equal((await post("/send", {})).status, 401);
  assert.equal((await post("/send", {}, { authorization: "Bearer nope" })).status, 401);
  assert.equal(sent.length, before);
});

test("/send delivers one declarative message per live subscription", async () => {
  const r = await post("/send", {}, { authorization: `Bearer ${SECRET}` });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.sent, 1);
  assert.deepEqual(body.failed, []);

  const call = sent.at(-1);
  assert.equal(call.sub.endpoint, fakeSub.endpoint);
  assert.deepEqual(call.sub.keys, fakeSub.keys);

  // Declarative marker, required fields, and a lifetime in the 24–72 h window.
  assert.equal(call.payload.web_push, WEB_PUSH_MARKER);
  assert.equal(call.payload.web_push, 8030);
  assert.ok(call.payload.notification.title.length > 0);
  assert.ok(call.payload.notification.body.length > 0);
  assert.match(call.payload.notification.navigate, /^http:\/\/127\.0\.0\.1:\d+\//);
  assert.equal(call.opts.TTL, TTL_SECONDS);
  assert.ok(call.opts.TTL >= 24 * 3600 && call.opts.TTL <= 72 * 3600);
  assert.equal(call.opts.urgency, URGENCY);
  assert.equal(call.opts.contentEncoding, "aes128gcm");
});

test("a 410 from the push service marks the subscription dead and it is not tried again", async () => {
  await post("/subscribe", deadSub);
  const r1 = await (await post("/send", {}, { authorization: `Bearer ${SECRET}` })).json();
  assert.equal(r1.sent, 1);
  assert.equal(r1.failed.length, 1);
  assert.equal(r1.failed[0].statusCode, 410);

  const counts = await (await fetch(base + "/subscriptions")).json();
  assert.deepEqual(counts, { live: 1, dead: 1 });

  const before = sent.length;
  const r2 = await (await post("/send", {}, { authorization: `Bearer ${SECRET}` })).json();
  assert.equal(r2.sent, 1);
  assert.deepEqual(r2.failed, []);
  assert.equal(sent.length - before, 1);
  assert.equal(sent.at(-1).sub.endpoint, fakeSub.endpoint);
});

test("the real web-push library accepts the payload shape and signs with the VAPID keys", async () => {
  // Encrypts and signs for real, but never hits the network: the request is built and
  // returned instead of sent. Proves the keys, the encoding and the headers line up.
  webpush.setVapidDetails("mailto:test@example.com", keys.publicKey, keys.privateKey);
  const realSub = {
    endpoint: "https://web.push.apple.com/QAbc",
    keys: {
      // A valid uncompressed P-256 point and a 16-byte auth secret, base64url.
      p256dh: webpush.generateVAPIDKeys().publicKey,
      auth: "AAAAAAAAAAAAAAAAAAAAAA",
    },
  };
  const details = webpush.generateRequestDetails(
    realSub,
    JSON.stringify({ web_push: 8030, notification: { title: "t", navigate: "https://x/" } }),
    { TTL: TTL_SECONDS, urgency: URGENCY, contentEncoding: "aes128gcm" },
  );
  assert.equal(details.headers.TTL, TTL_SECONDS);
  assert.equal(details.headers.Urgency, URGENCY);
  assert.equal(details.headers["Content-Encoding"], "aes128gcm");
  assert.match(details.headers.Authorization, /^vapid t=.+, k=.+$/);
  assert.ok(details.body.length > 0);
});
