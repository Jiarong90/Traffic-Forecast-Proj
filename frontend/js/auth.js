// FAST - 页面切换、登录状态、Profile/Settings 管理
// 说明：
// 1) 本自执行模块负责登录/注册/登出、右上角用户菜单、Profile/Settings 数据读写。
// 2) 会话信息保存在 sessionStorage，并通过自定义事件通知其他模块（地图、告警）同步刷新。
// 3) 该模块不做复杂业务计算，主要承担 UI 状态与后端接口之间的编排。

(function () {

  var STORAGE_KEY = "fast_auth";
  var navTabs = document.querySelectorAll(".nav-tab");
  var pages = document.querySelectorAll(".page");
  var mainNav = document.getElementById("main-nav");
  var headerEl = document.querySelector(".header");
  var homeDeck = document.getElementById("home-scroll-deck");
  var homeDots = Array.prototype.slice.call(document.querySelectorAll(".home-slide-dot"));
  var loginBtn = document.getElementById("header-login-btn");
  var signupBtn = document.getElementById("header-signup-btn");
  var guestAuthActions = document.getElementById("guest-auth-actions");
  var userMenuWrap = document.getElementById("user-menu-wrap");
  var userDropdown = document.getElementById("user-dropdown");
  var userDisplayName = document.getElementById("user-display-name");
  var aboutMemberOverlay = document.getElementById("aboutMemberOverlay");
  var aboutMemberClose = document.getElementById("aboutMemberClose");
  var aboutMemberPhoto = document.getElementById("aboutMemberPhoto");
  var aboutMemberName = document.getElementById("aboutMemberName");
  var aboutMemberRole = document.getElementById("aboutMemberRole");
  var aboutMemberBio = document.getElementById("aboutMemberBio");
  var menuProfileLink = document.getElementById("menu-profile-link");
  var menuSettingsLink = document.getElementById("menu-settings-link");
  var adminUsersTab = document.getElementById("admin-users-tab");
  var loginForm = document.getElementById("login-form");
  var signupForm = document.getElementById("signup-form");
  var signupFeedback = document.getElementById("signup-feedback");
  var signupSendCodeBtn = document.getElementById("signup-send-code-btn");
  var signupCodeRequested = false;
  var signupCodeCooldownTimer = null;
  var signupCodeCooldownLeft = 0;
  var signupSendCodeBtnDefaultText = signupSendCodeBtn ? signupSendCodeBtn.textContent : "SEND CODE";

  var settingsFeedback = document.getElementById("settings-feedback");
  var settingsEmailInput = document.getElementById("settings-email");
  var settingsNameInput = document.getElementById("settings-name");
  var settingsCommuteGoInput = document.getElementById("settings-commute-go");
  var settingsCommuteBackInput = document.getElementById("settings-commute-back");
  var settingsSaveProfileBtn = document.getElementById("settings-save-profile-btn");
  var settingsSaveRoutesBtn = document.getElementById("settings-save-routes-btn");
  var settingsChangePasswordBtn = document.getElementById("settings-change-password-btn");
  var settingsDeleteAccountBtn = document.getElementById("settings-delete-account-btn");
  var settingsVehiclesList = document.getElementById("settings-vehicles-list");
  var settingsAddVehicleBtn = document.getElementById("settings-add-vehicle-btn");
  var settingsVehicleForm = document.getElementById("settings-vehicle-form");
  var vehicleFormNameInput = document.getElementById("vf-name");
  var vehicleFormTypeInput = document.getElementById("vf-vehicle-type");
  var vehicleFormFuelInput = document.getElementById("vf-fuel-grade");
  var vehicleFormConsumptionInput = document.getElementById("vf-consumption");
  var vehicleFormSaveBtn = document.getElementById("vf-save-btn");
  var vehicleFormCancelBtn = document.getElementById("vf-cancel-btn");
  var vehicleFormFeedback = document.getElementById("vf-feedback");
  var settingsPasswordCurrentInput = document.getElementById("settings-password-current");
  var settingsPasswordNewInput = document.getElementById("settings-password-new");
  var profileNameEl = document.getElementById("profile-name");
  var profileEmailEl = document.getElementById("profile-email");
  var profileMembershipWrap = document.getElementById("profile-membership-wrap");
  var profileMembershipBtn = document.getElementById("profile-membership-btn");
  var profileMembershipOverlay = document.getElementById("profile-membership-overlay");
  var profileMembershipClose = document.getElementById("profile-membership-close");
  var profileMembershipTitle = document.getElementById("profile-membership-title");
  var profileMembershipSub = document.getElementById("profile-membership-sub");
  var profileMembershipList = document.getElementById("profile-membership-list");
  var profileMembershipUpgrade = document.getElementById("profile-membership-upgrade");
  var profileMembershipConfirmBtn = document.getElementById("profile-membership-confirm-btn");
  var profileBioInput = document.getElementById("profile-bio");
  var profileGenderInput = document.getElementById("profile-gender");
  var profileBirthdayInput = document.getElementById("profile-birthday");
  var profileRegionInput = document.getElementById("profile-region");
  var profileProfessionInput = document.getElementById("profile-profession");
  var profileSchoolInput = document.getElementById("profile-school");
  var profileSaveBtn = document.getElementById("profile-save-btn");
  var profileFeedback = document.getElementById("profile-feedback");
  var profileAutoSaveTimer = null;
  var profileMutationSeq = 0;
  var homeWheelLocked = false;
  var homeCurrentSlide = 0;
  var publicPageIds = ["home", "business-service-center", "about", "dashboard", "map-view", "route-planner", "weather", "habit-routes", "alerts", "alert-detail", "login", "signup"];
  var userSettingsCache = {
    companyLocation: "",
    homeLocation: "",
    frequentPlaces: [],
    commuteToWorkTime: "",
    commuteToHomeTime: "",
    frequentRoutes: [],
    vehicles: []
  };
  var userProfileCache = {
    memberTier: "free",
    memberExpiresAt: "",
    bio: "",
    gender: "",
    birthday: "",
    region: "",
    profession: "",
    school: ""
  };



  // 停止“发送验证码”按钮的倒计时，并恢复可点击状态
  function stopSignupCodeCooldown() {
    if (signupCodeCooldownTimer) {
      clearInterval(signupCodeCooldownTimer);
      signupCodeCooldownTimer = null;
    }
    signupCodeCooldownLeft = 0;
    if (signupSendCodeBtn) {
      signupSendCodeBtn.disabled = false;
      signupSendCodeBtn.textContent = signupSendCodeBtnDefaultText;
    }
  }

  // 启动验证码按钮倒计时：倒计时期间禁止重复发送
  function startSignupCodeCooldown(seconds) {
    stopSignupCodeCooldown();
    signupCodeCooldownLeft = Math.max(1, parseInt(seconds || 60, 10) || 60);
    if (!signupSendCodeBtn) return;
    signupSendCodeBtn.disabled = true;
    signupSendCodeBtn.textContent = `RESEND IN ${signupCodeCooldownLeft}s`;
    signupCodeCooldownTimer = setInterval(function () {
      signupCodeCooldownLeft -= 1;
      if (signupCodeCooldownLeft <= 0) {
        stopSignupCodeCooldown();
        return;
      }
      if (signupSendCodeBtn) signupSendCodeBtn.textContent = `RESEND IN ${signupCodeCooldownLeft}s`;
    }, 1000);
  }

  // 前端邮箱校验：基础邮箱格式 + 屏蔽测试域名
  function isValidEmail(email) {
    var value = String(email || "").trim().toLowerCase();
    var basic = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
    if (!basic) return false;
    var blockedDomains = ["example.com", "test.com", "localhost", "local"];
    var domain = value.split("@")[1] || "";
    return blockedDomains.indexOf(domain) === -1;
  }

  // 前端密码校验：至少 6 位，且包含大小写字母与数字
  function isValidPassword(password) {
    var value = String(password || "");
    return value.length >= 6 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
  }

  // 读取本地会话；若解析失败则返回 null（防止 JSON 异常影响页面）
  function getStoredAuth() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // 写入/清理会话，并广播全局事件通知其他模块刷新状态
  function setStoredAuth(auth) {
    if (auth) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
    else sessionStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("fast-auth-changed", { detail: auth || null }));
  }

  // Settings 页面统一反馈入口：成功/失败都通过同一块提示区域显示
  function setSettingsFeedback(text, isError) {
    if (!settingsFeedback) return;
    settingsFeedback.textContent = text || "";
    settingsFeedback.style.color = isError ? "#dc2626" : "#166534";
  }

  function setProfileFeedback(text, isError) {
    if (!profileFeedback) return;
    profileFeedback.textContent = text || "";
    profileFeedback.style.color = isError ? "#dc2626" : "#166534";
  }

  function markProfileDirty() {
    profileMutationSeq += 1;
  }

  // 更新内存中的用户偏好缓存，并广播事件让路径规划/地图模块更新“常用地点/路线”
  function setUserSettings(settings) {
    userSettingsCache = {
      companyLocation: String(settings?.companyLocation || ""),
      homeLocation: String(settings?.homeLocation || ""),
      frequentPlaces: Array.isArray(settings?.frequentPlaces) ? settings.frequentPlaces.slice(0, 4) : [],
      commuteToWorkTime: String(settings?.commuteToWorkTime || ""),
      commuteToHomeTime: String(settings?.commuteToHomeTime || ""),
      frequentRoutes: Array.isArray(settings?.frequentRoutes) ? settings.frequentRoutes.slice(0, 3) : [],
      vehicles: Array.isArray(settings?.vehicles) ? settings.vehicles.slice(0, 3) : []
    };
    window.dispatchEvent(new CustomEvent("fast-settings-changed", { detail: userSettingsCache }));
  }

  window.getFastUserSettings = function () {
    return userSettingsCache;
  };

  function setUserProfile(profile) {
    userProfileCache = {
      memberTier: String(profile?.memberTier || "free"),
      memberExpiresAt: String(profile?.memberExpiresAt || ""),
      bio: String(profile?.bio || ""),
      gender: String(profile?.gender || ""),
      birthday: String(profile?.birthday || ""),
      region: String(profile?.region || ""),
      profession: String(profile?.profession || ""),
      school: String(profile?.school || "")
    };
  }

  function normalizeDateInputValue(value) {
    var raw = String(value || "").trim();
    if (!raw) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    var parsed = new Date(raw);
    if (!Number.isFinite(parsed.getTime())) return "";
    return parsed.toISOString().slice(0, 10);
  }

  // 从设置页读取最多 3 条常用路线；如果某一行只填了起点/终点之一则直接报错阻止保存
  function readRouteRowsFromForm() {
    var routes = [];
    for (var i = 1; i <= 3; i += 1) {
      var nameEl = document.getElementById("settings-route-name-" + i);
      var startEl = document.getElementById("settings-route-start-" + i);
      var endEl = document.getElementById("settings-route-end-" + i);
      var name = (nameEl && nameEl.value || "").trim();
      var start = (startEl && startEl.value || "").trim();
      var end = (endEl && endEl.value || "").trim();
      if (!start && !end && !name) continue;
      if (!start || !end) {
        throw new Error("Frequent route " + i + " needs both start and end.");
      }
      routes.push({
        name: name || ("Route " + i),
        start: start,
        end: end
      });
    }
    return routes.slice(0, 3);
  }

  function readPlaceRowsFromForm() {
    var places = [];
    for (var i = 1; i <= 4; i += 1) {
      var nameEl = document.getElementById("settings-place-name-" + i);
      var queryEl = document.getElementById("settings-place-query-" + i);
      var name = (nameEl && nameEl.value || "").trim();
      var query = (queryEl && queryEl.value || "").trim();
      if (!name && !query) continue;
      if (!name || !query) {
        throw new Error("Frequent location " + i + " needs both place name and postal/place.");
      }
      places.push({
        name: name.slice(0, 40),
        query: query.slice(0, 160)
      });
    }
    return places.slice(0, 4);
  }

  function clearVehicleForm() {
    if (vehicleFormNameInput) vehicleFormNameInput.value = "";
    if (vehicleFormTypeInput) vehicleFormTypeInput.value = "sedan";
    if (vehicleFormFuelInput) vehicleFormFuelInput.value = "ron95";
    if (vehicleFormConsumptionInput) vehicleFormConsumptionInput.value = "";
    if (vehicleFormFeedback) vehicleFormFeedback.textContent = "";
  }

  function buildUserSettingsPayload() {
    return {
      frequentPlaces: readPlaceRowsFromForm(),
      commuteToWorkTime: (settingsCommuteGoInput && settingsCommuteGoInput.value || "").trim(),
      commuteToHomeTime: (settingsCommuteBackInput && settingsCommuteBackInput.value || "").trim(),
      frequentRoutes: readRouteRowsFromForm(),
      vehicles: Array.isArray(userSettingsCache.vehicles) ? userSettingsCache.vehicles.slice(0, 3) : []
    };
  }

  async function persistUserSettings(customSuccessText) {
    const payload = buildUserSettingsPayload();
    const resp = await window.fastAuthFetch("/api/user/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Save settings failed");
    setUserSettings(data.settings || payload);
    if (customSuccessText) setSettingsFeedback(customSuccessText, false);
    return data.settings || payload;
  }

  async function persistVehiclesOnly(customSuccessText) {
    const payload = {
      vehicles: Array.isArray(userSettingsCache.vehicles) ? userSettingsCache.vehicles.slice(0, 3) : []
    };
    const resp = await window.fastAuthFetch("/api/user/settings/vehicles", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Failed to save vehicles");
    userSettingsCache.vehicles = Array.isArray(data.vehicles) ? data.vehicles.slice(0, 3) : payload.vehicles;
    if (window.refreshTripCostVehicleSelect) window.refreshTripCostVehicleSelect();
    if (customSuccessText) setSettingsFeedback(customSuccessText, false);
    return userSettingsCache.vehicles;
  }

  function renderVehicleList() {
    if (!settingsVehiclesList) return;
    const vehicles = Array.isArray(userSettingsCache.vehicles) ? userSettingsCache.vehicles.slice(0, 3) : [];
    const typeLabel = { sedan: "Sedan", suv: "SUV", mpv: "MPV", motorcycle: "Motorcycle" };
    const fuelLabel = { ron92: "RON 92", ron95: "RON 95", ron98: "RON 98" };
    const esc = function (value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    };
    if (settingsAddVehicleBtn) settingsAddVehicleBtn.classList.toggle("hidden", vehicles.length >= 3);
    if (!vehicles.length) {
      settingsVehiclesList.innerHTML = `<p style="font-size:13px;color:#999;margin:8px 0;">No vehicles saved yet.</p>`;
      return;
    }
    settingsVehiclesList.innerHTML = vehicles.map((v, i) => `
      <div class="vehicle-item">
        <div class="vehicle-item-left">
          <span class="vehicle-item-name">${esc(v.name || `Vehicle ${i + 1}`)}</span>
          <span class="vehicle-item-meta">${esc(typeLabel[v.vehicleType] || "Sedan")} · ${Number(v.consumption || 0).toFixed(1)}L/100km · ${esc(fuelLabel[v.fuelGrade] || "RON 95")}</span>
        </div>
        <button type="button" class="btn-vehicle-delete" data-vehicle-index="${i}">Delete</button>
      </div>
    `).join("");
    settingsVehiclesList.querySelectorAll(".btn-vehicle-delete").forEach((btn) => {
      btn.addEventListener("click", async function () {
        const idx = Number(btn.getAttribute("data-vehicle-index"));
        if (!Number.isInteger(idx) || idx < 0) return;
        const nextVehicles = Array.isArray(userSettingsCache.vehicles) ? userSettingsCache.vehicles.slice(0, 3) : [];
        nextVehicles.splice(idx, 1);
        userSettingsCache.vehicles = nextVehicles;
        renderVehicleList();
        if (window.refreshTripCostVehicleSelect) window.refreshTripCostVehicleSelect();
        try {
          await persistVehiclesOnly("Vehicle list updated.");
        } catch (err) {
          setSettingsFeedback("Save failed: " + err.message, true);
        }
      });
    });
  }

  // 将“当前用户 + 设置”回填到 Settings 表单，保证刷新页面后输入框状态可恢复
  function fillSettingsForm(user, settings) {
    if (settingsEmailInput) settingsEmailInput.value = user?.email || "";
    if (settingsNameInput) settingsNameInput.value = user?.name || "";
    if (settingsCommuteGoInput) settingsCommuteGoInput.value = settings?.commuteToWorkTime || "";
    if (settingsCommuteBackInput) settingsCommuteBackInput.value = settings?.commuteToHomeTime || "";
    var places = Array.isArray(settings?.frequentPlaces) ? settings.frequentPlaces.slice(0, 4) : [];
    for (var p = 1; p <= 4; p += 1) {
      var place = places[p - 1] || {};
      var placeNameEl = document.getElementById("settings-place-name-" + p);
      var placeQueryEl = document.getElementById("settings-place-query-" + p);
      if (placeNameEl) placeNameEl.value = place.name || "";
      if (placeQueryEl) placeQueryEl.value = place.query || "";
    }
    var routes = Array.isArray(settings?.frequentRoutes) ? settings.frequentRoutes.slice(0, 3) : [];
    for (var i = 1; i <= 3; i += 1) {
      var row = routes[i - 1] || {};
      var nameEl = document.getElementById("settings-route-name-" + i);
      var startEl = document.getElementById("settings-route-start-" + i);
      var endEl = document.getElementById("settings-route-end-" + i);
      if (nameEl) nameEl.value = row.name || "";
      if (startEl) startEl.value = row.start || "";
      if (endEl) endEl.value = row.end || "";
    }
    renderVehicleList();
    if (window.refreshTripCostVehicleSelect) window.refreshTripCostVehicleSelect();
  }

  function fillProfileForm(profile) {
    var data = profile || userProfileCache;
    if (profileBioInput) profileBioInput.value = data.bio || "";
    if (profileGenderInput) profileGenderInput.value = data.gender || "";
    if (profileBirthdayInput) profileBirthdayInput.value = normalizeDateInputValue(data.birthday);
    if (profileRegionInput) profileRegionInput.value = data.region || "";
    if (profileProfessionInput) profileProfessionInput.value = data.profession || "";
    if (profileSchoolInput) profileSchoolInput.value = data.school || "";
  }

  function formatMembershipLabel(user) {
    if (!user || user.role === "admin") return "";
    return String(user.memberTier || "free").toLowerCase() === "advanced" ? "ADVANCED USER" : "FREE USER";
  }

  function openMembershipModal() {
    var auth = getStoredAuth();
    var user = auth && auth.user;
    if (!user || user.role === "admin") return;
    var isAdvanced = String(user.memberTier || "free").toLowerCase() === "advanced";
    if (profileMembershipTitle) profileMembershipTitle.textContent = formatMembershipLabel(user);
    if (profileMembershipSub) profileMembershipSub.textContent = "";
    if (profileMembershipList) profileMembershipList.innerHTML = "";
    if (profileMembershipUpgrade) {
      profileMembershipUpgrade.classList.toggle("hidden", isAdvanced);
    }
    if (profileMembershipOverlay) profileMembershipOverlay.classList.remove("hidden");
  }

  function closeMembershipModal() {
    if (profileMembershipOverlay) profileMembershipOverlay.classList.add("hidden");
  }

  function syncProfileCacheFromForm(options) {
    markProfileDirty();
    userProfileCache.bio = (profileBioInput && profileBioInput.value || "").trim();
    userProfileCache.gender = (profileGenderInput && profileGenderInput.value || "").trim();
    userProfileCache.birthday = (profileBirthdayInput && profileBirthdayInput.value || "").trim();
    userProfileCache.region = (profileRegionInput && profileRegionInput.value || "").trim();
    userProfileCache.profession = (profileProfessionInput && profileProfessionInput.value || "").trim();
    userProfileCache.school = (profileSchoolInput && profileSchoolInput.value || "").trim();
  }

  async function saveUserProfileToServer(options) {
    var auth = getStoredAuth();
    if (!auth || !auth.user) return;
    syncProfileCacheFromForm(options);
    const payload = {
      bio: userProfileCache.bio,
      gender: userProfileCache.gender,
      birthday: userProfileCache.birthday,
      region: userProfileCache.region,
      profession: userProfileCache.profession,
      school: userProfileCache.school
    };
    const resp = await window.fastAuthFetch("/api/user/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Save profile failed");
    setUserProfile(data.profile || payload);
    try {
      renderProfile(data.user || auth.user);
    } catch (_) {
      fillProfileForm(userProfileCache);
    }
  }

  // Profile 页面展示基础信息 + 可编辑扩展资料
  function renderProfile(user) {
    if (profileNameEl) profileNameEl.textContent = user?.name || "--";
    if (profileEmailEl) profileEmailEl.textContent = user?.email || "--";
    if (profileMembershipWrap) {
      var showMembership = !!(user && user.role !== "admin");
      profileMembershipWrap.classList.toggle("hidden", !showMembership);
      if (profileMembershipBtn && showMembership) {
        var label = formatMembershipLabel(user);
        profileMembershipBtn.textContent = label;
        profileMembershipBtn.classList.toggle("advanced", label === "ADVANCED USER");
      }
    }
    fillProfileForm(userProfileCache);
  }

  // 拉取服务端用户设置并同步到：
  // 1) 本地 auth（后端可能返回更新后的 user）
  // 2) 本地 settings 缓存
  // 3) Profile/Settings 的页面显示
  async function loadUserSettingsFromServer() {
    var auth = getStoredAuth();
    if (!auth || !auth.token) {
      setUserSettings({});
      return;
    }
    const resp = await window.fastAuthFetch("/api/user/settings");
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Load settings failed");
    if (data.user) {
      setStoredAuth({ token: auth.token, user: data.user });
      updateHeaderAuth();
      renderProfile(data.user);
    }
    setUserSettings(data.settings || {});
    fillSettingsForm(data.user || auth.user, data.settings || {});
  }

  async function loadUserProfileFromServer() {
    var auth = getStoredAuth();
    if (!auth || !auth.token) {
      setUserProfile({});
      fillProfileForm({});
      return;
    }
    var requestMutationSeq = profileMutationSeq;
    const resp = await window.fastAuthFetch("/api/user/profile");
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Load profile failed");
    if (requestMutationSeq !== profileMutationSeq) return;
    if (data.user) {
      setStoredAuth({ token: auth.token, user: data.user });
      updateHeaderAuth();
    }
    setUserProfile(data.profile || {});
    renderProfile(data.user || auth.user);
  }

  window.getFastAuth = getStoredAuth;
  window.fastAuthFetch = function (url, options) {
    var auth = getStoredAuth();
    var opts = options || {};
    var headers = Object.assign({}, opts.headers || {});
    if (auth && auth.token) headers.Authorization = "Bearer " + auth.token;
    if (opts.body && !headers["Content-Type"] && !headers["content-type"] && !(opts.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    return fetch(url, Object.assign({}, opts, { headers: headers }));
  };

  // 根据登录态刷新头部：登录按钮、用户菜单、管理员样式标记（body.is-admin）
  function updateHeaderAuth() {
    var auth = getStoredAuth();
    var user = auth && auth.user;
    if (guestAuthActions) guestAuthActions.classList.toggle('hidden', !!user);
    if (loginBtn) loginBtn.classList.toggle('hidden', !!user);
    if (signupBtn) signupBtn.classList.toggle('hidden', !!user);
    if (userMenuWrap) userMenuWrap.classList.toggle('hidden', !user);
    if (userDisplayName && user && user.name) {
      userDisplayName.textContent = user.name + (user.role === 'admin' ? ' (Admin)' : '');
    }
    if (adminUsersTab) adminUsersTab.classList.toggle('hidden', !(user && user.role === 'admin'));
    if (mainNav) mainNav.classList.remove('hidden');
    document.body.classList.toggle('is-admin', !!(user && user.role === 'admin'));
    updateTopChromeHeight();
  }

  function updateTopChromeHeight() {
    var total = 0;
    if (headerEl) total += headerEl.offsetHeight || 0;
    if (mainNav && !mainNav.classList.contains("hidden")) total += mainNav.offsetHeight || 0;
    document.documentElement.style.setProperty("--top-chrome-height", (total || 132) + "px");
  }

  function syncHomeDots(activeIndex) {
    homeDots.forEach(function (dot) {
      dot.classList.toggle("active", Number(dot.getAttribute("data-home-dot")) === activeIndex);
    });
  }

  function scrollHomeToSlide(targetIndex) {
    if (!homeDeck) return;
    var slides = homeDeck.querySelectorAll("[data-home-slide]");
    var maxIndex = Math.max(0, slides.length - 1);
    var index = Math.max(0, Math.min(targetIndex, maxIndex));
    var target = slides[index];
    if (!target) return;
    homeCurrentSlide = index;
    syncHomeDots(index);
    homeDeck.scrollTo({ top: target.offsetTop, behavior: "smooth" });
  }

  function bindHomeLandingExperience() {
    if (!homeDeck) return;
    homeDeck.addEventListener("wheel", function (event) {
      var homePage = document.getElementById("home");
      if (!homePage || !homePage.classList.contains("active")) return;
      var slides = homeDeck.querySelectorAll("[data-home-slide]");
      var maxIndex = Math.max(0, slides.length - 1);
      if (homeWheelLocked) {
        event.preventDefault();
        return;
      }
      var delta = Number(event.deltaY || 0);
      if (Math.abs(delta) < 8) return;
      if ((delta < 0 && homeCurrentSlide <= 0) || (delta > 0 && homeCurrentSlide >= maxIndex)) {
        return;
      }
      event.preventDefault();
      homeWheelLocked = true;
      scrollHomeToSlide(homeCurrentSlide + (delta > 0 ? 1 : -1));
      window.setTimeout(function () {
        homeWheelLocked = false;
      }, 700);
    }, { passive: false });

    homeDeck.addEventListener("scroll", function () {
      var viewportHeight = homeDeck.clientHeight || 1;
      var index = Math.round(homeDeck.scrollTop / viewportHeight);
      if (index !== homeCurrentSlide) {
        homeCurrentSlide = index;
        syncHomeDots(index);
      }
    });

    homeDots.forEach(function (dot) {
      dot.addEventListener("click", function () {
        scrollHomeToSlide(Number(dot.getAttribute("data-home-dot")) || 0);
      });
    });
  }

  function openAboutMemberModal(card) {
    if (!card || !aboutMemberOverlay) return;
    var memberImage = card.getAttribute("data-member-image") || "";
    if (aboutMemberPhoto) {
      aboutMemberPhoto.style.backgroundImage = memberImage ? 'url("' + memberImage + '")' : "";
      aboutMemberPhoto.classList.toggle("about-member-modal-photo-real", !!memberImage);
    }
    if (aboutMemberName) aboutMemberName.textContent = card.getAttribute("data-member-name") || "Member";
    if (aboutMemberRole) aboutMemberRole.textContent = card.getAttribute("data-member-role") || "Role / Position";
    if (aboutMemberBio) aboutMemberBio.textContent = card.getAttribute("data-member-bio") || "Detailed member introduction.";
    aboutMemberOverlay.classList.add("open");
  }

  function closeAboutMemberModal() {
    if (aboutMemberOverlay) aboutMemberOverlay.classList.remove("open");
  }

  function bindAboutMemberCards() {
    var cards = document.querySelectorAll(".about-team-card");
    cards.forEach(function (card) {
      card.addEventListener("click", function () {
        openAboutMemberModal(card);
      });
    });
    if (aboutMemberClose) {
      aboutMemberClose.addEventListener("click", closeAboutMemberModal);
    }
    if (aboutMemberOverlay) {
      aboutMemberOverlay.addEventListener("click", function (event) {
        if (event.target === aboutMemberOverlay) closeAboutMemberModal();
      });
    }
  }

  var headerBusinessLink = document.getElementById("header-business-link");
  var headerHomeLink = document.getElementById("header-home-link");
  var logoHomeLink = document.getElementById("logo-home-link");
  function bindHomeFirstSlideLink(link) {
    if (!link) return;
    link.addEventListener("click", function (event) {
      event.preventDefault();
      showPage("home");
      window.setTimeout(function () {
        scrollHomeToSlide(0);
      }, 40);
    });
  }
  bindHomeFirstSlideLink(headerHomeLink);
  bindHomeFirstSlideLink(logoHomeLink);
  if (headerBusinessLink) {
    headerBusinessLink.addEventListener("click", function (event) {
      event.preventDefault();
      showPage("home");
      window.setTimeout(function () {
        scrollHomeToSlide(3);
      }, 40);
    });
  }

  // 页面切换总入口：处理未登录拦截、tab 高亮、hash 同步、Profile/Settings 自动回填
  function showPage(pageId) {
    var auth = getStoredAuth();
    if (!auth && publicPageIds.indexOf(pageId) === -1) {
      pageId = "home";
    }
    if (pageId === "admin-users" && (!auth || !auth.user || auth.user.role !== "admin")) {
      pageId = auth ? "dashboard" : "home";
    }
    if ((pageId === "profile" || pageId === "settings") && !auth) {
      pageId = "home";
    }
    pages.forEach(function (p) {
      p.classList.toggle('active', p.id === pageId);
    });
    navTabs.forEach(function (t) {
      var dataPage = t.getAttribute('data-page');
      t.classList.toggle('active', dataPage === pageId && dataPage !== 'login' && dataPage !== 'signup');
    });
    if (history.replaceState) history.replaceState(null, '', '#' + pageId);
    if (userDropdown && userMenuWrap) userMenuWrap.classList.remove('open');
    if (pageId === "profile") {
      renderProfile((auth && auth.user) || null);
      if (auth) {
        loadUserProfileFromServer().catch(function (err) {
          console.error(err);
        });
      }
    }
    if (pageId === "settings") {
      fillSettingsForm((auth && auth.user) || null, userSettingsCache);
    }
    if (pageId === "home") {
      updateTopChromeHeight();
      scrollHomeToSlide(homeCurrentSlide || 0);
    }
  }
  window.showFastPage = showPage;


  function getPageFromHash() {
    var hash = (window.location.hash || '#home').slice(1);
    var valid = ['home', 'business-service-center', 'about', 'dashboard', 'map-view', 'route-planner', 'weather', 'habit-routes', 'alerts', 'alert-detail', 'profile', 'settings', 'admin-users', 'login', 'signup'];
    return valid.indexOf(hash) !== -1 ? hash : 'home';
  }

  navTabs.forEach(function (tab) {
    tab.addEventListener('click', function (e) {
      e.preventDefault();
      showPage(tab.getAttribute('data-page'));
    });
  });

  window.addEventListener('hashchange', function () {
    showPage(getPageFromHash());
  });

  bindAboutMemberCards();

  window.addEventListener("resize", updateTopChromeHeight);

  if (menuProfileLink) {
    menuProfileLink.addEventListener("click", function (e) {
      e.preventDefault();
      showPage("profile");
    });
  }
  if (menuSettingsLink) {
    menuSettingsLink.addEventListener("click", function (e) {
      e.preventDefault();
      showPage("settings");
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var emailEl = loginForm.querySelector('input[type=email]');
      var passwordEl = loginForm.querySelector('input[type=password]');
      var email = (emailEl && emailEl.value || '').trim();
      var password = (passwordEl && passwordEl.value || '').trim();
      if (!email || !password) return alert('Please enter email and password');
      try {
        const resp = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: password })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Login failed');

        setStoredAuth({ token: data.token, user: data.user });
        updateHeaderAuth();
        try {
          await loadUserSettingsFromServer();
          await loadUserProfileFromServer();
        } catch (loadErr) {
          console.error(loadErr);
        }
        showPage('dashboard');
      } catch (err) {
        alert('Login failed: ' + err.message);
      }
    });
  }

  if (signupForm) {
    // 注册第一步：请求验证码。仅在 name/email/password 基础校验通过后发起请求。
    async function requestSignupCode() {
      var nameInput = document.getElementById('signup-name');
      var emailInput = document.getElementById('signup-email');
      var passwordInput = document.getElementById('signup-password');
      var payload = {
        name: (nameInput && nameInput.value.trim()) || 'User',
        email: (emailInput && emailInput.value.trim()) || '',
        password: (passwordInput && passwordInput.value.trim()) || ''
      };
      if (signupFeedback) signupFeedback.textContent = '';
      if (!payload.name || !payload.email || !payload.password) {
        if (signupFeedback) signupFeedback.textContent = 'Please fill name, email and password first.';
        return false;
      }
      if (!isValidEmail(payload.email)) {
        if (signupFeedback) signupFeedback.textContent = 'Please enter a valid usable email address.';
        return false;
      }
      if (!isValidPassword(payload.password)) {
        if (signupFeedback) signupFeedback.textContent = 'Password must be at least 6 chars and include uppercase, lowercase and number.';
        return false;
      }
      try {
        if (signupSendCodeBtn) signupSendCodeBtn.disabled = true;
        const resp = await fetch('/api/auth/signup/request-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Send code failed');
        signupCodeRequested = true;
        if (signupFeedback) {
          signupFeedback.style.color = '#166534';
          var devHint = data.devCode ? (' Dev code: ' + data.devCode) : '';
          signupFeedback.textContent = 'Verification code sent to email.' + devHint;
        }
        startSignupCodeCooldown(60);
        return true;
      } catch (err) {
        if (signupFeedback) {
          signupFeedback.style.color = '#dc2626';
          signupFeedback.textContent = 'Send code failed: ' + err.message;
        }
        return false;
      } finally {
        if (signupSendCodeBtn && !signupCodeCooldownTimer) signupSendCodeBtn.disabled = false;
      }
    }

    if (signupSendCodeBtn) {
      signupSendCodeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        requestSignupCode();
      });
    }

    signupForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var nameInput = document.getElementById('signup-name');
      var emailInput = document.getElementById('signup-email');
      var passwordInput = document.getElementById('signup-password');
      var codeInput = document.getElementById('signup-code');
      var payload = {
        name: (nameInput && nameInput.value.trim()) || 'User',
        email: (emailInput && emailInput.value.trim()) || '',
        password: (passwordInput && passwordInput.value.trim()) || '',
        code: (codeInput && codeInput.value.trim()) || ''
      };
      if (signupFeedback) {
        signupFeedback.style.color = '#dc2626';
        signupFeedback.textContent = '';
      }
      if (!payload.email || !payload.password) {
        if (signupFeedback) signupFeedback.textContent = 'Please fill all required fields.';
        return;
      }
      if (!isValidEmail(payload.email)) {
        if (signupFeedback) signupFeedback.textContent = 'Please enter a valid usable email address.';
        return;
      }
      if (!isValidPassword(payload.password)) {
        if (signupFeedback) signupFeedback.textContent = 'Password must be at least 6 chars and include uppercase, lowercase and number.';
        return;
      }
      if (!signupCodeRequested) {
        const sent = await requestSignupCode();
        if (!sent) return;
      }
      console.log("SIGNUP CODE DEBUG:", JSON.stringify(payload.code), payload.code.length, /^\d{6,8}$/.test(payload.code));
      if (!/^\d{6,8}$/.test(payload.code)) {
        if (signupFeedback) signupFeedback.textContent = 'Please enter the 8-digit verification code.';
        return;
      }
      try {
        const resp = await fetch('/api/auth/signup/verify-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Sign up failed');

        setStoredAuth({ token: data.token, user: data.user });
        updateHeaderAuth();
        signupCodeRequested = false;
        try {
          await loadUserSettingsFromServer();
        } catch (loadErr) {
          console.error(loadErr);
        }
        showPage('dashboard');
      } catch (err) {
        if (signupFeedback) signupFeedback.textContent = 'Sign up failed: ' + err.message;
      }
    });

    var signupEmailInput = document.getElementById('signup-email');
    var signupPasswordInput = document.getElementById('signup-password');
    // 输入时即时提示邮箱/密码格式问题，减少提交后报错
    function refreshSignupHint() {
      if (!signupFeedback) return;
      var email = signupEmailInput ? signupEmailInput.value.trim() : '';
      var password = signupPasswordInput ? signupPasswordInput.value : '';
      if (!email && !password) {
        signupFeedback.textContent = '';
        return;
      }
      signupFeedback.style.color = '#dc2626';
      if (email && !isValidEmail(email)) {
        signupFeedback.textContent = 'Email format invalid or not usable.';
        return;
      }
      if (password && !isValidPassword(password)) {
        signupFeedback.textContent = 'Password needs uppercase + lowercase + number, min 6 chars.';
        return;
      }
      signupFeedback.textContent = '';
    }
    if (signupEmailInput) signupEmailInput.addEventListener('input', refreshSignupHint);
    if (signupPasswordInput) signupPasswordInput.addEventListener('input', refreshSignupHint);
  }

  // 右上角用户菜单展开/收起
  function toggleUserMenu() {
    if (userMenuWrap) userMenuWrap.classList.toggle('open');
  }

  if (userMenuWrap) {
    userMenuWrap.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleUserMenu();
    });
  }

  document.addEventListener('click', function () {
    if (userMenuWrap) userMenuWrap.classList.remove('open');
  });

  if (userDropdown) {
    userDropdown.addEventListener('click', function (e) {
      e.stopPropagation();
    });
  }

  var logoutBtn = document.querySelector('.user-dropdown-item.logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function (e) {
      e.preventDefault();
      try {
        await window.fastAuthFetch('/api/auth/logout', { method: 'POST' });
      } catch (_) { }
      setStoredAuth(null);
      updateHeaderAuth();
      if (userMenuWrap) userMenuWrap.classList.remove('open');
      showPage('home');
    });
  }

  var deleteAccountBtn = settingsDeleteAccountBtn;
  if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', async function (e) {
      e.preventDefault();
      var password = window.prompt('Enter your current password to delete this account:');
      if (!password) return;
      try {
        const resp = await window.fastAuthFetch('/api/auth/account', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: password })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Delete account failed');
        setStoredAuth(null);
        updateHeaderAuth();
        if (userMenuWrap) userMenuWrap.classList.remove('open');
        alert('Account deleted.');
        showPage('home');
      } catch (err) {
        alert('Delete account failed: ' + err.message);
      }
    });
  }

  if (settingsSaveProfileBtn) {
    settingsSaveProfileBtn.addEventListener("click", async function () {
      var auth = getStoredAuth();
      if (!auth || !auth.user) return;
      const newName = (settingsNameInput && settingsNameInput.value || "").trim();
      if (!newName) {
        setSettingsFeedback("Please enter your name.", true);
        return;
      }
      try {
        const resp = await window.fastAuthFetch("/api/user/name", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Update name failed");
        setStoredAuth({ token: auth.token, user: data.user });
        updateHeaderAuth();
        renderProfile(data.user);
        setSettingsFeedback("Profile updated.", false);
      } catch (err) {
        setSettingsFeedback("Profile update failed: " + err.message, true);
      }
    });
  }

  if (settingsSaveRoutesBtn) {
    settingsSaveRoutesBtn.addEventListener("click", async function () {
      try {
        await persistUserSettings("Locations and routes saved.");
      } catch (err) {
        setSettingsFeedback("Save failed: " + err.message, true);
      }
    });
  }

  if (settingsAddVehicleBtn) {
    settingsAddVehicleBtn.addEventListener("click", function () {
      if ((userSettingsCache.vehicles || []).length >= 3) {
        setSettingsFeedback("Max 3 vehicles.", true);
        return;
      }
      if (settingsVehicleForm) settingsVehicleForm.classList.remove("hidden");
      settingsAddVehicleBtn.classList.add("hidden");
      clearVehicleForm();
    });
  }

  if (vehicleFormCancelBtn) {
    vehicleFormCancelBtn.addEventListener("click", function () {
      if (settingsVehicleForm) settingsVehicleForm.classList.add("hidden");
      if (settingsAddVehicleBtn) settingsAddVehicleBtn.classList.remove("hidden");
      clearVehicleForm();
    });
  }

  if (vehicleFormSaveBtn) {
    vehicleFormSaveBtn.addEventListener("click", async function () {
      const name = String(vehicleFormNameInput && vehicleFormNameInput.value || "").trim();
      const vehicleType = String(vehicleFormTypeInput && vehicleFormTypeInput.value || "sedan").trim();
      const fuelGrade = String(vehicleFormFuelInput && vehicleFormFuelInput.value || "ron95").trim();
      const consumption = Number(vehicleFormConsumptionInput && vehicleFormConsumptionInput.value || "");
      if (vehicleFormFeedback) {
        vehicleFormFeedback.textContent = "";
        vehicleFormFeedback.style.color = "#dc2626";
      }
      if (!name) {
        if (vehicleFormFeedback) vehicleFormFeedback.textContent = "Please enter a nickname.";
        return;
      }
      if (!Number.isFinite(consumption) || consumption < 2 || consumption > 30) {
        if (vehicleFormFeedback) vehicleFormFeedback.textContent = "Consumption must be 2-30 L/100km.";
        return;
      }
      if ((userSettingsCache.vehicles || []).length >= 3) {
        if (vehicleFormFeedback) vehicleFormFeedback.textContent = "Max 3 vehicles.";
        return;
      }
      userSettingsCache.vehicles.push({
        name: name.slice(0, 30),
        vehicleType: ["sedan", "suv", "mpv", "motorcycle"].indexOf(vehicleType) !== -1 ? vehicleType : "sedan",
        fuelGrade: ["ron92", "ron95", "ron98"].indexOf(fuelGrade) !== -1 ? fuelGrade : "ron95",
        consumption: Math.round(consumption * 10) / 10
      });
      try {
        await persistVehiclesOnly("Vehicle saved.");
        renderVehicleList();
        if (window.refreshTripCostVehicleSelect) window.refreshTripCostVehicleSelect();
        if (settingsVehicleForm) settingsVehicleForm.classList.add("hidden");
        if (settingsAddVehicleBtn) settingsAddVehicleBtn.classList.toggle("hidden", (userSettingsCache.vehicles || []).length >= 3);
        clearVehicleForm();
      } catch (err) {
        userSettingsCache.vehicles.pop();
        renderVehicleList();
        if (window.refreshTripCostVehicleSelect) window.refreshTripCostVehicleSelect();
        if (vehicleFormFeedback) vehicleFormFeedback.textContent = "Save failed: " + err.message;
      }
    });
  }

  if (profileSaveBtn) {
    profileSaveBtn.addEventListener("click", async function () {
      try {
        markProfileDirty();
        await saveUserProfileToServer();
        setProfileFeedback("Profile updated.", false);
      } catch (err) {
        setProfileFeedback("Profile update failed: " + err.message, true);
      }
    });
  }

  if (profileMembershipBtn) {
    profileMembershipBtn.addEventListener("click", function () {
      openMembershipModal();
    });
  }

  if (profileMembershipClose) {
    profileMembershipClose.addEventListener("click", function () {
      closeMembershipModal();
    });
  }

  if (profileMembershipOverlay) {
    profileMembershipOverlay.addEventListener("click", function (e) {
      if (e.target === profileMembershipOverlay) closeMembershipModal();
    });
  }

  if (profileMembershipConfirmBtn) {
    profileMembershipConfirmBtn.addEventListener("click", async function () {
      try {
        var auth = getStoredAuth();
        if (!auth || !auth.user) return;
        var resp = await window.fastAuthFetch("/api/user/membership/upgrade", { method: "POST" });
        var data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Membership upgrade failed");
        setStoredAuth({ token: auth.token, user: data.user || auth.user });
        updateHeaderAuth();
        if (data.user) renderProfile(data.user);
        if (data.membership) {
          setUserProfile(Object.assign({}, userProfileCache, {
            memberTier: data.membership.tier,
            memberExpiresAt: data.membership.expiresAt
          }));
        }
        openMembershipModal();
        setProfileFeedback("Membership upgraded to Advanced User for 30 days.", false);
      } catch (err) {
        setProfileFeedback("Membership upgrade failed: " + err.message, true);
      }
    });
  }

  if (settingsChangePasswordBtn) {
    settingsChangePasswordBtn.addEventListener("click", async function () {
      const currentPassword = (settingsPasswordCurrentInput && settingsPasswordCurrentInput.value || "").trim();
      const newPassword = (settingsPasswordNewInput && settingsPasswordNewInput.value || "").trim();
      if (!currentPassword || !newPassword) {
        setSettingsFeedback("Please fill both current and new password.", true);
        return;
      }
      if (!isValidPassword(newPassword)) {
        setSettingsFeedback("New password must contain uppercase, lowercase and number (min 6).", true);
        return;
      }
      try {
        const resp = await window.fastAuthFetch("/api/user/password", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword: currentPassword, newPassword: newPassword })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Update password failed");
        if (settingsPasswordCurrentInput) settingsPasswordCurrentInput.value = "";
        if (settingsPasswordNewInput) settingsPasswordNewInput.value = "";
        setSettingsFeedback("Password updated.", false);
      } catch (err) {
        setSettingsFeedback("Password update failed: " + err.message, true);
      }
    });
  }

  updateHeaderAuth();
  bindHomeLandingExperience();
  const auth = getStoredAuth();
  if (!auth && publicPageIds.indexOf(getPageFromHash()) === -1) {
    showPage('home');
  } else {
    showPage(getPageFromHash());
    if (auth) {
      loadUserSettingsFromServer().catch(function (err) {
        console.error(err);
      });
      loadUserProfileFromServer().catch(function (err) {
        console.error(err);
      });
    }
  }

})();
