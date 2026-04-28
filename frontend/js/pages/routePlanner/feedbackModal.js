// Road feedback modal and submission workflow.

  // 用户反馈弹窗：提交到 PostgreSQL，并在管理员端集中展示
  (function setupFeedbackModal() {
    const COOLDOWN_SECONDS = 60;
    const fab = document.getElementById("fabFeedback");
    const overlay = document.getElementById("feedbackOverlay");
    const closeBtn = document.getElementById("modalClose");
    const locateBtn = document.getElementById("fbLocateBtn");
    const submitBtn = document.getElementById("fbSubmitBtn");
    const toast = document.getElementById("feedbackToast");
    const typeGroup = document.getElementById("fbTypeGroup");
    const severityGroup = document.getElementById("fbSeverityGroup");
    const countBadge = document.getElementById("fbCountBadge");
    const locationInput = document.getElementById("fb-location");
    const commentsInput = document.getElementById("fb-comments");
    const recentWrap = document.getElementById("recentSubmissions");
    const recentList = document.getElementById("recentList");
    if (!fab || !overlay || !submitBtn || !typeGroup || !severityGroup || !locationInput || !commentsInput) return;

    let submissions = [];
    let cooldownRemaining = 0;
    let cooldownTimer = null;

    function escapeHtml(value) {
      return String(value || "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char] || char);
    }

    function showError(id, message) {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = message;
      el.style.display = "block";
    }

    function clearError(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = "";
      el.style.display = "none";
    }

    function clearErrors() {
      ["err-location", "err-type", "err-severity", "err-comments"].forEach(clearError);
      locationInput.classList.remove("input-error");
      commentsInput.classList.remove("input-error");
    }

    function selectedType() {
      return typeGroup.querySelector(".fb-type-btn.active")?.dataset.type || "";
    }

    function selectedSeverity() {
      return severityGroup.querySelector(".fb-severity-btn.active")?.dataset.severity || "";
    }

    function updateBadge() {
      if (!countBadge) return;
      if (!submissions.length) {
        countBadge.style.display = "none";
        countBadge.textContent = "";
        return;
      }
      countBadge.style.display = "inline-flex";
      countBadge.textContent = String(submissions.length);
    }

    function renderRecent() {
      if (!recentWrap || !recentList) return;
      if (!submissions.length) {
        recentWrap.style.display = "none";
        recentList.innerHTML = "";
        return;
      }
      recentWrap.style.display = "block";
      recentList.innerHTML = submissions.slice().reverse().map((item) => `
        <div class="recent-item">
          <div class="recent-item-top">
            <span class="recent-type">${escapeHtml(item.type)}</span>
            <span class="impact-tag ${String(item.severity || "").toLowerCase()}">${escapeHtml(item.severity)}</span>
            <span class="recent-time">${escapeHtml(item.time)}</span>
          </div>
          <div class="recent-loc">📍 ${escapeHtml(item.location)}</div>
          ${item.comment ? `<div class="recent-comment">${escapeHtml(item.comment)}</div>` : ""}
        </div>
      `).join("");
    }

    async function loadRecent() {
      const auth = window.getFastAuth ? window.getFastAuth() : null;
      if (!auth || !auth.token) {
        submissions = [];
        updateBadge();
        renderRecent();
        return;
      }
      try {
        const resp = await window.fastAuthFetch("/api/feedback/mine?limit=10");
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Failed to load feedback");
        submissions = Array.isArray(data.value) ? data.value.map((item) => ({
          id: item.id,
          location: item.location,
          type: item.conditionType,
          severity: item.severity,
          comment: item.comment,
          time: new Date(item.createdAt).toLocaleString()
        })) : [];
      } catch (err) {
        console.error(err);
        submissions = [];
      }
      updateBadge();
      renderRecent();
    }

    function resetForm() {
      locationInput.value = "";
      commentsInput.value = "";
      typeGroup.querySelectorAll(".fb-type-btn").forEach((btn, index) => {
        btn.classList.toggle("active", index === 0);
      });
      severityGroup.querySelectorAll(".fb-severity-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.severity === "MEDIUM");
      });
      if (locateBtn) {
        locateBtn.disabled = false;
        locateBtn.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L12 6M12 18L12 22M2 12L6 12M18 12L22 12"></path>
            <circle cx="12" cy="12" r="4"></circle>
          </svg>
        `;
      }
      clearErrors();
    }

    async function openModal() {
      const auth = window.getFastAuth ? window.getFastAuth() : null;
      if (!auth || !auth.token) {
        window.location.hash = "login";
        return;
      }
      clearErrors();
      await loadRecent();
      overlay.classList.add("open");
    }

    function closeModal() {
      overlay.classList.remove("open");
    }

    function showToast(message) {
      if (!toast) return;
      toast.textContent = message;
      toast.classList.add("show");
      window.setTimeout(() => toast.classList.remove("show"), 3200);
    }

    function validateForm() {
      let valid = true;
      const location = locationInput.value.trim();
      const comments = commentsInput.value.trim();
      if (!location) {
        locationInput.classList.add("input-error");
        showError("err-location", "Please enter a location.");
        valid = false;
      }
      if (!selectedType()) {
        showError("err-type", "Please select a condition type.");
        valid = false;
      }
      if (!selectedSeverity()) {
        showError("err-severity", "Please select a severity level.");
        valid = false;
      }
      if (!comments) {
        commentsInput.classList.add("input-error");
        showError("err-comments", "Please describe the road condition.");
        valid = false;
      }
      return valid;
    }

    function renderCooldownText() {
      if (!submitBtn) return;
      if (cooldownRemaining <= 0) {
        submitBtn.disabled = false;
        submitBtn.classList.remove("btn-cooldown");
        submitBtn.innerHTML = `
          POST FEEDBACK
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M22 2L11 13M22 2L15 22 11 13 2 9l20-7z"></path>
          </svg>
        `;
        return;
      }
      submitBtn.disabled = true;
      submitBtn.classList.add("btn-cooldown");
      submitBtn.textContent = `WAIT ${cooldownRemaining}s BEFORE NEXT REPORT`;
    }

    function startCooldown() {
      cooldownRemaining = COOLDOWN_SECONDS;
      renderCooldownText();
      if (cooldownTimer) window.clearInterval(cooldownTimer);
      cooldownTimer = window.setInterval(() => {
        cooldownRemaining -= 1;
        if (cooldownRemaining <= 0) {
          window.clearInterval(cooldownTimer);
          cooldownTimer = null;
          cooldownRemaining = 0;
        }
        renderCooldownText();
      }, 1000);
    }

    function parseLocationInput(value) {
      const match = String(value || "").trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
      if (!match) return { latitude: null, longitude: null };
      return { latitude: Number(match[1]), longitude: Number(match[2]) };
    }

    async function resolveFeedbackCoordinates(locationText) {
      const direct = parseLocationInput(locationText);
      if (Number.isFinite(direct.latitude) && Number.isFinite(direct.longitude)) return direct;
      try {
        const geo = await geocodeLocation(locationText);
        return {
          latitude: Number.isFinite(Number(geo.lat)) ? Number(geo.lat) : null,
          longitude: Number.isFinite(Number(geo.lon)) ? Number(geo.lon) : null
        };
      } catch (_) {
        return { latitude: null, longitude: null };
      }
    }

    fab.addEventListener("click", () => {
      openModal().catch((err) => {
        console.error(err);
        showToast("Unable to open feedback form right now.");
      });
    });
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeModal();
    });

    typeGroup.querySelectorAll(".fb-type-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        typeGroup.querySelectorAll(".fb-type-btn").forEach((node) => node.classList.remove("active"));
        btn.classList.add("active");
        clearError("err-type");
      });
    });

    severityGroup.querySelectorAll(".fb-severity-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        severityGroup.querySelectorAll(".fb-severity-btn").forEach((node) => node.classList.remove("active"));
        btn.classList.add("active");
        clearError("err-severity");
      });
    });

    if (locateBtn) {
      locateBtn.addEventListener("click", () => {
        if (!navigator.geolocation) {
          showError("err-location", "Geolocation is not supported in this browser.");
          return;
        }
        locateBtn.disabled = true;
        locateBtn.textContent = "...";
        navigator.geolocation.getCurrentPosition((position) => {
          locationInput.value = `${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`;
          locateBtn.disabled = false;
          locateBtn.textContent = "✓";
          locationInput.classList.remove("input-error");
          clearError("err-location");
        }, () => {
          locateBtn.disabled = false;
          locateBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L12 6M12 18L12 22M2 12L6 12M18 12L22 12"></path>
              <circle cx="12" cy="12" r="4"></circle>
            </svg>
          `;
          showError("err-location", "Could not get your current location. Please enter it manually.");
        });
      });
    }

    submitBtn.addEventListener("click", async () => {
      if (cooldownRemaining > 0) return;
      const auth = window.getFastAuth ? window.getFastAuth() : null;
      if (!auth || !auth.token) {
        window.location.hash = "login";
        return;
      }
      clearErrors();
      if (!validateForm()) return;
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting...";
      try {
        const coords = await resolveFeedbackCoordinates(locationInput.value);
        const resp = await window.fastAuthFetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: locationInput.value.trim(),
            conditionType: selectedType(),
            severity: selectedSeverity(),
            comment: commentsInput.value.trim(),
            latitude: coords.latitude,
            longitude: coords.longitude
          })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Submit feedback failed");
        await loadRecent();
        closeModal();
        showToast("Feedback submitted. Thank you for helping the community.");
        resetForm();
        startCooldown();
        if (state.feedbackMapVisible) await refreshFeedbackMapLayer();
        state.routeFeedbackLoadedAt = 0;
        await refreshRouteFeedbackMarkersForSelectedRoute();
        if (isAdmin()) await renderAdminFeedbackPanel();
      } catch (err) {
        submitBtn.disabled = false;
        renderCooldownText();
        showError("err-comments", `Submit failed: ${err.message}`);
      }
    });

    window.addEventListener("fast-auth-changed", () => {
      loadRecent().catch((err) => console.error(err));
    });

    loadRecent().catch((err) => console.error(err));
    resetForm();
    renderCooldownText();
  })();
