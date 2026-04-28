// Admin users and feedback history panels.

  // 管理员用户统计面板渲染（用户总数、验证数、会话数等）
  async function renderAdminUsersPanel() {
    const panel = document.getElementById("admin-users-panel");
    const statsEl = document.getElementById("admin-user-stats");
    const tbody = document.getElementById("admin-users-tbody");
    if (!panel || !statsEl || !tbody) return;
    if (!isAdmin()) {
      panel.classList.add("hidden");
      return;
    }

    panel.classList.remove("hidden");
    try {
      const [summaryResp, usersResp] = await Promise.all([
        window.fastAuthFetch("/api/admin/users/summary"),
        window.fastAuthFetch("/api/admin/users?limit=200")
      ]);
      const summary = await summaryResp.json();
      const usersData = await usersResp.json();
      if (!summaryResp.ok) throw new Error(summary.error || "Failed to load summary");
      if (!usersResp.ok) throw new Error(usersData.error || "Failed to load users");

      const stats = [
        ["Total", summary.totalUsers],
        ["Verified", summary.verifiedUsers],
        ["Admins", summary.adminUsers],
        ["Users", summary.normalUsers],
        ["Active Sessions", summary.activeSessions],
        ["New 7 Days", summary.newUsers7d]
      ];

      statsEl.innerHTML = stats.map(([k, v]) => `
        <div class="admin-user-stat">
          <span class="k">${k}</span>
          <span class="v">${v}</span>
        </div>
      `).join("");

      tbody.innerHTML = (usersData.value || []).map((u) => `
        <tr>
          <td>${u.id}</td>
          <td>${u.name}</td>
          <td>${u.email}</td>
          <td>${u.role}</td>
          <td>${u.email_verified ? "Yes" : "No"}</td>
          <td>${new Date(u.created_at).toLocaleString()}</td>
        </tr>
      `).join("");
    } catch (err) {
      statsEl.innerHTML = `<div class="admin-user-stat"><span class="k">Error</span><span class="v">-</span></div>`;
      tbody.innerHTML = `<tr><td colspan="6">Failed to load user table: ${err.message}</td></tr>`;
    }
  }

  async function renderAdminFeedbackPanel() {
    const panel = document.getElementById("admin-users-panel");
    const tbody = document.getElementById("admin-feedback-tbody");
    if (!panel || !tbody) return;
    if (!isAdmin()) {
      panel.classList.add("hidden");
      return;
    }
    try {
      const resp = await window.fastAuthFetch("/api/admin/feedback?limit=300");
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to load feedback");
      state.adminFeedbackItems = Array.isArray(data.value) ? data.value : [];
      const items = getFilteredAdminFeedbackItems();
      renderAdminFeedbackRows(tbody, items, "No feedback submitted yet.");
      if (state.feedbackMapVisible) refreshFeedbackMapLayer().catch((err) => console.error(err));
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8">Failed to load feedback table: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function getFilteredAdminFeedbackItems() {
    const items = Array.isArray(state.adminFeedbackItems) ? state.adminFeedbackItems : [];
    const severity = String(state.adminFeedbackFilters?.severity || "all").toUpperCase();
    const timeRange = String(state.adminFeedbackFilters?.timeRange || "all");
    const now = Date.now();
    return items.filter((item) => {
      if (severity !== "ALL" && String(item.severity || "").toUpperCase() !== severity) return false;
      if (timeRange === "all") return true;
      const createdAt = new Date(item.createdAt).getTime();
      if (!Number.isFinite(createdAt)) return false;
      const diff = now - createdAt;
      if (timeRange === "24h") return diff <= 24 * 60 * 60 * 1000;
      if (timeRange === "7d") return diff <= 7 * 24 * 60 * 60 * 1000;
      if (timeRange === "30d") return diff <= 30 * 24 * 60 * 60 * 1000;
      return true;
    });
  }

  function applyAdminFeedbackFilters() {
    const tbody = document.getElementById("admin-feedback-tbody");
    if (!tbody) return;
    const items = getFilteredAdminFeedbackItems();
    renderAdminFeedbackRows(tbody, items, "No feedback matches the selected filters.");
  }

  function adminFeedbackClipCell(value, className) {
    const text = String(value || "-");
    return `
      <td class="${className || ""}" title="${escapeHtml(text)}">
        <span class="admin-feedback-clip">${escapeHtml(text)}</span>
      </td>
    `;
  }

  function renderAdminFeedbackRows(tbody, items, emptyMessage) {
    if (!tbody) return;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="8">${escapeHtml(emptyMessage)}</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map((item) => {
      const id = String(item.id || "");
      return `
        <tr data-admin-feedback-row="${escapeHtml(id)}">
          <td>${escapeHtml(new Date(item.createdAt).toLocaleString())}</td>
          ${adminFeedbackClipCell(item.userName || "-", "admin-feedback-short")}
          ${adminFeedbackClipCell(item.userEmail || "-", "admin-feedback-short")}
          ${adminFeedbackClipCell(item.location || "-", "admin-feedback-short")}
          <td>${escapeHtml(item.conditionType || "-")}</td>
          <td>${escapeHtml(item.severity || "-")}</td>
          <td class="admin-feedback-comment" title="${escapeHtml(item.comment || "-")}">${escapeHtml(item.comment || "-")}</td>
          <td class="admin-feedback-actions-cell">
            <button type="button" class="admin-feedback-delete-btn" data-admin-feedback-delete="${escapeHtml(id)}">Delete</button>
          </td>
        </tr>
      `;
    }).join("");
    bindAdminFeedbackDeleteButtons(tbody);
  }

  function bindAdminFeedbackDeleteButtons(tbody) {
    tbody.querySelectorAll("[data-admin-feedback-delete]").forEach((btn) => {
      btn.onclick = async () => {
        const id = String(btn.getAttribute("data-admin-feedback-delete") || "").trim();
        if (!id) return;
        if (!window.confirm("Delete this feedback record?")) return;
        btn.disabled = true;
        btn.textContent = "Deleting...";
        try {
          const resp = await window.fastAuthFetch(`/api/admin/feedback/${encodeURIComponent(id)}`, {
            method: "DELETE"
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || "Failed to delete feedback");
          state.adminFeedbackItems = (Array.isArray(state.adminFeedbackItems) ? state.adminFeedbackItems : [])
            .filter((item) => String(item.id) !== id);
          applyAdminFeedbackFilters();
          if (state.feedbackMapVisible) await refreshFeedbackMapLayer();
          state.routeFeedbackLoadedAt = 0;
          if (typeof refreshRouteFeedbackMarkersForSelectedRoute === "function") {
            await refreshRouteFeedbackMarkersForSelectedRoute();
          }
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "Delete";
          alert(`Failed to delete feedback: ${err.message}`);
        }
      };
    });
  }
