// Mobile navigation menu bindings.
document.getElementById("mobile-menu-btn")?.addEventListener("click", () => {
  document.getElementById("mobile-menu-panel")?.classList.toggle("hidden");
});

document.querySelectorAll("#mobile-menu-panel a").forEach((link) => {
  link.addEventListener("click", () => {
    document.getElementById("mobile-menu-panel")?.classList.add("hidden");
  });
});
