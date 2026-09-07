import { createRoot } from "react-dom/client";
import { AppPresenter } from "./app/AppPresenter.js";
import { newId } from "./app/ids.js";
import { Shell } from "./views/Shell.js";
import "./views/styles.css";

const app = new AppPresenter({
  store: window.localStorage,
  idb: window.indexedDB,
  newId,
  now: Date.now,
});

const container = document.getElementById("root");
if (container === null) throw new Error("missing #root element");

createRoot(container).render(<Shell app={app} />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/house/sw.js");
  });
}
