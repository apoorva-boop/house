import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import webpush from "web-push";
import { createApp } from "./app.js";

const here = dirname(fileURLToPath(import.meta.url));

const required = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "SEND_SECRET"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(", ")}. See .env.example.`);
  process.exit(1);
}

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

const handle = createApp({
  dataFile: process.env.DATA_FILE ?? join(here, "data", "subscriptions.json"),
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  sendSecret: process.env.SEND_SECRET,
  publicDir: join(here, "public"),
  sendNotification: (sub, payload, opts) => webpush.sendNotification(sub, payload, opts),
});

const port = Number(process.env.PORT ?? 8080);
createServer(handle).listen(port, () => {
  console.log(`push spike listening on :${port}`);
});
