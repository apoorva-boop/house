# Push spike — the stop-loss for issue #6

**This is a throwaway experiment, not a feature.** It answers one question:

> Can a web push notification, sent from a small Node service, reach a real iPhone
> through Safari's home-screen web app, days after the app was closed?

| Outcome | What happens |
|---|---|
| A notification arrives on the phone, including on day 2 or 3 | Issue #6 gets built |
| Nothing arrives after about two days | #6 is never opened. The app ships on calendar reminders |

Nothing in `apps/`, `apps-script/` or `packages/` depends on this directory.

## What is here

| File | What it does |
|---|---|
| `server.js`, `app.js` | One Node service. Serves the page, stores subscriptions in a JSON file, sends one hard-coded message to every stored subscription |
| `public/` | The page, its manifest (`display: standalone`) and a home-screen icon. **No service worker.** |
| `test/app.test.js` | Proves `/subscribe` and `/send` against a fake subscription. `npm test` |
| `Dockerfile` | What Cloud Run builds |
| `deploy.sh` | `gcloud run deploy` with `--max-instances=1 --min-instances=0 --memory=256Mi` |
| `send.sh` | Curls `/send` with the shared secret |
| `.env.example` | The variable names. Copy to `.env` and fill in. `.env` is gitignored |

The message is Declarative Web Push: the payload carries `"web_push": 8030`, a title, a
body and a `navigate` URL. The lifetime (TTL) is 48 hours and urgency is `high`. Safari
draws the notification itself. There is no `push` handler anywhere, so Apple's
three-strikes silent revocation cannot apply. The `web-push` library does all the
encryption and signing.

Subscriptions are one JSON file. On Cloud Run the disk is wiped whenever the instance
scales to zero, so `deploy.sh` mounts a small Cloud Storage bucket at `/data` and the file
lives there. Still a JSON file, still no database.

## Local proof (already done, you can repeat it)

```bash
cd spike/push
npm install
npm test
```

Seven tests: the page and manifest serve, bad bodies are rejected, a subscription is
stored once per endpoint, the wrong secret gets 401 and sends nothing, the right secret
sends one declarative payload with TTL and urgency, a 410 marks a subscription dead, and
the real `web-push` library signs a request with the VAPID keys.

## What you do by hand, in order

### 0. One-off setup on the Mac

1. Install the Google Cloud CLI if `gcloud` is not on your PATH, and sign in:
   `gcloud auth login`. Pick or create a project with billing enabled. Set a **$1 budget
   alert** on it in the console (Billing → Budgets & alerts).
2. Make the key pair and the secret:

   ```bash
   cd spike/push
   cp .env.example .env
   npx web-push generate-vapid-keys
   openssl rand -hex 32
   ```

   Paste the public key, private key and the hex string into `.env`. Set `VAPID_SUBJECT`
   to `mailto:` your address. Leave `DATA_FILE` alone; `deploy.sh` overrides it.

### 1. Deploy

```bash
./deploy.sh <your-gcp-project-id>
```

Region defaults to `australia-southeast1`; pass a second argument to change it. The first
run creates the bucket and enables Cloud Run and Cloud Build if asked (say yes). It takes a
few minutes. **You should see** a `https://push-spike-….run.app` URL printed at the end.
Open it on the Mac once: a dark page titled "Push spike for issue #6" with a grey
Subscribe button and "Opened from: Safari tab".

### 2. Open it on the iPhone

Open that URL in **Safari** on the iPhone (not Chrome, not a mail app preview).
**You should see** the same page. "Push API" may say MISSING here; that is expected in a
plain tab.

### 3. Add to home screen

Tap Share → **Add to Home Screen** → Add. **You should see** a "Push Spike" icon with a
yellow bell on dark blue.

### 4. Open from the home screen

Close Safari. Tap the icon. **You should see** the page full-screen with:

- Opened from: **home screen (good)** in green
- Push API: **window.pushManager present** in green
- Permission: `default`
- Status: "Ready. Tap Subscribe."

If Push API says MISSING here, stop and note it. That alone is a finding.

### 5. Tap Subscribe

iOS asks whether Push Spike may send notifications. Tap **Allow**.
**You should see** the status turn green: "Subscribed. Server now holds 1 live
subscription(s)…" and the subscription JSON printed below it.

### 6. Close the app

Swipe it away in the app switcher. Lock the phone.

### 7. Send, day 0

On the Mac:

```bash
./send.sh https://push-spike-….run.app
```

**You should see** on the Mac: JSON with `"sent": 1` and `"failed": []`, then `HTTP 200`.
**You should see** on the phone, within a few seconds: a notification titled
"Push spike: it worked" with the time it was sent. Tap it. **You should see** the app open
with a green line "Opened from a push notification. The navigate URL works."

Note the result in the table below. Do not open the app again.

### 8. Send again the next day, and the day after

Run the same `send.sh` on day 1 and day 2 **without having opened the app in between**.
That is the actual question: a closed home-screen app, days later.

| Day | `send.sh` said | Phone showed a notification? | Tap opened the app? |
|---|---|---|---|
| 0 | | | |
| 1 | | | |
| 2 | | | |

If `send.sh` reports a failure with status 404 or 410, Apple has dropped the subscription.
That is a "no". If it reports `"sent": 1` and nothing appears on the phone, that is also a
"no" and the more worrying one.

### 9. Decide, and tear down

Post the table on issue #6 and apply the stop-loss. Then delete the service and bucket so
nothing keeps costing money:

```bash
gcloud run services delete push-spike --region australia-southeast1
gcloud storage rm -r gs://<your-gcp-project-id>-push-spike-data
```

## If something goes wrong

- **Subscribe fails with "Subscribing for push requires an applicationServerKey"** — the
  page could not fetch `/vapid-public-key`. Check the service logs in the Cloud Run console.
- **Subscribe fails with a NotAllowedError** — permission was denied, or the tap was not
  treated as a user gesture. Settings → Notifications → Push Spike → allow, then retry.
- **`send.sh` gets 401** — `SEND_SECRET` in `.env` does not match what was deployed.
  Redeploy.
- **`send.sh` says `BadDeviceToken` or 403 `VapidPkHashMismatch`** — the keys in `.env`
  changed after the phone subscribed. Redeploy with the original keys, or unsubscribe and
  subscribe again on the phone.
- **Subscriptions show `0 live` after a day** — the bucket mount did not take. Check
  `gcloud run services describe push-spike` shows a volume at `/data`.
