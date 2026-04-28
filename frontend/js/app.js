// FAST frontend startup only.
(function () {
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    let reloadedForNewWorker = false;
    navigator.serviceWorker.getRegistrations?.().then((registrations) => {
      registrations.forEach((registration) => {
        const scopePath = new URL(registration.scope).pathname;
        if (scopePath.startsWith("/ui2/")) registration.unregister();
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadedForNewWorker) return;
      reloadedForNewWorker = true;
      window.location.reload();
    });
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" })
        .then((registration) => {
          registration.update();
          console.log("Service worker registered");
        })
        .catch((err) => console.error("Service worker failed:", err));
    });
  }

  function startFrontend() {
    if (typeof bootstrapDemo !== "function") {
      console.error("bootstrapDemo is not available. Check frontend script order.");
      return;
    }
    bootstrapDemo();
  }

  registerServiceWorker();
  document.addEventListener("DOMContentLoaded", startFrontend);
}());
