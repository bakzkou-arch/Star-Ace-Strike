(() => {
  const { offlineVersion: version } = document.currentScript.dataset;
  const button = document.getElementById("save-offline");
  const status = document.getElementById("save-offline-status");
  const english = () => document.documentElement.lang === "en";
  const say = (ja, en) => { status.textContent = english() ? en : ja; };
  if (!navigator.serviceWorker || !window.caches || !window.isSecureContext) return;
  button.hidden = false;
  status.hidden = false;
  const register = () => navigator.serviceWorker.register("./offline-worker.js", { updateViaCache: "none" });
  const saved = () => caches.match(new URL("./", document.baseURI), { cacheName: "sky-strike-offline-" + version });
  const ready = () => say("オフラインでプレイできます", "Ready for offline play");

  function waitForWorker(registration) {
    const worker = registration.installing ?? registration.waiting ?? registration.active;
    if (!worker) throw new Error("Offline worker unavailable");
    if (worker.state === "activated") return worker;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("Worker timed out")), 20000);
      function finish(error) {
        clearTimeout(timer);
        worker.removeEventListener("statechange", changed);
        if (error) reject(error);
        else resolve(worker);
      }
      function changed() {
        if (worker.state === "activated") finish();
        else if (worker.state === "redundant") finish(new Error("Worker was replaced"));
      }
      worker.addEventListener("statechange", changed);
      changed();
    });
  }
  function saveWith(worker) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        channel.port1.close();
        reject(new Error("Download timed out"));
      }, 240000);
      channel.port1.onmessage = ({ data }) => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(data);
      };
      worker.postMessage({ type: "save-game", version }, [channel.port2]);
    });
  }
  register().catch(() => {});
  saved().then(response => { if (response) ready(); }).catch(() => {});
  button.onclick = async () => {
    button.disabled = true;
    try {
      if (await saved()) { ready(); return; }
      say("ゲームと音源を保存中… この画面を開いたままお待ちください。", "Saving game and audio… Keep this screen open.");
      const response = await saveWith(await waitForWorker(await register()));
      if (response.ok) ready();
      else if (response.update) say("ページを再読み込みして、もう一度保存してください。", "Reload the page and save again.");
      else if (response.reason==="quota") say("空き容量が足りません。容量を確保して再試行してください。", "Storage is full. Free some space and try again.");
      else throw new Error("Could not save the game");
    } catch {
      say("保存できませんでした。接続と空き容量を確認し、もう一度お試しください。", "Save failed. Check your connection and available storage, then try again.");
    } finally {
      button.disabled = false;
    }
  };
})();
