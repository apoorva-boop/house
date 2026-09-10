// Client side of the spike. Subscribes with `window.pushManager` (Declarative Web Push,
// Safari 18.4+). There is NO service worker and NO `push` handler: the browser draws the
// notification from the JSON the server sends.

const $ = (id) => document.getElementById(id);
const standalone = window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

function setStatus(text, cls) {
  const el = $("status");
  el.textContent = text;
  el.className = "box" + (cls ? " " + cls : "");
}

function base64UrlToUint8Array(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function refreshStored() {
  try {
    const r = await fetch("/subscriptions");
    const j = await r.json();
    $("stored").textContent = `${j.live} live, ${j.dead} dead`;
  } catch {
    $("stored").textContent = "unknown";
  }
}

async function init() {
  $("mode").textContent = standalone ? "home screen (good)" : "Safari tab (add to home screen first)";
  $("mode").className = standalone ? "ok" : "warn";

  const pm = window.pushManager;
  $("api").textContent = pm ? "window.pushManager present" : "window.pushManager MISSING";
  $("api").className = pm ? "ok" : "bad";

  const perm = typeof Notification !== "undefined" ? Notification.permission : "no Notification API";
  $("perm").textContent = perm;

  await refreshStored();

  if (new URLSearchParams(location.search).get("opened-from-push") === "1") {
    setStatus("Opened from a push notification. The navigate URL works.", "ok");
  } else if (!pm) {
    setStatus("This browser has no window.pushManager. Declarative Web Push is not available here.", "bad");
    return;
  } else if (!standalone) {
    setStatus("Open this from the home-screen icon. Safari only grants push to installed web apps.", "warn");
  } else {
    setStatus("Ready. Tap Subscribe.");
  }

  // Show an existing subscription if there is one.
  try {
    const existing = await pm.getSubscription();
    if (existing) showSubscription(existing, "Already subscribed on this device.");
  } catch {}

  $("subscribe").disabled = false;
}

function showSubscription(sub, note) {
  const json = JSON.stringify(sub.toJSON(), null, 2);
  $("sub").hidden = false;
  $("sub").textContent = `${note}\n\n${json}`;
}

async function subscribe() {
  $("subscribe").disabled = true;
  try {
    // Everything below runs inside the tap handler. Safari requires the permission
    // prompt to come from a direct user gesture.
    const { key } = await (await fetch("/vapid-public-key")).json();
    const sub = await window.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(key),
    });
    $("perm").textContent = Notification.permission;
    const r = await fetch("/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    showSubscription(sub, "Subscribed and stored on the server.");
    setStatus(`Subscribed. Server now holds ${j.stored} live subscription(s). Close this app and run send.sh.`, "ok");
    await refreshStored();
  } catch (err) {
    setStatus(`Subscribe failed: ${err.name ?? ""} ${err.message ?? err}`, "bad");
    $("subscribe").disabled = false;
  }
}

$("subscribe").addEventListener("click", subscribe);
init();
