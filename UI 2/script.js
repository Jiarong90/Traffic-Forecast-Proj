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
  var settingsCompanyInput = document.getElementById("settings-company");
  var settingsHomeInput = document.getElementById("settings-home");
  var settingsCommuteGoInput = document.getElementById("settings-commute-go");
  var settingsCommuteBackInput = document.getElementById("settings-commute-back");
  var settingsSaveProfileBtn = document.getElementById("settings-save-profile-btn");
  var settingsSaveRoutesBtn = document.getElementById("settings-save-routes-btn");
  var settingsChangePasswordBtn = document.getElementById("settings-change-password-btn");
  var settingsDeleteAccountBtn = document.getElementById("settings-delete-account-btn");
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
    commuteToWorkTime: "",
    commuteToHomeTime: "",
    frequentRoutes: []
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
      commuteToWorkTime: String(settings?.commuteToWorkTime || ""),
      commuteToHomeTime: String(settings?.commuteToHomeTime || ""),
      frequentRoutes: Array.isArray(settings?.frequentRoutes) ? settings.frequentRoutes.slice(0, 3) : []
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

  // 将“当前用户 + 设置”回填到 Settings 表单，保证刷新页面后输入框状态可恢复
  function fillSettingsForm(user, settings) {
    if (settingsEmailInput) settingsEmailInput.value = user?.email || "";
    if (settingsNameInput) settingsNameInput.value = user?.name || "";
    if (settingsCompanyInput) settingsCompanyInput.value = settings?.companyLocation || "";
    if (settingsHomeInput) settingsHomeInput.value = settings?.homeLocation || "";
    if (settingsCommuteGoInput) settingsCommuteGoInput.value = settings?.commuteToWorkTime || "";
    if (settingsCommuteBackInput) settingsCommuteBackInput.value = settings?.commuteToHomeTime || "";
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
  if (headerHomeLink) {
    headerHomeLink.addEventListener("click", function (event) {
      event.preventDefault();
      showPage("home");
      window.setTimeout(function () {
        scrollHomeToSlide(0);
      }, 40);
    });
  }
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
      if (!/^\d{6}$/.test(payload.code)) {
        if (signupFeedback) signupFeedback.textContent = 'Please enter the 6-digit verification code.';
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
      } catch (_) {}
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
        const frequentRoutes = readRouteRowsFromForm();
        const payload = {
          companyLocation: (settingsCompanyInput && settingsCompanyInput.value || "").trim(),
          homeLocation: (settingsHomeInput && settingsHomeInput.value || "").trim(),
          commuteToWorkTime: (settingsCommuteGoInput && settingsCommuteGoInput.value || "").trim(),
          commuteToHomeTime: (settingsCommuteBackInput && settingsCommuteBackInput.value || "").trim(),
          frequentRoutes: frequentRoutes
        };
        const resp = await window.fastAuthFetch("/api/user/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Save settings failed");
        setUserSettings(data.settings || payload);
        setSettingsFeedback("Locations and routes saved.", false);
      } catch (err) {
        setSettingsFeedback("Save failed: " + err.message, true);
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

// ================= 天气模块（UI_weather 融合版，继续走后端 API） =================

// 所有前端调用的后端 API 路由集中在这里，避免散落硬编码
const API_CONFIG = {
  weather: {
    currentUrl: "/api/weather/current",
    forecastUrl: "/api/weather/forecast",
  },
  ai: {
    weatherAdviceUrl: "/api/ai/weather-advice",
    incidentSummaryUrl: "/api/ai/incident-summary",
  },
  alerts: {
    trafficInfoFeedUrl: "/api/traffic-info-feed"
  }
};

// 天气模块入口：
// - 支持邮编/地名查询
// - 保存常用地点
// - 展示当前天气、短时预报、两日摘要和 AI 建议
document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("postalCode");
  const button = document.getElementById("searchBtn");
  const saveBtn = document.getElementById("saveLocBtn");
  const refreshBtn = document.getElementById("refreshDataBtn");
  const weatherSuggestions = document.getElementById("weather-location-suggestions");
  const weatherCurrentLocationOption = document.getElementById("weather-current-location-option");

  if (!input || !button) return;

  const SAVED_KEY = "fast_saved_locations";
  let lastQuery = null;

  // 从 sessionStorage 读取天气页“已保存地点”
  function getSavedLocations() {
    try {
      return JSON.parse(sessionStorage.getItem(SAVED_KEY)) || [];
    } catch (_) {
      return [];
    }
  }

  // 写回已保存地点（仅用于当前浏览器会话）
  function setSavedLocations(locs) {
    sessionStorage.setItem(SAVED_KEY, JSON.stringify(locs));
  }

  // 渲染已保存地点的“快捷 chip”，支持点击查询与单条删除
  function renderSavedLocations() {
    const locs = getSavedLocations();
    const container = document.getElementById("savedLocations");
    const emptyMsg = document.getElementById("savedEmpty");
    if (!container) return;
    container.querySelectorAll(".saved-chip").forEach((el) => el.remove());
    if (locs.length === 0) {
      if (emptyMsg) emptyMsg.style.display = "";
      return;
    }
    if (emptyMsg) emptyMsg.style.display = "none";
    locs.forEach((loc, i) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "saved-chip";
      chip.innerHTML = `📍 ${loc.label} <span class="chip-remove" data-i="${i}">×</span>`;
      chip.addEventListener("click", (e) => {
        if (e.target.classList.contains("chip-remove")) {
          const idx = parseInt(e.target.getAttribute("data-i"), 10);
          const updated = getSavedLocations().filter((_, j) => j !== idx);
          setSavedLocations(updated);
          renderSavedLocations();
          return;
        }
        input.value = loc.query;
        fetchWeather();
      });
      container.appendChild(chip);
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const query = input.value.trim();
      if (!query) return alert("Enter a location first before saving.");
      const locs = getSavedLocations();
      if (locs.find((l) => l.query === query)) return alert("Location already saved!");
      if (locs.length >= 4) return alert("Max 4 saved locations. Remove one first.");
      const label = query.length > 18 ? `${query.slice(0, 18)}…` : query;
      locs.push({ query, label });
      setSavedLocations(locs);
      renderSavedLocations();
    });
  }

  button.addEventListener("click", fetchWeather);
  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") fetchWeather();
  });
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      if (lastQuery) {
        input.value = lastQuery;
        fetchWeather();
      }
    });
  }
  renderSavedLocations();

  async function fetchFreshMobileLocationForWeather() {
    try {
      const r = await fetch("/api/mobile-location/latest");
      const data = await r.json();
      if (!r.ok) return null;
      if (data && data.fresh && Number.isFinite(Number(data.lat)) && Number.isFinite(Number(data.lon))) {
        return {
          lat: Number(data.lat),
          lon: Number(data.lon),
          display: "Current Location"
        };
      }
    } catch (_) {
      // ignore and fall back to browser location below
    }
    return null;
  }

  function getBrowserLocationForWeather() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Browser geolocation is not supported on this device."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: Number(pos.coords.latitude),
          lon: Number(pos.coords.longitude),
          display: "Current Location"
        }),
        () => reject(new Error("Unable to get your current location. Please enable browser location access.")),
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 30000
        }
      );
    });
  }

  async function getWeatherCurrentLocation() {
    const mobile = await fetchFreshMobileLocationForWeather();
    if (mobile) return mobile;
    return getBrowserLocationForWeather();
  }

  async function reverseGeocodeWeatherLocation(lat, lon) {
    const res = await fetch(`/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Reverse geocode failed");
    return {
      address: data.address || data.display || "Current Location",
      postalCode: data.postal || "-",
      latitude: Number(data.lat),
      longitude: Number(data.lon),
      buildingName: data.display || data.address || "Current Location"
    };
  }

  function toggleWeatherLocationSuggestions(visible) {
    if (!weatherSuggestions) return;
    weatherSuggestions.classList.toggle("hidden", !visible);
  }

  function maybeShowWeatherLocationSuggestions() {
    const value = input.value.trim().toLowerCase();
    toggleWeatherLocationSuggestions(!value || "current location".includes(value));
  }

  input.addEventListener("focus", maybeShowWeatherLocationSuggestions);
  input.addEventListener("click", maybeShowWeatherLocationSuggestions);
  input.addEventListener("input", maybeShowWeatherLocationSuggestions);
  input.addEventListener("blur", () => {
    setTimeout(() => toggleWeatherLocationSuggestions(false), 120);
  });

  if (weatherCurrentLocationOption) {
    weatherCurrentLocationOption.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    weatherCurrentLocationOption.addEventListener("click", async () => {
      try {
        button.textContent = "⏳ Loading...";
        button.disabled = true;
        const loc = await getWeatherCurrentLocation();
        const location = await reverseGeocodeWeatherLocation(Number(loc.lat), Number(loc.lon));
        input.value = "Current Location";
        lastQuery = "Current Location";
        const weather = await getCurrentWeather(location.latitude, location.longitude);
        const forecast = await getForecast(location.latitude, location.longitude);
        const advice = await getGeminiAdvice(location, weather, forecast.hourly);

        updateLocationUI(location);
        updateWeatherUI(weather);
        updateForecastUI(forecast.hourly);
        updateAdviceUI(advice);
        updateSunUI(weather.sunrise, weather.sunset);
        updateTwoDayUI(forecast.days);
        updateTimestamp();
      } catch (err) {
        console.error(err);
        alert(err.message || "Weather fetch failed");
      } finally {
        button.textContent = "🔍 SEARCH";
        button.disabled = false;
        toggleWeatherLocationSuggestions(false);
      }
    });
  }

  document.addEventListener("click", (e) => {
    const inWeatherPicker = weatherSuggestions?.contains(e.target) || input.contains(e.target);
    if (!inWeatherPicker) toggleWeatherLocationSuggestions(false);
  });

  // 天气查询主流程：
  // 1) 地理编码 -> 2) 当前天气 -> 3) 预报 -> 4) AI 建议 -> 5) 批量更新 UI
  async function fetchWeather() {
    const query = input.value.trim();
    if (!query) return alert("Please enter postal code or location");
    lastQuery = query;
    button.textContent = "⏳ Loading...";
    button.disabled = true;
    try {
      const location = await getLocation(query);
      const weather = await getCurrentWeather(location.latitude, location.longitude);
      const forecast = await getForecast(location.latitude, location.longitude);
      const advice = await getGeminiAdvice(location, weather, forecast.hourly);

      updateLocationUI(location);
      updateWeatherUI(weather);
      updateForecastUI(forecast.hourly);
      updateAdviceUI(advice);
      updateSunUI(weather.sunrise, weather.sunset);
      updateTwoDayUI(forecast.days);
      updateTimestamp();
    } catch (err) {
      console.error(err);
      alert("Weather fetch failed");
    } finally {
      button.textContent = "🔍 SEARCH";
      button.disabled = false;
    }
  }

  // 统一地理编码入口：兼容邮编、地名、MRT 等输入
  async function getLocation(searchVal) {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(searchVal)}`);
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || "Location not found");
    return {
      address: r.display || searchVal,
      postalCode: r.postal || "-",
      latitude: parseFloat(r.lat),
      longitude: parseFloat(r.lon),
      buildingName: r.building || "-"
    };
  }

  // 获取当前天气（后端已处理第三方 API key 与容错）
  async function getCurrentWeather(lat, lon) {
    const url = `${API_CONFIG.weather.currentUrl}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Weather fetch failed");
    return {
      ...data,
      sunrise: Number.isFinite(data.sunrise) ? data.sunrise : null,
      sunset: Number.isFinite(data.sunset) ? data.sunset : null
    };
  }

  // 获取小时级预报，并兼容后端不同字段结构（value/hourly）
  async function getForecast(lat, lon) {
    const url = `${API_CONFIG.weather.forecastUrl}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Forecast fetch failed");

    const hourly = Array.isArray(data.value)
      ? data.value
      : Array.isArray(data.hourly)
        ? data.hourly
        : [];

    return {
      hourly,
      days: buildTwoDaySummary(hourly)
    };
  }

  // 将小时预报聚合成“今天/明天”两张摘要卡（高低温、天气描述、降雨概率）
  function buildTwoDaySummary(hourly) {
    const grouped = new Map();
    hourly.forEach((item) => {
      if (!item || !item.dt) return;
      const key = new Date(item.dt * 1000).toISOString().slice(0, 10);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    });

    const dayKeys = Array.from(grouped.keys()).sort().slice(0, 2);
    const result = dayKeys.map((key, i) => {
      const list = grouped.get(key) || [];
      const temps = list.map((x) => Number(x.temp)).filter((n) => Number.isFinite(n));
      const pops = list.map((x) => Number(x.pop)).filter((n) => Number.isFinite(n));
      const mid = list[Math.floor(list.length / 2)] || {};
      return {
        label: i === 0 ? "TODAY" : "TOMORROW",
        high: temps.length ? Math.round(Math.max(...temps)) : "--",
        low: temps.length ? Math.round(Math.min(...temps)) : "--",
        desc: String(mid.desc || "--"),
        icon: weatherMainFromDesc(mid.desc),
        pop: pops.length ? Math.max(...pops) : 0
      };
    });

    while (result.length < 2) {
      result.push({
        label: result.length === 0 ? "TODAY" : "TOMORROW",
        high: "--",
        low: "--",
        desc: "--",
        icon: "Clouds",
        pop: 0
      });
    }
    return result;
  }

  function weatherMainFromDesc(desc) {
    const text = String(desc || "").toLowerCase();
    if (text.includes("thunder")) return "Thunderstorm";
    if (text.includes("drizzle")) return "Drizzle";
    if (text.includes("rain")) return "Rain";
    if (text.includes("snow")) return "Snow";
    if (text.includes("mist") || text.includes("fog") || text.includes("haze")) return "Mist";
    if (text.includes("clear") || text.includes("sun")) return "Clear";
    return "Clouds";
  }

  // 调用后端 AI 建议接口；失败时走本地 fallback，保证页面总能展示建议文本
  async function getGeminiAdvice(location, weather, forecast) {
    const future = forecast.map((f) => {
      const t = new Date(f.dt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `${t}: ${f.desc}, ${f.temp}°C, rain chance ${f.pop}%`;
    }).join("\n");

    const res = await fetch(API_CONFIG.ai.weatherAdviceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: { display: location.address },
        weather,
        forecast
      })
    });
    if (!res.ok) return fallbackAdvice(weather, forecast);
    const data = await res.json();
    return data?.text || fallbackAdvice(weather, forecast);
  }

  function fallbackAdvice(weather, forecast) {
    let text = `• Now ${weather.temp}°C (${weather.desc}).\n`;
    if (weather.temp > 30) text += "• Quite hot, wear light clothes.\n";
    if (forecast.some((f) => f.pop > 35)) text += "• Possible rain, bring umbrella.\n";
    text += "• Drive carefully if road wet.\n";
    return text;
  }

  function updateLocationUI(loc) {
    document.getElementById("loc-address").textContent = loc.address;
    document.getElementById("loc-postal").textContent = loc.postalCode;
    document.getElementById("loc-coords").textContent = `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}`;
    document.getElementById("loc-building").textContent = loc.buildingName;
  }

  function updateWeatherUI(w) {
    document.getElementById("weather-temp").textContent = `${w.temp}°C`;
    document.getElementById("weather-desc").textContent = String(w.desc || "--").toUpperCase();
    document.getElementById("weather-feels").textContent = `Feels like ${w.feels}°C`;
    document.getElementById("weather-humidity").textContent = `${w.humidity}%`;
    document.getElementById("weather-wind").textContent = `${w.wind} m/s`;
    document.getElementById("weather-pressure").textContent = `${w.pressure} hPa`;
    document.getElementById("weather-visibility").textContent = `${w.visibility} km`;
  }

  function updateForecastUI(hourly) {
    for (let i = 0; i < 3; i += 1) {
      const item = hourly[i];
      const idx = i + 1;
      const timeEl = document.getElementById(`forecast-time-${idx}`);
      const tempEl = document.getElementById(`forecast-temp-${idx}`);
      const descEl = document.getElementById(`forecast-desc-${idx}`);
      const rainEl = document.getElementById(`forecast-rain-${idx}`);
      if (!item) {
        timeEl.textContent = "--";
        tempEl.textContent = "--°C";
        descEl.textContent = "--";
        rainEl.textContent = "";
        continue;
      }
      const time = new Date(item.dt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      timeEl.textContent = time;
      tempEl.textContent = `${item.temp}°C`;
      descEl.textContent = String(item.desc || "--").toUpperCase();
      rainEl.textContent = item.pop > 30 ? `🌧️ ${item.pop}%` : "";
    }
  }

  // 将 AI 返回的自然语言拆分为结构化提示，便于卡片化展示
  function parseAdviceText(text) {
    const lines = String(text || "")
      .split("\n")
      .map((line) => line.replace(/^•\s?/, "").trim())
      .filter(Boolean);
    const categories = ["Outdoor Conditions", "Attire", "Rain Advisory", "Road Safety"];
    return categories.map((category, idx) => ({
      category,
      tip: lines[idx] || "No extra advice for now.",
      level: idx === 2 && /rain|storm|thunder|umbrella/i.test(lines[idx] || "") ? "warning" : "good"
    }));
  }

  // 根据结构化提示渲染建议卡片（类别、图标、风险等级）
  function updateAdviceUI(text) {
    const container = document.getElementById("weather-advice");
    if (!container) return;
    container.innerHTML = "";
    const tips = parseAdviceText(text);
    const META = {
      "Outdoor Conditions": { icon: "🚶" },
      "Attire": { icon: "👕" },
      "Rain Advisory": { icon: "☂️" },
      "Road Safety": { icon: "🚗" }
    };
    tips.forEach((tip) => {
      const meta = META[tip.category] || { icon: "💡" };
      const div = document.createElement("div");
      div.className = `advice-tip advice-${tip.level}`;
      div.setAttribute("data-cat", tip.category);
      div.innerHTML = `
        <span class="advice-icon">${meta.icon}</span>
        <div class="advice-content">
          <span class="advice-label">${tip.category.toUpperCase()}</span>
          <span class="advice-text">${tip.tip}</span>
        </div>
        <span class="advice-badge">${tip.level.toUpperCase()}</span>
      `;
      container.appendChild(div);
    });
  }

  // 渲染日出/日落与白天时长；若缺失数据则显示占位值
  function updateSunUI(sunriseTs, sunsetTs) {
    const riseEl = document.getElementById("sun-rise");
    const setEl = document.getElementById("sun-set");
    const daylightEl = document.getElementById("sun-daylight");
    if (!riseEl || !setEl || !daylightEl) return;
    if (!Number.isFinite(sunriseTs) || !Number.isFinite(sunsetTs) || sunsetTs <= sunriseTs) {
      riseEl.textContent = "--:--";
      setEl.textContent = "--:--";
      daylightEl.textContent = "-- hrs";
      return;
    }
    const fmt = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const diffMs = (sunsetTs - sunriseTs) * 1000;
    const hrs = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    riseEl.textContent = fmt(sunriseTs);
    setEl.textContent = fmt(sunsetTs);
    daylightEl.textContent = `${hrs}h ${mins}m`;
  }

  function getWeatherEmoji(iconMain) {
    const map = {
      Thunderstorm: "⛈️",
      Drizzle: "🌦️",
      Rain: "🌧️",
      Snow: "❄️",
      Mist: "🌫️",
      Fog: "🌫️",
      Haze: "🌫️",
      Clear: "☀️",
      Clouds: "☁️"
    };
    return map[iconMain] || "🌤️";
  }

  // 渲染今日/明日两日概览卡
  function updateTwoDayUI(days) {
    for (let i = 0; i < 2; i += 1) {
      const day = days[i] || {};
      const n = i + 1;
      document.getElementById(`twoday-label-${n}`).textContent = day.label || (n === 1 ? "TODAY" : "TOMORROW");
      document.getElementById(`twoday-icon-${n}`).textContent = getWeatherEmoji(day.icon);
      document.getElementById(`twoday-desc-${n}`).textContent = String(day.desc || "--").toUpperCase();
      document.getElementById(`twoday-high-${n}`).textContent = Number.isFinite(day.high) ? `${day.high}°` : "--°";
      document.getElementById(`twoday-low-${n}`).textContent = Number.isFinite(day.low) ? `${day.low}°` : "--°";
      document.getElementById(`twoday-rain-${n}`).textContent = day.pop > 0 ? `🌧️ ${day.pop}% rain chance` : "☀️ No rain expected";
    }
  }

  // 更新时间戳（仅代表本页面数据刷新时间）
  function updateTimestamp() {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const el = document.getElementById("lastUpdatedTime");
    const wrap = document.getElementById("weatherTimestamp");
    if (el) el.textContent = time;
    if (wrap) wrap.style.display = "flex";
  }

});

// ================= 摄像头 + 路径规划整合模块 =================
(function () {
  // 新加坡地图默认中心点
  const SG_CENTER = [1.3521, 103.8198];
  const ROUTE_COLORS = {
    fastest: "#2563eb",
    fewerLights: "#16a34a",
    balanced: "#ea580c"
  };
  const ROUTE_LABELS = {
    fastest: "FASTEST",
    fewerLights: "FEWER LIGHTS",
    balanced: "BALANCED"
  };
  const ROUTE_PREFERENCE_ORDER = ["fastest", "fewerLights", "balanced"];
  const ROUTE_PREFERENCE_TEXT = {
    fastest: "FASTEST ROUTE",
    fewerLights: "FEWER LIGHTS",
    balanced: "BALANCED"
  };
  const MAP_POI_ICON_URLS = {
    camera: "/ui2/assets/images/CAMERA.jpg",
    incident: "/ui2/assets/images/INCIDENTS.jpg",
    erp: "/ui2/assets/images/ERP.jpg",
    pgs: "/ui2/assets/images/PGS.jpg"
  };

  function getMapPoiIcon(type) {
    const iconUrl = MAP_POI_ICON_URLS[type] || MAP_POI_ICON_URLS.camera;
    const iconSize = type === "erp" || type === "pgs" ? [24, 12] : [15, 15];
    return L.icon({
      iconUrl,
      iconSize,
      iconAnchor: [Math.round(iconSize[0] / 2), Math.round(iconSize[1] / 2)],
      popupAnchor: [0, -10],
      className: `map-poi-icon map-poi-icon-${type}`
    });
  }

  // 全局运行时状态：集中管理地图图层、路线、事故、告警等跨模块数据
  const state = {
    cameras: [],
    liveMap: null,
    plannerMap: null,
    // For Habit routes
    habitRoutesMap: null,
    habitRoutesBaseLayer: null,
    habitRoutePolylineLayer: null,
    habitSavedRoutes: [],
    // End Habit routes
    liveLayer: null,
    liveIncidentLayer: null,
    liveErpLayer: null,
    livePgsLayer: null,
    mapCamerasVisible: true,
    mapErpVisible: false,
    mapPgsVisible: false,
    mapErpItems: [],
    mapPgsItems: [],
    plannerLayer: null,
    routeLayer: null,
    adminSimulationLayer: null,
    routeConfirmMarkerLayer: null,
    routeConfirmPoiLayer: null,
    routeConfirmProgressLayer: null,
    routeNearestCameraLayer: null,
    routePolylines: new Map(),
    routePlans: [],
    selectedRouteId: null,
    routePreference: "fastest",
    confirmedRouteId: null,
    confirmedRoutePlan: null,
    confirmedRouteOriginalStartGeo: null,
    confirmedRouteEndGeo: null,
    confirmedRouteLastReplanAt: 0,
    confirmedTravelledCoords: [],
    confirmedLastLiveCoord: null,
    routeNearestCameraVisible: false,
    mobileLocationPollId: null,
    routeContext: null,
    routeStartCurrentGeo: null,
    routeLiveMarker: null,
    routeLiveWatchId: null,
    adminSimulationConfig: null,
    adminSimulationVisible: false,
    adminSimulationBusy: false,
    adminSimulationData: null,
    adminSimulationSelectedRouteId: null,
    incidentSortMode: "time",
    incidentDataSource: "live",
    incidentMeta: null,
    mapIncidentsVisible: false,
    mapLiveIncidents: [],
    mapIncidentElapsedTimer: null,
    adminFeedbackItems: [],
    adminFeedbackVisible: false,
    adminFeedbackMapLayer: null,
    adminFeedbackFilters: {
      timeRange: "all",
      severity: "all"
    },
    dashboardIncidents: [],
    favoritePlannerPanelVisible: false,
    alertDismissedIds: new Set(),
    selectedAlertIncidentId: null,
    alertAiCache: new Map(),
    userLocation: null,
    alertLocationReady: false,
    alertIncidentById: new Map(),
    alertsInfoFeed: null,
    
  };

  // 读取当前登录用户（来自前面 auth 模块的 sessionStorage 封装）
  function getAuthUser() {
    return window.getFastAuth && window.getFastAuth() ? window.getFastAuth().user : null;
  }

  // 是否管理员：用于控制模拟功能/数据源切换按钮显隐
  function isAdmin() {
    const user = getAuthUser();
    return !!(user && user.role === "admin");
  }

  // 通用距离函数（米）：路径评估、事故匹配、点位去重都会用到
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // 路径规划计算已统一迁移到后端（Node + Python）。
  // 前端仅保留坐标兼容函数，用于绘图和旧数据结构回退。
  function getRouteCoords(routeOption, startCoord, endCoord) {
    if (Array.isArray(routeOption?.coords) && routeOption.coords.length >= 2) {
      return routeOption.coords;
    }
    const coords = [[startCoord.lat, startCoord.lon]];
    for (const n of routeOption.path) coords.push([n.lat, n.lon]);
    coords.push([endCoord.lat, endCoord.lon]);
    return coords;
  }

  // 计算点到路线的最短距离（简化为到顶点最短距离）
  function distanceToRouteMeters(routeCoords, lat, lon) {
    let best = Infinity;
    for (const c of routeCoords || []) {
      const d = haversine(lat, lon, c[0], c[1]);
      if (d < best) best = d;
    }
    return best;
  }

  function getNearestRoutePointIndex(routeCoords, lat, lon) {
    let best = Infinity;
    let bestIndex = 0;
    (routeCoords || []).forEach((c, idx) => {
      const d = haversine(lat, lon, c[0], c[1]);
      if (d < best) {
        best = d;
        bestIndex = idx;
      }
    });
    return { index: bestIndex, distance: best };
  }

  function splitRouteProgress(routeCoords, lat, lon) {
    if (!Array.isArray(routeCoords) || routeCoords.length < 2) {
      return { travelled: [], remaining: [] };
    }
    const nearest = getNearestRoutePointIndex(routeCoords, lat, lon);
    const clampedIndex = Math.max(0, Math.min(routeCoords.length - 1, nearest.index));
    const travelled = routeCoords.slice(0, clampedIndex + 1);
    const remaining = routeCoords.slice(clampedIndex);
    const currentPoint = [lat, lon];
    const travelledLine = travelled.length ? travelled.concat([currentPoint]) : [currentPoint];
    const remainingLine = remaining.length ? [currentPoint].concat(remaining) : [currentPoint];
    return {
      travelled: travelledLine.length >= 2 ? travelledLine : [],
      remaining: remainingLine.length >= 2 ? remainingLine : [],
      distanceToRoute: nearest.distance
    };
  }

  // 生成用于路线评估/演示的事件（管理员配置优先；否则使用默认模板）
  function buildSyntheticEvents(routeCoords, customConfig) {
    const configuredEvents = customConfig && customConfig.enabled && Array.isArray(customConfig.events)
      ? customConfig.events
      : null;
    if (configuredEvents && configuredEvents.length) {
      return configuredEvents.map((evt, i) => {
        const ratio = Math.max(0.05, Math.min(0.95, Number(evt.ratio) || 0.5));
        const idx = Math.max(1, Math.min(routeCoords.length - 2, Math.floor((routeCoords.length - 1) * ratio)));
        const [lat, lon] = routeCoords[idx];
        const severity = Math.max(1, Math.min(3, Number(evt.severity) || 2));
        const delayMin = Math.max(1, Math.min(45, Number(evt.delayMin) || 8));
        return {
          id: `evt-admin-${i + 1}`,
          type: String(evt.type || "incident"),
          label: String(evt.label || "Admin Incident"),
          color: String(evt.color || (severity === 3 ? "#ef4444" : severity === 2 ? "#f59e0b" : "#a855f7")),
          severity,
          delayMin,
          lat,
          lon,
          reason: `${String(evt.label || "Admin Incident")} (L${severity})`
        };
      });
    }

    const types = [
      { type: "accident", label: "Accident", color: "#ef4444", baseDelay: 10 },
      { type: "congestion", label: "Congestion", color: "#f59e0b", baseDelay: 7 },
      { type: "roadwork", label: "Roadwork", color: "#a855f7", baseDelay: 5 }
    ];
    const ratios = [0.28, 0.53, 0.76];

    return ratios.map((ratio, i) => {
      const idx = Math.max(1, Math.min(routeCoords.length - 2, Math.floor((routeCoords.length - 1) * ratio)));
      const [lat, lon] = routeCoords[idx];
      const t = types[i % types.length];
      const severity = (i % 3) + 1;
      return {
        id: `evt-${i + 1}`,
        type: t.type,
        label: t.label,
        color: t.color,
        severity,
        delayMin: t.baseDelay + severity * 2,
        lat,
        lon,
        reason: `${t.label} (L${severity})`
      };
    });
  }

  function mapLiveIncidentsToRouteEvents(incidents) {
    return (Array.isArray(incidents) ? incidents : [])
      .map((incident, index) => {
        const lat = Number(incident?.lat);
        const lon = Number(incident?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        const severity = Math.max(1, Math.min(3, getIncidentSeverityScore(incident) || 1));
        const delayMin = severity === 3 ? 12 : severity === 2 ? 8 : 4;
        return {
          id: incident.id || `live-incident-${index + 1}`,
          type: String(incident?.type || "incident"),
          label: String(incident?.type || "Traffic incident"),
          color: severity === 3 ? "#ef4444" : severity === 2 ? "#f59e0b" : "#a855f7",
          severity,
          delayMin,
          lat,
          lon,
          area: String(incident?.area || ""),
          message: String(incident?.message || ""),
          reason: String(incident?.message || incident?.type || "Live traffic incident"),
          createdAt: incident?.createdAt || new Date().toISOString()
        };
      })
      .filter(Boolean);
  }

  // 给事件附上附近摄像头（最多 2 个），用于详情展示证据
  function attachEventCameras(events, cameras) {
    return events.map((evt) => {
      const nearby = cameras
        .map(cam => ({ ...cam, dist: haversine(evt.lat, evt.lon, cam.lat, cam.lon) }))
        .filter(cam => cam.dist <= 1500)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 2);
      return { ...evt, cameras: nearby };
    });
  }

  // 后端 Python：路线事件筛选（优先）
  async function analyzeEventsViaBackend(events, userLoc, routeCoords) {
    const resp = await fetch("/api/route-events/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: Array.isArray(events) ? events : [],
        userLoc: userLoc || null,
        routeCoords: Array.isArray(routeCoords) ? routeCoords : []
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Route event analyze failed");
    return Array.isArray(data.value) ? data.value : [];
  }

  // 后端 Python：路线事件评分/拥堵评估（优先）
  async function evaluateRoutesByEventsViaBackend(routeOptions, events) {
    const resp = await fetch("/api/route-events/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routes: (routeOptions || []).map((r) => ({
          id: r.id,
          estMinutes: r.estMinutes,
          coords: Array.isArray(r.coords) ? r.coords : []
        })),
        events: Array.isArray(events) ? events : []
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Route event evaluate failed");

    const evaluations = new Map();
    const rows = Array.isArray(data.evaluations) ? data.evaluations : [];
    rows.forEach((it) => {
      const routeId = it.routeId;
      if (!routeId) return;
      evaluations.set(routeId, {
        hitCount: Number(it.hitCount) || 0,
        eventDelayMin: Number(it.eventDelayMin) || 0,
        score: Number(it.score) || Infinity,
        hits: Array.isArray(it.hits) ? it.hits : []
      });
    });
    const fallbackId = routeOptions?.[0]?.id || null;
    return {
      evaluations,
      recommendedRouteId: data.recommendedRouteId || fallbackId,
      currentFastestId: data.currentFastestId || fallbackId
    };
  }

  // 根据评估结果计算“当前Fastest by time路线”（兼容本地/后端两种评估结果）
  function deriveCurrentFastestId(routeOptions, evaluation) {
    const routes = Array.isArray(routeOptions) ? routeOptions : [];
    if (!routes.length) return null;
    const evalMap = evaluation?.evaluations;
    let fastestId = routes[0].id;
    let bestMinutes = Infinity;
    routes.forEach((p) => {
      const e = evalMap?.get?.(p.id) || { eventDelayMin: 0 };
      const total = Number(p.estMinutes || 0) + (Number(e.eventDelayMin || 0) * 0.7);
      if (total < bestMinutes) {
        bestMinutes = total;
        fastestId = p.id;
      }
    });
    return fastestId;
  }

  function getLocationErrorMessage(err) {
    if (!err) return "Unable to get your current location.";
    if (err.code === 1) return "Location access was denied. Please allow browser location access.";
    if (err.code === 2) return "Your location is currently unavailable. Please check device location services.";
    if (err.code === 3) return "Location request timed out. Please try again in an open area.";
    return "Unable to get your current location.";
  }

  function requestBrowserLocation(options) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported by this browser."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => reject(err),
        options
      );
    });
  }

  async function fetchLatestMobileLocation() {
    const r = await fetch("/api/mobile-location/latest");
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Failed to load mobile location");
    if (!d || !d.fresh || !Number.isFinite(Number(d.lat)) || !Number.isFinite(Number(d.lon))) return null;
    return {
      lat: Number(d.lat),
      lon: Number(d.lon),
      accuracy: Number.isFinite(Number(d.accuracy)) ? Number(d.accuracy) : null,
      source: "mobile",
      deviceName: d.deviceName || "Mobile device"
    };
  }

  // 获取浏览器定位：先尝试高精度，再回退普通精度
  function getUserLocation() {
    return fetchLatestMobileLocation()
      .catch(() => null)
      .then((mobileLoc) => {
        if (mobileLoc) return mobileLoc;
        return requestBrowserLocation({ enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 })
      .catch((err) => {
        if (err && err.code === 1) throw err;
        return requestBrowserLocation({ enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
      });
      });
  }

  async function useCurrentLocationAsRouteStart() {
    const startInput = document.getElementById("route-start-postal");
    const hintEl = document.getElementById("route-planning-hint");
    try {
      const currentLoc = await getUserLocation();
      if (!currentLoc) {
        throw new Error("Unable to get your current location.");
      }
      state.routeStartCurrentGeo = currentLoc;
      if (startInput) startInput.value = "Current Location";
      if (hintEl) hintEl.textContent = "Current location has been set as the route start.";
    } catch (err) {
      state.routeStartCurrentGeo = null;
      alert(getLocationErrorMessage(err));
    }
  }

  function toggleRouteStartSuggestions(visible) {
    const box = document.getElementById("route-start-suggestions");
    if (!box) return;
    box.classList.toggle("hidden", !visible);
  }

  // 懒加载初始化两张地图：实时地图 + 规划地图
  function ensureMaps() {
    const MAP_DEFAULT_ZOOM = 12;
    const MAP_MIN_ZOOM = 12;
    if (!state.liveMap && document.getElementById("liveMap")) {
      state.liveMap = L.map("liveMap", {
        center: SG_CENTER,
        zoom: MAP_DEFAULT_ZOOM,
        minZoom: MAP_MIN_ZOOM,
        zoomControl: false,
        preferCanvas: true
      });
      L.control.zoom({ position: "bottomright" }).addTo(state.liveMap);
      L.tileLayer("https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png", {
        attribution: "&copy; OneMap Singapore",
        maxZoom: 18,
        minZoom: MAP_MIN_ZOOM
      }).addTo(state.liveMap);
      state.liveLayer = L.layerGroup().addTo(state.liveMap);
      state.liveIncidentLayer = L.layerGroup().addTo(state.liveMap);
      state.liveErpLayer = L.layerGroup().addTo(state.liveMap);
      state.livePgsLayer = L.layerGroup().addTo(state.liveMap);
      state.adminFeedbackMapLayer = L.layerGroup().addTo(state.liveMap);
    }

    if (!state.plannerMap && document.getElementById("plannerMap")) {
      state.plannerMap = L.map("plannerMap", {
        center: SG_CENTER,
        zoom: MAP_DEFAULT_ZOOM,
        minZoom: MAP_MIN_ZOOM,
        zoomControl: false,
        preferCanvas: true
      });
      L.control.zoom({ position: "bottomright" }).addTo(state.plannerMap);
      L.tileLayer("https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png", {
        attribution: "&copy; OneMap Singapore",
        maxZoom: 18,
        minZoom: MAP_MIN_ZOOM
      }).addTo(state.plannerMap);
      state.plannerLayer = L.layerGroup().addTo(state.plannerMap);
      state.routeLayer = L.layerGroup().addTo(state.plannerMap);
      state.adminSimulationLayer = L.layerGroup().addTo(state.plannerMap);
      state.routeConfirmProgressLayer = L.layerGroup().addTo(state.plannerMap);
      state.routeConfirmMarkerLayer = L.layerGroup().addTo(state.plannerMap);
      state.routeConfirmPoiLayer = L.layerGroup().addTo(state.plannerMap);
      state.routeNearestCameraLayer = L.layerGroup().addTo(state.plannerMap);
    }

    // For Habit Routes add-on
    if (!state.habitRoutesMap && document.getElementById("habitRoutesMap")) {
      state.habitRoutesMap = L.map("habitRoutesMap", {
        center: SG_CENTER,
        zoom: 11,
        zoomControl: false,
        preferCanvas: true
      });

      L.control.zoom({ position: "bottomright" }).addTo(state.habitRoutesMap);

      L.tileLayer("https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png", {
        attribution: "&copy; OneMap Singapore",
        maxZoom: 18,
        minZoom: 10
      }).addTo(state.habitRoutesMap);

      state.habitRoutesBaseLayer = L.layerGroup().addTo(state.habitRoutesMap);
      state.habitRoutePolylineLayer = L.layerGroup().addTo(state.habitRoutesMap);
    }
  }

  // 地图点击摄像头后的弹窗展示（名称、来源、实时图）
  function openLiveCamera(c) {
    if (!state.liveMap) return;
    const content = `
      <div style="font-size:12px;max-width:260px;">
        <strong>${c.name}</strong><br/>
        <span>${c.source}</span><br/>
        ${c.imageLink ? `<img src="${c.imageLink}" alt="${c.name}" style="margin-top:6px;width:100%;border-radius:6px;" />` : "No realtime image"}
      </div>
    `;
    L.popup().setLatLng([c.lat, c.lon]).setContent(content).openOn(state.liveMap);
    state.liveMap.setView([c.lat, c.lon], Math.max(state.liveMap.getZoom(), 14));
  }

  // Map View 主渲染：左侧列表 + 右侧地图点位保持同一数据源
  function renderLiveMapAndList() {
    if (!state.liveMap || !state.liveLayer) return;
    state.liveLayer.clearLayers();
    const sidebar = document.querySelector("#map-view .sidebar.active-reports");
    const reportList = document.getElementById("camera-report-list");
    const liveCount = document.getElementById("map-live-count");
    if (!state.mapCamerasVisible) {
      if (sidebar) sidebar.classList.add("hidden");
      if (reportList) reportList.innerHTML = "";
      if (liveCount) liveCount.textContent = "0";
      return;
    }
    if (sidebar) sidebar.classList.remove("hidden");
    const realtime = state.cameras.filter(c => c.hasRealtimeImage);
    const mapPoints = realtime.slice(0, 90);
    const list = realtime.slice(0, 90);

    mapPoints.forEach((c) => {
      const marker = L.marker([c.lat, c.lon], {
        icon: getMapPoiIcon("camera")
      }).addTo(state.liveLayer);
      marker.on("click", () => openLiveCamera(c));
    });

    if (reportList) {
      reportList.innerHTML = list.map((c, i) => `
        <div class="report-card ${i % 3 === 0 ? "accident" : i % 3 === 1 ? "roadwork" : "breakdown"}" data-camera-id="${c.id}">
          <span class="report-icon ${i % 3 === 0 ? "accident" : i % 3 === 1 ? "roadwork" : "breakdown"}"></span>
          <div class="report-body">
            <span class="report-type">LIVE CAMERA</span>
            <p>${c.name}</p>
            <span class="report-time">${c.source}</span>
          </div>
          <span class="severity-tag ${i % 3 === 0 ? "high" : i % 3 === 1 ? "medium" : "low"}">${i % 3 === 0 ? "HIGH" : i % 3 === 1 ? "MEDIUM" : "LOW"}</span>
        </div>
      `).join("");
      reportList.querySelectorAll(".report-card").forEach((card) => {
        card.addEventListener("click", () => {
          const cam = list.find(x => x.id === card.getAttribute("data-camera-id"));
          if (cam) openLiveCamera(cam);
        });
      });
    }

    if (liveCount) liveCount.textContent = String(mapPoints.length);
  }

  function renderMapCameraToggleButton() {
    const btn = document.getElementById("map-toggle-cameras-btn");
    if (!btn) return;
    btn.innerHTML = state.mapCamerasVisible
      ? `<span class="dot red"></span> HIDE LIVE MONITORING`
      : `<span class="dot red"></span> SHOW LIVE MONITORING`;
  }

  function toggleMapCamerasVisibility() {
    state.mapCamerasVisible = !state.mapCamerasVisible;
    renderMapCameraToggleButton();
    renderLiveMapAndList();
  }

  // 实时事故显示开关按钮文案同步
  function renderMapIncidentToggleButton() {
    const btn = document.getElementById("map-toggle-incidents-btn");
    if (!btn) return;
    btn.innerHTML = state.mapIncidentsVisible
      ? `<span class="icon-warning red"></span> HIDE LTA INCIDENTS`
      : `<span class="icon-warning red"></span> SHOW LTA INCIDENTS`;
  }

  function renderMapFeedbackToggleButton() {
    const btn = document.getElementById("map-toggle-feedback-btn");
    if (!btn) return;
    btn.classList.toggle("hidden", !isAdmin());
    btn.innerHTML = state.adminFeedbackVisible
      ? `<span class="icon-pin"></span> HIDE USER FEEDBACK`
      : `<span class="icon-pin"></span> SHOW USER FEEDBACK`;
  }

  function renderMapErpToggleButton() {
    const btn = document.getElementById("map-toggle-erp-btn");
    if (!btn) return;
    btn.innerHTML = state.mapErpVisible
      ? `<span class="icon-info"></span> HIDE ERP`
      : `<span class="icon-info"></span> SHOW ERP`;
  }

  function renderMapPgsToggleButton() {
    const btn = document.getElementById("map-toggle-pgs-btn");
    if (!btn) return;
    btn.innerHTML = state.mapPgsVisible
      ? `<span class="icon-pin"></span> HIDE PGS`
      : `<span class="icon-pin"></span> SHOW PGS`;
  }

  // 读取 auth 模块维护的用户设置缓存（容错为 {}，避免页面崩溃）
  function getCurrentUserSettings() {
    try {
      return window.getFastUserSettings ? (window.getFastUserSettings() || {}) : {};
    } catch (_) {
      return {};
    }
  }

  // 从设置中抽取“公司/家庭”两个常用地点
  function getFrequentPlaces(settings) {
    const places = [];
    const company = String(settings?.companyLocation || "").trim();
    const home = String(settings?.homeLocation || "").trim();
    if (company) places.push({ id: "company", label: "Company", query: company });
    if (home) places.push({ id: "home", label: "Home", query: home });
    return places;
  }

  // 从设置中抽取常用路线（最多 3 条），并标准化字段
  function getFrequentRoutes(settings) {
    return (Array.isArray(settings?.frequentRoutes) ? settings.frequentRoutes : [])
      .slice(0, 3)
      .map((r, i) => ({
        id: `f-route-${i + 1}`,
        name: String(r?.name || `Route ${i + 1}`).trim() || `Route ${i + 1}`,
        start: String(r?.start || "").trim(),
        end: String(r?.end || "").trim()
      }))
      .filter((r) => r.start && r.end);
  }

  // 同步 Route Planner 上“常用地点/路线面板开关”按钮文案
  function renderRouteFavoritesToggleButton() {
    const btn = document.getElementById("route-toggle-favorites-btn");
    if (!btn) return;
    btn.textContent = state.favoritePlannerPanelVisible
      ? "HIDE COMMON PLACES/ROUTES"
      : "SHOW COMMON PLACES/ROUTES";
  }


  // 渲染 Route Planner 常用数据面板：
  // - 常用地点可一键填入起点/终点
  // - 常用路线可一键触发导航计算
  function renderRouteFavoritesPanel() {
    const panel = document.getElementById("route-favorites-panel");
    const list = document.getElementById("route-favorites-list");
    if (!panel || !list) return;
    panel.classList.toggle("hidden", !state.favoritePlannerPanelVisible);
    if (!state.favoritePlannerPanelVisible) return;
    const settings = getCurrentUserSettings();
    const places = getFrequentPlaces(settings);
    const routes = getFrequentRoutes(settings);
    const hasData = places.length || routes.length;
    if (!hasData) {
      list.innerHTML = `<div class="route-favorite-item"><div><strong>No common data</strong><div class="meta">Configure in Settings first.</div></div></div>`;
      return;
    }

    const placeHtml = places.map((p) => `
      <div class="route-favorite-item">
        <div>
          <strong>${escapeHtml(p.label)}</strong>
          <div class="meta">${escapeHtml(p.query)}</div>
        </div>
        <div>
          <button type="button" data-fav-place-start="${escapeHtml(p.query)}">Set Start</button>
          <button type="button" data-fav-place-end="${escapeHtml(p.query)}">Set End</button>
        </div>
      </div>
    `).join("");
    const routeHtml = routes.map((r) => `
      <div class="route-favorite-item">
        <div>
          <strong>${escapeHtml(r.name)}</strong>
          <div class="meta">${escapeHtml(r.start)} → ${escapeHtml(r.end)}</div>
        </div>
        <div>
          <button type="button" data-fav-route-plan="${r.id}">Plan Now</button>
        </div>
      </div>
    `).join("");
    list.innerHTML = placeHtml + routeHtml;

    list.querySelectorAll("[data-fav-place-start]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const val = btn.getAttribute("data-fav-place-start") || "";
        const startEl = document.getElementById("route-start-postal");
        if (startEl) startEl.value = val;
      });
    });
    list.querySelectorAll("[data-fav-place-end]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const val = btn.getAttribute("data-fav-place-end") || "";
        const endEl = document.getElementById("route-end-postal");
        if (endEl) endEl.value = val;
      });
    });
    list.querySelectorAll("[data-fav-route-plan]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-fav-route-plan");
        const route = routes.find((r) => r.id === id);
        if (!route) return;
        const startEl = document.getElementById("route-start-postal");
        const endEl = document.getElementById("route-end-postal");
        if (startEl) startEl.value = route.start;
        if (endEl) endEl.value = route.end;
        await calculateRoutes();
      });
    });
  }

  // 切换 Route Planner 常用面板显隐
  function toggleRouteFavoritesPanel() {
    state.favoritePlannerPanelVisible = !state.favoritePlannerPanelVisible;
    renderRouteFavoritesToggleButton();
    renderRouteFavoritesPanel();
  }

  function renderRoutePreferenceButton() {
    const btn = document.getElementById("route-preference-btn");
    if (!btn) return;
    const pref = ROUTE_PREFERENCE_TEXT[state.routePreference] || "FASTEST ROUTE";
    btn.innerHTML = `<span class="icon-info"></span> PREFERENCE: ${pref}`;
  }

  function getPreferredRouteId() {
    if (!state.routePlans.length) return null;
    if (state.routePreference === "fastest") {
      return state.routeContext?.currentFastestId || state.routeContext?.evaluation?.recommendedRouteId || state.routePlans[0]?.id || null;
    }
    return state.routePlans.find((route) => route.id === state.routePreference)?.id || state.routePlans[0]?.id || null;
  }

  function applyRoutePreferenceSelection() {
    const preferredId = getPreferredRouteId();
    if (!preferredId) return;
    state.selectedRouteId = preferredId;
    renderRouteCards();
    const selected = state.routePlans.find((route) => route.id === preferredId);
    if (selected) showRouteDetails(selected);
    if (state.routeLayer) {
      state.routeLayer.eachLayer((layer) => {
        const id = layer.routeId;
        layer.setStyle({
          weight: id === preferredId ? 6 : 4,
          opacity: id === preferredId ? 0.95 : 0.55
        });
      });
    }
    renderAlertsPanels();
  }

  function cycleRoutePreference() {
    const currentIndex = ROUTE_PREFERENCE_ORDER.indexOf(state.routePreference);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % ROUTE_PREFERENCE_ORDER.length : 0;
    state.routePreference = ROUTE_PREFERENCE_ORDER[nextIndex];
    renderRoutePreferenceButton();
    if (state.routePlans.length) {
      applyRoutePreferenceSelection();
    }
  }

  // 在 Map View 绘制 LTA 实时事故点
  function drawLiveIncidentMarkers(incidents) {
    if (!state.liveIncidentLayer) return;
    state.liveIncidentLayer.clearLayers();
    (incidents || []).forEach((it) => {
      const lat = Number(it?.lat);
      const lon = Number(it?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const marker = L.marker([lat, lon], {
        icon: getMapPoiIcon("incident")
      }).addTo(state.liveIncidentLayer);
      marker.bindPopup(`
        <div style="font-size:12px;max-width:280px;">
          <div><strong>Incident Type: </strong>${escapeHtml(it.type || "Traffic incident")}</div>
          <div><strong>Location: </strong>${escapeHtml(it.area || "Unknown")}</div>
          <div><strong>Elapsed Time: </strong>${escapeHtml(getIncidentElapsedText(it))}</div>
          <div><strong>Estimated Clear Time: </strong>${escapeHtml(getIncidentEstimatedClearText(it))}</div>
          <div><strong>Estimated Impact Time: </strong>${escapeHtml(getIncidentDurationText(it))}</div>
        </div>
      `);
    });
  }

  // 拉取地图事故数据（用于地图点位，不带复杂详情）
  async function fetchLiveIncidentsForMap() {
    const resp = await fetch("/api/incidents?source=live&withImagesOnly=0&max=120");
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Failed to load live incidents");
    return data.value || [];
  }

  // 显示/隐藏地图事故图层
  async function toggleMapIncidentsLayer() {
    if (!state.liveIncidentLayer) return;
    if (state.mapIncidentsVisible) {
      state.mapIncidentsVisible = false;
      state.liveIncidentLayer.clearLayers();
      if (state.mapIncidentElapsedTimer) {
        clearInterval(state.mapIncidentElapsedTimer);
        state.mapIncidentElapsedTimer = null;
      }
      renderMapIncidentToggleButton();
      return;
    }
    const incidents = await fetchLiveIncidentsForMap();
    state.mapLiveIncidents = incidents;
    state.mapIncidentsVisible = true;
    drawLiveIncidentMarkers(incidents);
    if (state.mapIncidentElapsedTimer) clearInterval(state.mapIncidentElapsedTimer);
    state.mapIncidentElapsedTimer = setInterval(() => {
      if (!state.mapIncidentsVisible) return;
      drawLiveIncidentMarkers(state.mapLiveIncidents);
    }, 60 * 1000);
    renderMapIncidentToggleButton();
  }

  // 摄像头数量驱动的概览占位统计（真实事故统计由 refreshDashboardIncidents 覆盖）
  function updateDashboardStats() {
    const realtime = state.cameras.filter(c => c.hasRealtimeImage).length;
    const totalIncidents = Math.max(3, Math.min(20, Math.round(realtime * 0.025)));
    const high = Math.max(1, Math.round(totalIncidents * 0.25));
    const medium = Math.max(1, Math.round(totalIncidents * 0.45));
    const low = Math.max(1, totalIncidents - high - medium);
    const highest = high > 0 ? "HIGH" : medium > 0 ? "MEDIUM" : "LOW";

    const now = new Date().toLocaleString("en-US", { hour12: true });
    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setText("summary-last-updated", `Last updated: ${now}`);
    setText("incident-total-num", String(totalIncidents));
    setText("severity-high-num", String(high));
    setText("severity-medium-num", String(medium));
    setText("severity-low-num", String(low));
    setText("incident-highest-severity", `Highest severity: ${highest}`);
    setText("incident-max-radius", `Max congestion radius: ${(1.2 + high * 0.35).toFixed(1)} km`);
    setText("live-incidents-total", String(totalIncidents));
    setText("live-incidents-breakdown", `${high} high, ${medium} medium, ${low} low`);
  }

  // Dashboard 默认证据卡渲染（无实时事故数据时的兜底展示）
  function renderDashboardEvidence() {
    const realtime = state.cameras.filter(c => c.hasRealtimeImage).slice(0, 6);
    const updatesEl = document.getElementById("dashboard-updates-list");
    const evidenceEl = document.getElementById("dashboard-evidence-list");
    if (!updatesEl || !evidenceEl) return;

    updatesEl.innerHTML = realtime.slice(0, 3).map((c, i) => `
      <li>
        <span class="dot ${i === 0 ? "red" : i === 1 ? "orange" : "green"}"></span>
        <div>
          <strong>${i === 0 ? "Accident risk cluster near" : i === 1 ? "Congestion build-up near" : "Roadwork impact near"} ${c.name}</strong>
          <span class="meta">Evidence source: ${c.source} · Camera ID: ${c.id}</span>
        </div>
      </li>
    `).join("");

    evidenceEl.innerHTML = realtime.map((c, i) => `
      <div class="evidence-card">
        <img src="${c.imageLink}" alt="${c.name}" loading="lazy" />
        <div class="evidence-card-body">
          <div class="evidence-card-title">${i % 3 === 0 ? "Accident Evidence" : i % 3 === 1 ? "Congestion Evidence" : "Roadwork Evidence"}</div>
          <div class="evidence-card-meta">${c.name}</div>
          <div class="evidence-card-meta">${c.source}</div>
        </div>
      </div>
    `).join("");
  }

  // 事故文本 -> 严重度分级（高/中/低）
  function getIncidentSeverityScore(incident) {
    const text = `${incident?.type || ""} ${incident?.message || ""}`.toLowerCase();
    if (/(accident|collision|overturned|fire|fatal|crash)/.test(text)) return 3;
    if (/(congestion|jam|heavy traffic|road block|roadwork|construction)/.test(text)) return 2;
    return 1;
  }

  // 严重度 -> 颜色（用于点位、告警点、标签）
  function getIncidentSeverityColor(incident) {
    const score = getIncidentSeverityScore(incident);
    if (score >= 3) return "red";
    if (score === 2) return "orange";
    return "green";
  }

  // 严重度 -> 文案标签（HIGH/MEDIUM/LOW IMPACT）
  function getIncidentImpactLabel(incident) {
    const score = getIncidentSeverityScore(incident);
    if (score >= 3) return "HIGH IMPACT";
    if (score === 2) return "MEDIUM IMPACT";
    return "LOW IMPACT";
  }

  // 基础 XSS 防护：所有动态文本渲染前统一转义
  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // 统一事故时间格式，避免各处展示不一致
  function formatIncidentTime(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "Unknown";
    return date.toLocaleString("en-SG", { hour12: true });
  }

  // 事故标题优先级：message > type > 默认文案
  function incidentTitle(incident) {
    return incident?.message || incident?.type || "Traffic incident";
  }

  // 资讯流时间格式（与事故时间分开，便于后续独立改样式）
  function formatFeedTime(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "Unknown time";
    return date.toLocaleString("en-SG", { hour12: true });
  }

  // Alerts 右栏资讯渲染：近 7 天新闻 + 最新规则更新
  function renderAlertsInfoFeed(feed) {
    const weeklyListEl = document.getElementById("alerts-weekly-news-list");
    const latestRuleEl = document.getElementById("alerts-latest-rule");
    if (!weeklyListEl || !latestRuleEl) return;

    const weeklyNews = Array.isArray(feed?.weeklyNews) ? feed.weeklyNews : [];
    const latestRule = feed?.latestRule || null;

    if (!weeklyNews.length) {
      weeklyListEl.innerHTML = `<div class="alert-card"><div class="alert-body"><strong>No traffic incident news available for the past 7 days.</strong></div></div>`;
    } else {
      weeklyListEl.innerHTML = weeklyNews.map((item, idx) => `
        <div class="alert-card">
          <div class="alert-body">
            <strong>${idx + 1}. ${escapeHtml(item.title || "Traffic news")}</strong>
            <span class="alert-meta">TIME: ${escapeHtml(formatFeedTime(item.publishedAt))}</span>
            <a class="alert-meta" href="${escapeHtml(item.link || "#")}" target="_blank" rel="noopener noreferrer">Open source</a>
          </div>
        </div>
      `).join("");
    }

    if (!latestRule) {
      latestRuleEl.innerHTML = `<div class="alert-card"><div class="alert-body"><strong>No latest traffic rule updates available.</strong></div></div>`;
      return;
    }
    latestRuleEl.innerHTML = `
      <h4 style="margin:0 0 8px;">Latest Traffic Rule Update</h4>
      <div class="alert-card">
        <div class="alert-body">
          <strong>${escapeHtml(latestRule.title || "Traffic rule update")}</strong>
          <span class="alert-meta">TIME: ${escapeHtml(formatFeedTime(latestRule.publishedAt))}</span>
          <a class="alert-meta" href="${escapeHtml(latestRule.link || "#")}" target="_blank" rel="noopener noreferrer">Open source</a>
        </div>
      </div>
    `;
  }

  // 刷新 Alerts 资讯流（进入 Alerts 页面时触发）
  async function refreshAlertsInfoFeed() {
    const weeklyListEl = document.getElementById("alerts-weekly-news-list");
    const latestRuleEl = document.getElementById("alerts-latest-rule");
    if (!weeklyListEl || !latestRuleEl) return;
    weeklyListEl.innerHTML = `<p style="margin:0;">Loading traffic incident news for the past 7 days...</p>`;
    latestRuleEl.innerHTML = `<p style="margin:0;">Loading latest traffic rules...</p>`;
    try {
      const res = await fetch(API_CONFIG.alerts.trafficInfoFeedUrl);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Feed request failed");
      state.alertsInfoFeed = data;
      renderAlertsInfoFeed(data);
    } catch (err) {
      console.error("Traffic info feed failed:", err.message);
      weeklyListEl.innerHTML = `<div class="alert-card"><div class="alert-body"><strong>Failed to load information</strong><span class="alert-meta">${escapeHtml(err.message)}</span></div></div>`;
      latestRuleEl.innerHTML = "";
    }
  }

  // 影响范围文案格式化（km）
  function getIncidentSpreadText(incident) {
    const r = Number(incident?.spreadRadiusKm);
    if (!Number.isFinite(r) || r <= 0) return "N/A";
    return `${r.toFixed(1)} km`;
  }

  // 预计影响时长文案格式化（分钟区间）
  function getIncidentDurationText(incident) {
    const minV = Number(incident?.estimatedDurationMin);
    const maxV = Number(incident?.estimatedDurationMax);
    if (Number.isFinite(minV) && Number.isFinite(maxV)) {
      return `${Math.round(minV)}-${Math.round(maxV)} mins`;
    }
    return "N/A";
  }

  // 解析事故开始时间：
  // - 优先从 LTA 消息前缀 "(d/m)HH:MM" 提取
  // - 提取失败时回退 createdAt
  function getIncidentStartTimestamp(incident) {
    const msg = String(incident?.message || "");
    const m = msg.match(/^\((\d{1,2})\/(\d{1,2})\)\s*(\d{1,2}):(\d{2})/);
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]);
      const hour = Number(m[3]);
      const minute = Number(m[4]);
      const now = new Date();
      const year = now.getFullYear();
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        const ts = new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
        if (Number.isFinite(ts)) {
          // 若解析出来是未来时间，按上一年处理（跨年边界容错）
          if (ts > Date.now() + 60 * 1000) {
            return new Date(year - 1, month - 1, day, hour, minute, 0, 0).getTime();
          }
          return ts;
        }
      }
    }
    const createdTs = new Date(incident?.createdAt || "").getTime();
    return Number.isFinite(createdTs) ? createdTs : NaN;
  }

  // 计算“已发生多久”，供地图弹窗和详情页实时展示
  function getIncidentElapsedText(incident) {
    const startTs = getIncidentStartTimestamp(incident);
    if (!Number.isFinite(startTs)) return "N/A";
    const diffMs = Math.max(0, Date.now() - startTs);
    const totalMin = Math.floor(diffMs / 60000);
    const hour = Math.floor(totalMin / 60);
    const minute = totalMin % 60;
    return hour > 0 ? `${hour}h ${minute}m` : `${minute}m`;
  }

  // 根据开始时间 + 预计持续区间，推算预计清除时间窗口
  function getIncidentEstimatedClearText(incident) {
    const createdTs = getIncidentStartTimestamp(incident);
    const minV = Number(incident?.estimatedDurationMin);
    const maxV = Number(incident?.estimatedDurationMax);
    if (!Number.isFinite(createdTs) || !Number.isFinite(minV) || !Number.isFinite(maxV)) return "N/A";
    const minTime = new Date(createdTs + Math.max(0, minV) * 60000);
    const maxTime = new Date(createdTs + Math.max(0, maxV) * 60000);
    const fmt = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (Math.round(minV) === Math.round(maxV)) return fmt(minTime);
    return `${fmt(minTime)} - ${fmt(maxTime)}`;
  }

  // Alerts 的“附近事故”逻辑只请求一次定位，避免频繁弹权限/消耗性能
  async function ensureAlertLocation() {
    if (state.alertLocationReady) return;
    state.alertLocationReady = true;
    state.userLocation = await getUserLocation();
  }

  // 是否属于“附近事故”：与用户定位距离 <= 3.5km
  function incidentIsNearby(incident) {
    if (!state.userLocation) return false;
    const lat = Number(incident?.lat);
    const lon = Number(incident?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    return haversine(state.userLocation.lat, state.userLocation.lon, lat, lon) <= 3500;
  }

  // 生成单条告警卡 HTML（Pinned 与 All 共用）
  function buildAlertCardHtml(incident, badgeText) {
    const sevColor = getIncidentSeverityColor(incident);
    const impactLabel = getIncidentImpactLabel(incident);
    const impactClass = sevColor === "red" ? "high" : sevColor === "orange" ? "medium" : "low";
    const id = escapeHtml(incident.id || "");
    const summary = escapeHtml(incident.message || incident.type || "Traffic incident");
    const area = escapeHtml(incident.area || "Unknown area");
    const timeText = escapeHtml(formatIncidentTime(incident.createdAt));
    return `
      <div class="alert-card" data-incident-id="${id}">
        <span class="alert-icon ${sevColor}"></span>
        <div class="alert-body">
          <strong>${summary}</strong>
          ${badgeText ? `<span class="badge nearby">${escapeHtml(badgeText)}</span>` : ""}
          <p>Area: ${area}</p>
          <span class="alert-meta">REPORTED: ${timeText}</span>
          <span class="alert-meta">SPREAD: ${escapeHtml(getIncidentSpreadText(incident))}</span>
          <span class="alert-meta">DURATION: ${escapeHtml(getIncidentDurationText(incident))}</span>
          <span class="impact-tag ${impactClass}">${impactLabel}</span>
        </div>
        <div class="alert-actions">
          <button type="button" class="alert-view-detail-btn" data-incident-id="${id}">View Details ></button>
          <button type="button" class="alert-dismiss-btn" data-incident-id="${id}">Dismiss ×</button>
        </div>
      </div>
    `;
  }

  // 以事故点就近匹配实时摄像头（前端辅助逻辑）
  function getNearestCameraForPoint(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    let best = null;
    let bestDist = Infinity;
    for (const cam of state.cameras || []) {
      if (!cam.hasRealtimeImage) continue;
      const d = haversine(lat, lon, cam.lat, cam.lon);
      if (d < bestDist) {
        bestDist = d;
        best = cam;
      }
    }
    if (!best || bestDist > 1800) return null;
    return best;
  }

  // 管理员模拟模式下：提取当前选中Simulated Route对应的事故列表
  function getSelectedSimRouteIncidentsForAlerts() {
    const sim = state.adminSimulationData;
    if (!state.adminSimulationVisible || !sim || !Array.isArray(sim.routes) || !sim.routes.length) return [];
    const routeId = state.adminSimulationSelectedRouteId || sim.notes?.fastestByTimeId;
    const route = sim.routes.find((r) => r.id === routeId);
    if (!route || !Array.isArray(route.incidents) || !route.incidents.length) return [];
    const routeIndex = Math.max(0, sim.routes.findIndex((r) => r.id === route.id));
    const routeName = `Simulated Route ${String.fromCharCode(65 + routeIndex)}`;

    return route.incidents.map((evt, idx) => {
      const cam = getNearestCameraForPoint(Number(evt.lat), Number(evt.lon));
      return {
        id: `sim-${routeId}-${evt.id || idx}`,
        type: evt.label || "Simulated incident",
        message: evt.message || evt.reason || evt.label || "Simulated traffic disruption",
        area: routeName,
        lat: evt.lat,
        lon: evt.lon,
        createdAt: evt.createdAt || sim.generatedAt || new Date().toISOString(),
        spreadRadiusKm: Number.isFinite(Number(evt.spreadRadiusKm)) ? Number(evt.spreadRadiusKm) : 1.2,
        estimatedDurationMin: Number.isFinite(Number(evt.estimatedDurationMin)) ? Number(evt.estimatedDurationMin) : 20,
        estimatedDurationMax: Number.isFinite(Number(evt.estimatedDurationMax)) ? Number(evt.estimatedDurationMax) : 55,
        imageLink: cam?.imageLink || null,
        cameraName: cam?.name || null
      };
    });
  }

  // 普通规划模式下：提取当前选中真实路线上的命中事件
  function getSelectedPlannedRouteIncidentsForAlerts() {
    const selectedId = state.selectedRouteId;
    const evalMap = state.routeContext?.evaluation?.evaluations;
    const routeEval = selectedId && evalMap ? evalMap.get(selectedId) : null;
    const hits = routeEval?.hits || [];
    if (!hits.length) return [];
    const generatedAt = state.routeContext?.generatedAt || new Date().toISOString();

    return hits.map((evt, idx) => {
      const cam = evt.cameras && evt.cameras.length ? evt.cameras[0] : getNearestCameraForPoint(Number(evt.lat), Number(evt.lon));
      return {
        id: `route-${selectedId}-${evt.id || idx}`,
        type: evt.type || evt.label || "Route incident",
        message: evt.reason || evt.label || "Incident detected on selected route",
        area: cam?.name || "Along selected route",
        lat: evt.lat,
        lon: evt.lon,
        createdAt: generatedAt,
        spreadRadiusKm: 1.0,
        estimatedDurationMin: Math.max(10, Math.round((evt.delayMin || 8) * 2)),
        estimatedDurationMax: Math.max(20, Math.round((evt.delayMin || 8) * 4)),
        imageLink: cam?.imageLink || null,
        cameraName: cam?.name || null
      };
    });
  }

  // Alerts 主渲染入口：
  // - 决定 Pinned 来源（Simulated Route / 当前规划路线 / 附近事故）
  // - 渲染全部事故列表
  // - 维护详情页索引 map
  function renderAlertsPanels() {
    const pinnedSection = document.getElementById("alerts-pinned-section");
    const pinnedList = document.getElementById("alerts-pinned-list");
    const allList = document.getElementById("alerts-all-list");
    if (!pinnedSection || !pinnedList || !allList) return;
    if (!state.alertLocationReady) ensureAlertLocation().then(() => renderAlertsPanels());

    const base = sortIncidents(state.dashboardIncidents, state.incidentSortMode)
      .filter((it) => !state.alertDismissedIds.has(String(it.id || "")));

    let pinned = [];
    let badgeText = "";
    if (state.adminSimulationVisible) {
      pinned = getSelectedSimRouteIncidentsForAlerts();
      badgeText = "Simulated Route";
    } else if (state.selectedRouteId && state.routeContext) {
      pinned = getSelectedPlannedRouteIncidentsForAlerts();
      badgeText = "ROUTE";
    }

    if (!pinned.length) {
      pinnedSection.style.display = "none";
      pinnedList.innerHTML = "";
    } else {
      pinnedSection.style.display = "";
      pinnedList.innerHTML = pinned.map((it) => buildAlertCardHtml(it, badgeText)).join("");
    }

    if (!base.length) {
      allList.innerHTML = `<div class="alert-card"><div class="alert-body"><strong>No active realtime incidents now.</strong></div></div>`;
    } else {
      allList.innerHTML = base.map((it) => buildAlertCardHtml(it, "")).join("");
    }
    state.alertIncidentById = new Map([...base, ...pinned].map((it) => [String(it.id || ""), it]));
    if (state.alertsInfoFeed) renderAlertsInfoFeed(state.alertsInfoFeed);
  }

  // 事故详情 AI 摘要（带缓存，失败自动回退）
  async function fetchGeminiIncidentSummary(incident) {
    const cacheKey = String(incident?.id || "");
    if (state.alertAiCache.has(cacheKey)) return state.alertAiCache.get(cacheKey);

    const fallback = {
      location: incident.area || "Unknown area",
      time: formatIncidentTime(incident.createdAt),
      reason: incident.message || incident.type || "Traffic disruption",
      duration: getIncidentDurationText(incident) !== "N/A"
        ? `${getIncidentDurationText(incident)} (estimated)`
        : (getIncidentSeverityScore(incident) >= 3 ? "90-120 minutes (estimated)" : getIncidentSeverityScore(incident) === 2 ? "45-90 minutes (estimated)" : "20-45 minutes (estimated)")
    };

    try {
      const res = await fetch(API_CONFIG.ai.incidentSummaryUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident: {
            message: incident.message || incident.type || "Traffic incident",
            area: incident.area || "Unknown area",
            createdAt: formatIncidentTime(incident.createdAt),
            cameraName: incident.cameraName || "None"
          }
        })
      });
      if (!res.ok) throw new Error("Gemini request failed");
      const data = await res.json();
      const result = {
        location: data.location || fallback.location,
        time: data.time || fallback.time,
        reason: data.reason || fallback.reason,
        duration: data.duration || fallback.duration
      };
      state.alertAiCache.set(cacheKey, result);
      return result;
    } catch (err) {
      console.warn("Incident summary fallback:", err.message);
    }
    state.alertAiCache.set(cacheKey, fallback);
    return fallback;
  }

  async function fetchWeatherForTrafficImpact(lat, lon) {
    const [weatherResp, forecastResp] = await Promise.all([
      fetch(`${API_CONFIG.weather.currentUrl}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`),
      fetch(`${API_CONFIG.weather.forecastUrl}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`)
    ]);
    const weatherData = await weatherResp.json();
    const forecastData = await forecastResp.json();
    if (!weatherResp.ok) throw new Error(weatherData.error || "Weather fetch failed");
    if (!forecastResp.ok) throw new Error(forecastData.error || "Forecast fetch failed");
    return {
      weather: weatherData,
      forecast: {
        hourly: Array.isArray(forecastData.value)
          ? forecastData.value
          : Array.isArray(forecastData.hourly)
            ? forecastData.hourly
            : []
      }
    };
  }

  async function fetchAlertTrafficImpactPrediction(incident) {
    let lat = Number(incident?.lat);
    let lon = Number(incident?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      const currentLoc = state.userLocation || await getUserLocation();
      state.userLocation = currentLoc || state.userLocation;
      lat = Number(currentLoc?.lat);
      lon = Number(currentLoc?.lon);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error("No usable coordinates for traffic impact prediction");
    }
    const { weather, forecast } = await fetchWeatherForTrafficImpact(lat, lon);
    if (!window.TrafficMLModel) throw new Error("Traffic ML model not loaded");
    const prediction = await window.TrafficMLModel.predict(weather, forecast);
    return { prediction, weather, lat, lon };
  }

  function setAlertImpactBar(barId, valId, pct, label) {
    const bar = document.getElementById(barId);
    const val = document.getElementById(valId);
    if (bar) bar.style.width = `${Math.min(Math.max(Math.round(Number(pct) || 0), 0), 100)}%`;
    if (val) val.textContent = label;
  }

  function renderAlertTrafficImpactResult(result, weather) {
    const scoreEl = document.getElementById("detail-impact-score");
    const ringEl = document.getElementById("detail-impact-ring");
    const badgeEl = document.getElementById("detail-impact-level");
    const summaryEl = document.getElementById("detail-impact-summary");
    const clearEl = document.getElementById("detail-impact-clearing");
    const confEl = document.getElementById("detail-impact-confidence");
    const engineEl = document.getElementById("detail-impact-engine");
    if (scoreEl) scoreEl.textContent = result.score ?? "--";
    if (ringEl) ringEl.className = `impact-ring ${result.levelClass || "impact-low"}`;
    if (badgeEl) {
      badgeEl.textContent = result.level || "--";
      badgeEl.className = `impact-level-badge ${result.levelClass || "impact-low"}`;
    }
    if (summaryEl) summaryEl.textContent = result.summary || "No traffic impact summary available.";
    if (clearEl) clearEl.textContent = result.clearingTime || "--";
    if (confEl) confEl.textContent = `${result.confidence ?? "--"}%`;
    if (engineEl) {
      engineEl.textContent = result.source === "python-api"
        ? "ML Engine · Python RandomForest · alert detail"
        : "ML Engine · Browser fallback forest · alert detail";
    }
    const features = result.features || {};
    setAlertImpactBar("detail-bar-rain", "detail-val-rain", Number(features.rainPop || 0) * 100, `${Math.round(Number(features.rainPop || 0) * 100)}%`);
    setAlertImpactBar("detail-bar-wind", "detail-val-wind", Number(features.wind || 0) * 100, `${weather.wind} m/s`);
    setAlertImpactBar("detail-bar-vis", "detail-val-vis", Number(features.visImpact || 0) * 100, `${weather.visibility} km`);
    setAlertImpactBar("detail-bar-heat", "detail-val-heat", Number(features.tempStress || 0) * 100, `${weather.temp}°C`);
  }

  // Alert Detail 页面渲染：基础字段 + AI 结果 + 摄像头证据
  async function renderAlertDetailPage() {
    const target = document.getElementById("alert-detail-content");
    if (!target) return;
    const incident = state.alertIncidentById.get(String(state.selectedAlertIncidentId || "")) ||
      state.dashboardIncidents.find((x) => String(x.id || "") === String(state.selectedAlertIncidentId || ""));
    if (!incident) {
      target.innerHTML = "<p>Incident not found.</p>";
      return;
    }

    target.innerHTML = `
      <h3>${escapeHtml(incidentTitle(incident))}</h3>
      <div class="alert-detail-grid">
        <div class="alert-detail-item"><span class="k">LOCATION</span><span class="v" id="detail-location">${escapeHtml(incident.area || "Unknown area")}</span></div>
        <div class="alert-detail-item"><span class="k">REPORTED TIME</span><span class="v" id="detail-time">${escapeHtml(formatIncidentTime(incident.createdAt))}</span></div>
        <div class="alert-detail-item"><span class="k">EST. SPREAD</span><span class="v">${escapeHtml(getIncidentSpreadText(incident))}</span></div>
        <div class="alert-detail-item"><span class="k">Estimated Impact Time</span><span class="v">${escapeHtml(getIncidentDurationText(incident))}</span></div>
        <div class="alert-detail-item"><span class="k">POSSIBLE REASON (AI)</span><span class="v" id="detail-reason">Generating summary...</span></div>
        <div class="alert-detail-item"><span class="k">Estimated Clear Time (AI)</span><span class="v" id="detail-duration">Generating summary...</span></div>
      </div>
      ${incident.cameraName || incident.imageLink ? `
      <div class="alert-detail-camera">
        <h4>Related Camera</h4>
        <p>${escapeHtml(incident.cameraName || "Nearby camera")}</p>
        ${incident.imageLink ? `<img src="${escapeHtml(incident.imageLink)}" alt="Incident camera evidence" loading="lazy" />` : ""}
      </div>
      ` : ""}
      <div class="ml-traffic-impact" style="margin-top:16px;">
        <h4 class="subsection-title" style="margin-bottom:14px;">TRAFFIC IMPACT PREDICTION</h4>
        <div class="impact-main-row">
          <div class="impact-ring-container">
            <div class="impact-ring impact-low" id="detail-impact-ring">
              <div class="impact-ring-inner">
                <span class="impact-score-num" id="detail-impact-score">--</span>
                <span class="impact-score-denom">/10</span>
              </div>
            </div>
            <div class="impact-ring-label">Impact Score</div>
          </div>
          <div class="impact-info">
            <div class="impact-level-badge impact-low" id="detail-impact-level">Generating prediction...</div>
            <p class="impact-summary" id="detail-impact-summary">Loading weather-based traffic impact prediction for this incident.</p>
            <div class="impact-meta-row">
              <div class="impact-meta-item">
                <span class="impact-meta-icon">⏱</span>
                <div>
                  <div class="impact-meta-label">ESTIMATED CLEARING TIME</div>
                  <div class="impact-meta-val" id="detail-impact-clearing">--</div>
                </div>
              </div>
              <div class="impact-meta-item">
                <span class="impact-meta-icon">🎯</span>
                <div>
                  <div class="impact-meta-label">MODEL CONFIDENCE</div>
                  <div class="impact-meta-val" id="detail-impact-confidence">--%</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="impact-factors-panel">
          <div class="impact-factors-heading">CONTRIBUTING WEATHER FACTORS</div>
          <div class="factor-row">
            <span class="factor-label">Rain Probability</span>
            <div class="factor-bar-track"><div class="factor-bar factor-bar-rain" id="detail-bar-rain" style="width:0%"></div></div>
            <span class="factor-val" id="detail-val-rain">--%</span>
          </div>
          <div class="factor-row">
            <span class="factor-label">Wind Speed</span>
            <div class="factor-bar-track"><div class="factor-bar factor-bar-wind" id="detail-bar-wind" style="width:0%"></div></div>
            <span class="factor-val" id="detail-val-wind">-- m/s</span>
          </div>
          <div class="factor-row">
            <span class="factor-label">Visibility Impact</span>
            <div class="factor-bar-track"><div class="factor-bar factor-bar-vis" id="detail-bar-vis" style="width:0%"></div></div>
            <span class="factor-val" id="detail-val-vis">-- km</span>
          </div>
          <div class="factor-row">
            <span class="factor-label">Heat Stress</span>
            <div class="factor-bar-track"><div class="factor-bar factor-bar-heat" id="detail-bar-heat" style="width:0%"></div></div>
            <span class="factor-val" id="detail-val-heat">--°C</span>
          </div>
        </div>
        <div class="ml-model-badge" id="detail-impact-engine">ML Engine · loading...</div>
      </div>
    `;

    const summary = await fetchGeminiIncidentSummary(incident);
    const locationEl = document.getElementById("detail-location");
    const timeEl = document.getElementById("detail-time");
    const reasonEl = document.getElementById("detail-reason");
    const durationEl = document.getElementById("detail-duration");
    if (!reasonEl || String(incident.id || "") !== String(state.selectedAlertIncidentId || "")) return;
    if (locationEl) locationEl.textContent = summary.location;
    if (timeEl) timeEl.textContent = summary.time;
    reasonEl.textContent = summary.reason;
    if (durationEl) durationEl.textContent = summary.duration;

    try {
      const { prediction, weather } = await fetchAlertTrafficImpactPrediction(incident);
      if (String(incident.id || "") !== String(state.selectedAlertIncidentId || "")) return;
      renderAlertTrafficImpactResult(prediction, weather);
    } catch (err) {
      if (String(incident.id || "") !== String(state.selectedAlertIncidentId || "")) return;
      const summaryEl = document.getElementById("detail-impact-summary");
      const badgeEl = document.getElementById("detail-impact-level");
      const engineEl = document.getElementById("detail-impact-engine");
      if (badgeEl) {
        badgeEl.textContent = "Prediction unavailable";
        badgeEl.className = "impact-level-badge impact-moderate";
      }
      if (summaryEl) summaryEl.textContent = `Traffic impact prediction unavailable: ${err.message}`;
      if (engineEl) engineEl.textContent = "ML Engine · unavailable";
    }
  }

  // 事故排序：按时间/按严重度
  function sortIncidents(incidents, mode) {
    const list = [...(incidents || [])];
    if (mode === "severity") {
      return list.sort((a, b) => {
        const sd = getIncidentSeverityScore(b) - getIncidentSeverityScore(a);
        if (sd !== 0) return sd;
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      });
    }
    return list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }

  // 同步“时间/严重度”排序按钮文案
  function renderIncidentSortButton() {
    const btn = document.getElementById("incident-sort-btn");
    if (!btn) return;
    btn.textContent = state.incidentSortMode === "severity" ? "SORT: SEVERITY" : "SORT: TIME";
  }

  // 管理员可切换事故源（LTA LIVE / 模拟事故）
  function renderIncidentSourceButton() {
    const btn = document.getElementById("admin-incident-source-btn");
    if (!btn) return;
    const show = isAdmin();
    btn.classList.toggle("hidden", !show);
    if (!show) return;
    btn.textContent = state.incidentDataSource === "mock" ? "DATA: SIMULATED INCIDENTS" : "DATA: LTA LIVE";
    btn.title = state.incidentDataSource === "mock"
      ? "Currently showing admin simulated incidents (with disappearance logic)"
      : "Currently showing LTA live incidents";
  }

  // 刷新 Dashboard Recent Updates 列表，并联动 Alerts 面板
  function renderIncidentUpdatesList() {
    const updatesEl = document.getElementById("dashboard-updates-list");
    if (!updatesEl) return;
    const sorted = sortIncidents(state.dashboardIncidents, state.incidentSortMode);
    updatesEl.innerHTML = sorted.map((it, idx) => `
      <li class="dashboard-update-item" data-incident-id="${String(it.id || `incident-${idx + 1}`)}">
        <span class="dot ${getIncidentSeverityColor(it)}"></span>
        <div>
          <strong>${it.message || it.type || "Traffic incident"}</strong>
          <span class="meta">Area: ${it.area || "Unknown"} · Camera: ${it.cameraName || "N/A"} · Spread: ${getIncidentSpreadText(it)} · Duration: ${getIncidentDurationText(it)}</span>
        </div>
      </li>
    `).join("");
    renderAlertsPanels();
  }

  function highlightDashboardEvidenceCard(incidentId) {
    const evidenceEl = document.getElementById("dashboard-evidence-list");
    if (!evidenceEl || !incidentId) return;
    const selector = `.evidence-card[data-incident-id="${String(incidentId).replace(/"/g, '\\"')}"]`;
    const card = evidenceEl.querySelector(selector);
    if (!card) return;
    try {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (_) {
      card.scrollIntoView();
    }
    card.classList.remove("evidence-card-highlight");
    void card.offsetWidth;
    card.classList.add("evidence-card-highlight");
    window.setTimeout(() => {
      card.classList.remove("evidence-card-highlight");
    }, 2000);
  }

  // 获取 Dashboard 事故数据；管理员可选择 live/mock
  async function fetchRealtimeIncidents() {
    const source = isAdmin() ? state.incidentDataSource : "live";
    const resp = await fetch(`/api/incidents?withImagesOnly=0&max=12&source=${encodeURIComponent(source)}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Failed to load incidents");
    return {
      incidents: data.value || [],
      meta: data.meta || null
    };
  }

  // 刷新 Dashboard 事故视图，并同步更新时间提示
  async function refreshDashboardIncidents() {
    const payload = await fetchRealtimeIncidents();
    state.incidentMeta = payload.meta || null;
    renderDashboardIncidents(payload.incidents || []);
    const hint = document.getElementById("summary-last-updated");
    if (hint && state.incidentMeta?.source === "mock") {
      const step = Number.isFinite(Number(state.incidentMeta.pollStep)) ? ` · Sim step ${state.incidentMeta.pollStep}` : "";
      const resolved = Number.isFinite(Number(state.incidentMeta.resolvedCount)) ? ` · Resolved this step: ${state.incidentMeta.resolvedCount}` : "";
      hint.textContent = `Last updated: ${new Date().toLocaleString("en-SG", { hour12: true })} · Simulated data${step}${resolved}`;
    }
  }

  // Dashboard 事故列表与证据图主渲染
  function renderDashboardIncidents(incidents) {
    const overviewEl = document.getElementById("incident-overview-section");
    const recentEl = document.getElementById("recent-updates-section");
    const updatesEl = document.getElementById("dashboard-updates-list");
    const evidenceEl = document.getElementById("dashboard-evidence-list");
    if (!overviewEl || !recentEl || !updatesEl || !evidenceEl) return;

    if (!Array.isArray(incidents) || incidents.length === 0) {
      overviewEl.style.display = "none";
      recentEl.style.display = "none";
      state.dashboardIncidents = [];
      renderAlertsPanels();
      return;
    }

    overviewEl.style.display = "";
    recentEl.style.display = "";

    const totalIncidents = incidents.length;
    const high = incidents.filter((x) => getIncidentSeverityScore(x) === 3).length;
    const medium = incidents.filter((x) => getIncidentSeverityScore(x) === 2).length;
    const low = incidents.filter((x) => getIncidentSeverityScore(x) === 1).length;
    const highest = high > 0 ? "HIGH" : medium > 0 ? "MEDIUM" : "LOW";

    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    setText("incident-total-num", String(totalIncidents));
    setText("severity-high-num", String(high));
    setText("severity-medium-num", String(medium));
    setText("severity-low-num", String(low));
    setText("incident-highest-severity", `Highest severity: ${highest}`);
    setText("incident-max-radius", "Max congestion radius: 2.0 km");
    setText("live-incidents-total", String(totalIncidents));
    setText("live-incidents-breakdown", `${high} high, ${medium} medium, ${low} low`);
    state.dashboardIncidents = incidents;
    renderIncidentSortButton();
    renderIncidentUpdatesList();

    evidenceEl.innerHTML = incidents.map((it, idx) => `
      <div class="evidence-card" data-incident-id="${String(it.id || `incident-${idx + 1}`)}">
        ${it.imageLink
          ? `<img src="${it.imageLink}" alt="${it.message || "incident"}" loading="lazy" />`
          : `<div style="height:120px;display:flex;align-items:center;justify-content:center;background:#f1f5f9;color:#64748b;font-size:12px;">No nearby camera image</div>`}
        <div class="evidence-card-body">
          <div class="evidence-card-title">${it.type || "Traffic incident"}</div>
          <div class="evidence-card-meta">${it.area || "Unknown area"}</div>
          <div class="evidence-card-meta">Spread ${getIncidentSpreadText(it)} · Duration ${getIncidentDurationText(it)}</div>
          <div class="evidence-card-meta">${it.cameraName ? `Camera: ${it.cameraName}` : "No nearby camera, showing incident text only"}</div>
        </div>
      </div>
    `).join("");
  }

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
      tbody.innerHTML = items.length ? items.map((item) => `
        <tr>
          <td>${new Date(item.createdAt).toLocaleString()}</td>
          <td>${item.userName || "-"}</td>
          <td>${item.userEmail || "-"}</td>
          <td>${item.location || "-"}</td>
          <td>${item.conditionType || "-"}</td>
          <td>${item.severity || "-"}</td>
          <td>${item.comment || "-"}</td>
        </tr>
      `).join("") : `<tr><td colspan="7">No feedback submitted yet.</td></tr>`;
      if (state.adminFeedbackVisible) drawAdminFeedbackMarkers();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7">Failed to load feedback table: ${err.message}</td></tr>`;
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
    tbody.innerHTML = items.length ? items.map((item) => `
      <tr>
        <td>${new Date(item.createdAt).toLocaleString()}</td>
        <td>${item.userName || "-"}</td>
        <td>${item.userEmail || "-"}</td>
        <td>${item.location || "-"}</td>
        <td>${item.conditionType || "-"}</td>
        <td>${item.severity || "-"}</td>
        <td>${item.comment || "-"}</td>
      </tr>
    `).join("") : `<tr><td colspan="7">No feedback matches the selected filters.</td></tr>`;
    if (state.adminFeedbackVisible) drawAdminFeedbackMarkers();
  }

  function drawAdminFeedbackMarkers() {
    if (!state.adminFeedbackMapLayer) return;
    state.adminFeedbackMapLayer.clearLayers();
    if (!isAdmin() || !state.adminFeedbackVisible) return;
    const items = getFilteredAdminFeedbackItems()
      .filter((item) => Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude)));
    items.forEach((item) => {
      const marker = L.circleMarker([Number(item.latitude), Number(item.longitude)], {
        radius: 7,
        color: "#fff",
        weight: 2,
        fillColor: "#7c3aed",
        fillOpacity: 0.95
      }).addTo(state.adminFeedbackMapLayer);
      marker.bindPopup(`
        <div style="font-size:12px;max-width:300px;">
          <div><strong>User:</strong> ${escapeHtml(item.userName || "-")}</div>
          <div><strong>Email:</strong> ${escapeHtml(item.userEmail || "-")}</div>
          <div><strong>Submitted:</strong> ${escapeHtml(new Date(item.createdAt).toLocaleString())}</div>
          <div><strong>Location:</strong> ${escapeHtml(item.location || "-")}</div>
          <div><strong>Type:</strong> ${escapeHtml(item.conditionType || "-")}</div>
          <div><strong>Severity:</strong> ${escapeHtml(item.severity || "-")}</div>
          <div><strong>Feedback:</strong> ${escapeHtml(item.comment || "-")}</div>
        </div>
      `);
    });
  }

  async function toggleAdminFeedbackLayer() {
    state.adminFeedbackVisible = !state.adminFeedbackVisible;
    if (state.adminFeedbackVisible && !state.adminFeedbackItems.length) {
      await renderAdminFeedbackPanel();
    } else {
      drawAdminFeedbackMarkers();
    }
    renderMapFeedbackToggleButton();
  }

  // 右侧路线详情面板（普通规划）
  function showRouteDetails(route) {
    if (!route) return;
    const eva = state.routeContext?.evaluation?.evaluations?.get(route.id) || { eventDelayMin: 0, hitCount: 0 };
    const currentFastestId = state.routeContext?.currentFastestId || null;
    const nearbyCameras = (state.routeContext?.events || []).filter(e => distanceToRouteMeters(route.coords, e.lat, e.lon) <= 350).reduce((sum, e) => sum + (e.cameras?.length ? 1 : 0), 0);
    const totalMinutes = route.estMinutes + eva.eventDelayMin * 0.7;
    const trafficLevel = eva.eventDelayMin > 18 ? "Heavy" : eva.eventDelayMin > 8 ? "Moderate" : "Light";

    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    const title = route.id === currentFastestId ? "FASTEST NOW" : (ROUTE_LABELS[route.id] || route.id.toUpperCase());
    setText("route-detail-title", title);
    setText("route-detail-time", `${Math.round(totalMinutes)} mins`);
    setText("route-detail-distance", `${(route.totalDist / 1000).toFixed(1)} km`);
    setText("route-detail-delay", `+${Math.round(eva.eventDelayMin)} mins`);
    setText("route-detail-lights", `${route.trafficLights} signals`);
    setText("route-detail-type", route.id === "fastest" ? "Expressway priority" : route.id === "fewerLights" ? "Intersection-light avoidance" : "Balanced urban route");
    setText("route-detail-speed", `Average speed: ${(route.totalDist / 1000 / (Math.max(totalMinutes, 1) / 60)).toFixed(1)} km/h`);
    setText("route-detail-cameras", `Cameras available: ${nearbyCameras}`);

    const trafficEl = document.getElementById("route-detail-traffic");
    if (trafficEl) {
      const dotColor = trafficLevel === "Heavy" ? "red" : trafficLevel === "Moderate" ? "orange" : "green";
      trafficEl.innerHTML = `<span class="dot ${dotColor}"></span> ${trafficLevel}`;
    }
    const confirmBtn = document.getElementById("route-confirm-btn");
    if (confirmBtn) {
      const inUse = state.confirmedRouteId === route.id;
      confirmBtn.textContent = inUse ? "ROUTE IN USE" : "USE THIS ROUTE";
      confirmBtn.disabled = inUse;
      confirmBtn.setAttribute("data-route-id", route.id);
    }
  }

  // 右侧路线详情面板（管理员模拟）
  function showSimulationRouteDetails(sim, routeId) {
    if (!sim || !Array.isArray(sim.routes) || !sim.routes.length) return;
    const route = sim.routes.find(r => r.id === routeId) || sim.routes[0];
    if (!route) return;

    const trafficLevel = route.incidentDelayMin > 10 ? "Heavy" : route.incidentDelayMin > 4 ? "Moderate" : "Light";
    const avgSpeed = route.distanceKm / (Math.max(route.simulatedEtaMin, 1) / 60);
    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    const strategyName = route.id === "fastest"
      ? "Time-priority strategy"
      : route.id === "fewerLights"
        ? "Fewer-signals strategy"
        : "Balanced strategy";
    setText("route-detail-title", `Simulated ${strategyName}`);
    setText("route-detail-time", `${Math.round(route.simulatedEtaMin)} mins`);
    setText("route-detail-distance", `${route.distanceKm.toFixed(1)} km`);
    setText("route-detail-delay", `+${Math.round(route.incidentDelayMin)} mins`);
    setText("route-detail-lights", `${route.lights} signals`);
    setText("route-detail-type", "Standalone A* simulation route");
    setText("route-detail-speed", `Average speed: ${avgSpeed.toFixed(1)} km/h`);
    setText("route-detail-cameras", `Simulation incidents: ${route.incidents.length}`);

    const trafficEl = document.getElementById("route-detail-traffic");
    if (trafficEl) {
      const dotColor = trafficLevel === "Heavy" ? "red" : trafficLevel === "Moderate" ? "orange" : "green";
      trafficEl.innerHTML = `<span class="dot ${dotColor}"></span> ${trafficLevel}`;
    }
  }

  function resetRouteDetailPanel() {
    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    setText("route-detail-title", "FASTEST");
    setText("route-detail-time", "--");
    setText("route-detail-distance", "--");
    setText("route-detail-delay", "--");
    setText("route-detail-lights", "--");
    setText("route-detail-type", "--");
    setText("route-detail-speed", "Average speed: --");
    setText("route-detail-cameras", "Cameras available: --");
    const trafficEl = document.getElementById("route-detail-traffic");
    if (trafficEl) trafficEl.innerHTML = `<span class="dot green"></span> --`;
    const confirmBtn = document.getElementById("route-confirm-btn");
    if (confirmBtn) {
      confirmBtn.textContent = "USE THIS ROUTE";
      confirmBtn.disabled = true;
      confirmBtn.removeAttribute("data-route-id");
    }
  }

  function clearConfirmedRouteTracking() {
    state.confirmedRouteId = null;
    state.confirmedRoutePlan = null;
    state.confirmedRouteOriginalStartGeo = null;
    state.confirmedRouteEndGeo = null;
    state.confirmedRouteLastReplanAt = 0;
    state.confirmedTravelledCoords = [];
    state.confirmedLastLiveCoord = null;
    state.routeNearestCameraVisible = false;
    if (state.routeLiveWatchId != null && navigator.geolocation && navigator.geolocation.clearWatch) {
      navigator.geolocation.clearWatch(state.routeLiveWatchId);
    }
    if (state.mobileLocationPollId != null) {
      clearInterval(state.mobileLocationPollId);
    }
    state.mobileLocationPollId = null;
    state.routeLiveWatchId = null;
    state.routeLiveMarker = null;
    if (state.routeConfirmProgressLayer) state.routeConfirmProgressLayer.clearLayers();
    if (state.routeConfirmMarkerLayer) state.routeConfirmMarkerLayer.clearLayers();
    if (state.routeConfirmPoiLayer) state.routeConfirmPoiLayer.clearLayers();
    if (state.routeNearestCameraLayer) state.routeNearestCameraLayer.clearLayers();
    renderRouteCameraToggleButton();
  }

  function renderRouteCameraToggleButton() {
    const btn = document.getElementById("route-view-cameras-btn");
    if (!btn) return;
    btn.textContent = state.routeNearestCameraVisible ? "HIDE LIVE CAMERA" : "VIEW LIVE CAMERAS";
  }

  function getNearestRealtimeCameraForLiveLocation() {
    const liveLoc = state.confirmedLastLiveCoord || (state.userLocation && Number.isFinite(state.userLocation.lat) && Number.isFinite(state.userLocation.lon)
      ? { lat: state.userLocation.lat, lon: state.userLocation.lon }
      : null);
    if (!liveLoc) return null;
    let best = null;
    let bestDistance = Infinity;
    (state.cameras || []).forEach((cam) => {
      if (!cam.hasRealtimeImage) return;
      const d = haversine(liveLoc.lat, liveLoc.lon, cam.lat, cam.lon);
      if (d < bestDistance) {
        bestDistance = d;
        best = cam;
      }
    });
    if (!best) return null;
    return { camera: best, distanceMeters: bestDistance, liveLoc };
  }

  function toggleRouteNearestLiveCamera() {
    if (!state.routeNearestCameraLayer) return;
    if (state.routeNearestCameraVisible) {
      state.routeNearestCameraLayer.clearLayers();
      state.routeNearestCameraVisible = false;
      renderRouteCameraToggleButton();
      return;
    }
    const nearest = getNearestRealtimeCameraForLiveLocation();
    if (!nearest) {
      alert("No nearby live camera found for your current location.");
      return;
    }
    const cam = nearest.camera;
    state.routeNearestCameraLayer.clearLayers();
    const marker = L.marker([cam.lat, cam.lon], {
      icon: getMapPoiIcon("camera")
    }).addTo(state.routeNearestCameraLayer);
    marker.bindPopup(`
      <div style="font-size:12px;max-width:260px;">
        <strong>${escapeHtml(cam.name)}</strong><br/>
        <span>${escapeHtml(cam.source || "Unknown source")}</span><br/>
        <span>Distance from live location: ${Math.round(nearest.distanceMeters)} m</span><br/>
        ${cam.imageLink ? `<img src="${escapeHtml(cam.imageLink)}" alt="${escapeHtml(cam.name)}" style="margin-top:6px;width:100%;border-radius:6px;" />` : "No realtime image"}
      </div>
    `).openPopup();
    if (state.plannerMap) {
      state.plannerMap.flyTo([cam.lat, cam.lon], Math.max(state.plannerMap.getZoom(), 14), { duration: 0.8 });
    }
    state.routeNearestCameraVisible = true;
    renderRouteCameraToggleButton();
  }

  function redrawConfirmedRouteProgress(lat, lon) {
    if (!state.routeConfirmProgressLayer || !state.confirmedRoutePlan) return { offRoute: false };
    state.routeConfirmProgressLayer.clearLayers();
    const route = state.confirmedRoutePlan;
    const progress = splitRouteProgress(route.coords, lat, lon);
    const travelledHistory = Array.isArray(state.confirmedTravelledCoords) ? state.confirmedTravelledCoords.slice() : [];
    if (!travelledHistory.length && state.confirmedRouteOriginalStartGeo) {
      travelledHistory.push([state.confirmedRouteOriginalStartGeo.lat, state.confirmedRouteOriginalStartGeo.lon]);
    }
    if (!travelledHistory.length || haversine(travelledHistory[travelledHistory.length - 1][0], travelledHistory[travelledHistory.length - 1][1], lat, lon) > 2) {
      travelledHistory.push([lat, lon]);
    }
    if (travelledHistory.length >= 2) {
      L.polyline(travelledHistory, {
        color: "#94a3b8",
        weight: 6,
        opacity: 0.95
      }).addTo(state.routeConfirmProgressLayer);
    }
    if (progress.remaining.length >= 2) {
      L.polyline(progress.remaining, {
        color: route.color || ROUTE_COLORS[route.id] || "#2563eb",
        weight: 6,
        opacity: 0.95
      }).addTo(state.routeConfirmProgressLayer);
    }
    return { offRoute: Number(progress.distanceToRoute) > 90 };
  }

  async function recalculateConfirmedRouteFromLiveLocation(lat, lon) {
    if (!state.confirmedRouteEndGeo) return;
    const now = Date.now();
    if (now - state.confirmedRouteLastReplanAt < 6000) return;
    state.confirmedRouteLastReplanAt = now;
    const hintEl = document.getElementById("route-planning-hint");

    const liveStartGeo = { lat, lon, display: "Current Location" };
    const endGeo = state.confirmedRouteEndGeo;
    const userLoc = { lat, lon };
    const plans = await fetchRoutePlansFromPython(liveStartGeo, endGeo, 0.03);
    if (!plans.length) throw new Error("No valid route plan generated during rerouting.");

    const realtimeCameras = state.cameras.filter((c) => c.hasRealtimeImage);
    const liveRouteEvents = mapLiveIncidentsToRouteEvents(state.dashboardIncidents);
    const defaultRoute = plans.find((r) => r.id === "fastest") || plans[0];
    const baseCoords = getRouteCoords(defaultRoute, liveStartGeo, endGeo);
    const relevantEvents = await analyzeEventsViaBackend(liveRouteEvents, userLoc, baseCoords);
    const eventsWithCameras = attachEventCameras(relevantEvents, realtimeCameras);
    const evaluation = await evaluateRoutesByEventsViaBackend(plans, eventsWithCameras);
    const currentFastestId = evaluation.currentFastestId || deriveCurrentFastestId(plans, evaluation) || plans[0].id;

    state.routePlans = plans;
    state.routeContext = {
      userLoc,
      events: eventsWithCameras,
      evaluation,
      startGeo: liveStartGeo,
      endGeo,
      currentFastestId,
      generatedAt: new Date().toISOString()
    };
    state.selectedRouteId = evaluation.recommendedRouteId || getPreferredRouteId() || plans[0].id;
    drawRoutes(liveStartGeo, endGeo, { preserveView: true });
    applyRoutePreferenceSelection();
    renderRouteCards();
    const newSelected = state.routePlans.find((r) => r.id === state.selectedRouteId) || state.routePlans[0];
    state.confirmedRouteId = newSelected.id;
    state.confirmedRoutePlan = newSelected;
    renderConfirmedRouteContextPoints(newSelected);
    redrawConfirmedRouteProgress(lat, lon);
    showRouteDetails(newSelected);
    if (hintEl) hintEl.textContent = "You left the planned route. Navigation has been recalculated from your live location.";
  }

  function updateConfirmedLiveMarker(lat, lon) {
    if (!state.routeConfirmMarkerLayer || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    state.userLocation = { lat: lat, lon: lon };
    const last = state.confirmedLastLiveCoord;
    if (!last || haversine(last.lat, last.lon, lat, lon) > 8) {
      state.confirmedTravelledCoords.push([lat, lon]);
      state.confirmedLastLiveCoord = { lat, lon };
    }
    if (!state.routeLiveMarker) {
      state.routeLiveMarker = L.circleMarker([lat, lon], {
        radius: 7,
        color: "#ffffff",
        weight: 2,
        fillColor: "#ef4444",
        fillOpacity: 1
      }).bindPopup("Current Location").addTo(state.routeConfirmMarkerLayer);
      return;
    }
    state.routeLiveMarker.setLatLng([lat, lon]);
    const progressState = redrawConfirmedRouteProgress(lat, lon);
    if (progressState.offRoute && state.confirmedRouteEndGeo) {
      recalculateConfirmedRouteFromLiveLocation(lat, lon).catch((err) => {
        console.error("Route replanning failed:", err);
      });
    }
  }

  function startConfirmedRouteTracking() {
    let mobileMissCount = 0;
    if (state.mobileLocationPollId != null) {
      clearInterval(state.mobileLocationPollId);
      state.mobileLocationPollId = null;
    }
    if (state.routeLiveWatchId != null && navigator.geolocation && navigator.geolocation.clearWatch) {
      navigator.geolocation.clearWatch(state.routeLiveWatchId);
      state.routeLiveWatchId = null;
    }

    function ensureBrowserFallbackWatch() {
      if (!navigator.geolocation || !navigator.geolocation.watchPosition) return;
      if (state.routeLiveWatchId != null) return;
      state.routeLiveWatchId = navigator.geolocation.watchPosition(
        function (pos) {
          updateConfirmedLiveMarker(Number(pos.coords.latitude), Number(pos.coords.longitude));
        },
        function (err) {
          console.error("Live route tracking failed:", err);
        },
        { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 }
      );
    }

    function stopBrowserFallbackWatch() {
      if (state.routeLiveWatchId != null && navigator.geolocation && navigator.geolocation.clearWatch) {
        navigator.geolocation.clearWatch(state.routeLiveWatchId);
      }
      state.routeLiveWatchId = null;
    }

    state.mobileLocationPollId = setInterval(async () => {
      try {
        const mobileLoc = await fetchLatestMobileLocation();
        if (mobileLoc) {
          mobileMissCount = 0;
          stopBrowserFallbackWatch();
          updateConfirmedLiveMarker(Number(mobileLoc.lat), Number(mobileLoc.lon));
        } else {
          mobileMissCount += 1;
          if (mobileMissCount >= 15) ensureBrowserFallbackWatch();
        }
      } catch (err) {
        console.error("Mobile location polling failed:", err);
        mobileMissCount += 1;
        if (mobileMissCount >= 15) ensureBrowserFallbackWatch();
      }
    }, 1000);
  }

  function renderConfirmedRouteContextPoints(route) {
    if (!route || !state.routeConfirmPoiLayer) return;
    state.routeConfirmPoiLayer.clearLayers();

    const relatedCameras = (state.cameras || [])
      .filter((cam) => cam.hasRealtimeImage && distanceToRouteMeters(route.coords, cam.lat, cam.lon) <= 250)
      .slice(0, 18);

    relatedCameras.forEach((cam) => {
      L.marker([cam.lat, cam.lon], {
        icon: getMapPoiIcon("camera")
      })
        .bindPopup(`
          <div style="font-size:12px;max-width:260px;">
            <strong>${escapeHtml(cam.name)}</strong><br/>
            <span>${escapeHtml(cam.source || "Unknown source")}</span><br/>
            ${cam.imageLink ? `<img src="${escapeHtml(cam.imageLink)}" alt="${escapeHtml(cam.name)}" style="margin-top:6px;width:100%;border-radius:6px;" />` : "No realtime image"}
          </div>
        `)
        .addTo(state.routeConfirmPoiLayer);
    });

    const relatedEvents = (state.routeContext?.events || [])
      .filter((evt) => distanceToRouteMeters(route.coords, evt.lat, evt.lon) <= 350);

    relatedEvents.forEach((evt) => {
      const createdAt = evt.createdAt || new Date().toISOString();
      L.marker([evt.lat, evt.lon], {
        icon: getMapPoiIcon("incident")
      })
        .bindPopup(`
          <div style="font-size:12px;max-width:280px;">
            <div><strong>Incident Type: </strong>${escapeHtml(evt.label || evt.type || "Traffic incident")}</div>
            <div><strong>Location: </strong>${escapeHtml(evt.area || evt.message || "Along active route")}</div>
            <div><strong>Elapsed Time: </strong>${escapeHtml(getIncidentElapsedText({ message: evt.message, area: evt.area, createdAt: createdAt }))}</div>
            <div><strong>Estimated Clear Time: </strong>${escapeHtml(getIncidentEstimatedClearText({ message: evt.message, area: evt.area, createdAt: createdAt, estimatedDurationMin: Math.max(10, Math.round((evt.delayMin || 8) * 2)), estimatedDurationMax: Math.max(20, Math.round((evt.delayMin || 8) * 4)) }))}</div>
            <div><strong>Estimated Impact Time: </strong>${escapeHtml(getIncidentDurationText({ estimatedDurationMin: Math.max(10, Math.round((evt.delayMin || 8) * 2)), estimatedDurationMax: Math.max(20, Math.round((evt.delayMin || 8) * 4)) }))}</div>
          </div>
        `)
        .addTo(state.routeConfirmPoiLayer);
    });
  }

  async function confirmSelectedRouteUsage() {
    const route = state.routePlans.find((r) => r.id === state.selectedRouteId) || state.routePlans[0];
    const startGeo = state.routeContext?.startGeo;
    const endGeo = state.routeContext?.endGeo;
    const hintEl = document.getElementById("route-planning-hint");
    if (!route || !startGeo || !endGeo || !state.routeConfirmMarkerLayer) return;

    clearConfirmedRouteTracking();
    state.confirmedRouteId = route.id;
    state.confirmedRoutePlan = route;
    state.confirmedRouteOriginalStartGeo = startGeo;
    state.confirmedRouteEndGeo = endGeo;
    state.confirmedTravelledCoords = [[startGeo.lat, startGeo.lon]];
    state.confirmedLastLiveCoord = { lat: startGeo.lat, lon: startGeo.lon };

    const pinIcon = (label, bg) => L.divIcon({
      className: "route-pin-icon-wrap",
      html: `<div class="route-pin-icon" style="background:${bg}"><span>${label}</span></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -24]
    });

    const [startPopupHtml, endPopupHtml] = await Promise.all([
      buildRouteEndpointPopupHtml("Start", startGeo),
      buildRouteEndpointPopupHtml("Destination", endGeo)
    ]);

    L.marker([startGeo.lat, startGeo.lon], { icon: pinIcon("S", "#2563eb") })
      .bindPopup(startPopupHtml)
      .addTo(state.routeConfirmMarkerLayer);
    L.marker([endGeo.lat, endGeo.lon], { icon: pinIcon("D", "#10b981") })
      .bindPopup(endPopupHtml)
      .addTo(state.routeConfirmMarkerLayer);

    renderConfirmedRouteContextPoints(route);
    if (Array.isArray(route.coords) && route.coords.length >= 2) {
      redrawConfirmedRouteProgress(route.coords[0][0], route.coords[0][1]);
    }

    try {
      const loc = await getUserLocation();
      if (loc) updateConfirmedLiveMarker(Number(loc.lat), Number(loc.lon));
    } catch (err) {
      console.error(err);
    }
    startConfirmedRouteTracking();
    renderRouteCameraToggleButton();
    if (hintEl) hintEl.textContent = "Navigation started. Start and destination are pinned. The red dot follows your live location.";
    showRouteDetails(route);
  }

  function clearCurrentRoutePlan() {
    const startInput = document.getElementById("route-start-postal");
    const endInput = document.getElementById("route-end-postal");
    const hintEl = document.getElementById("route-planning-hint");
    const cardsEl = document.getElementById("route-cards");
    const titleEl = document.getElementById("route-options-title");

    if (startInput) startInput.value = "";
    if (endInput) endInput.value = "";
    if (hintEl) hintEl.textContent = "Current route cleared. Enter a new start and destination to plan again.";
    if (cardsEl) cardsEl.innerHTML = "";
    if (titleEl) titleEl.textContent = "ROUTE OPTIONS (0)";

    state.routePlans = [];
    state.selectedRouteId = null;
    state.routeContext = null;
    state.routeStartCurrentGeo = null;
    state.selectedAlertIncidentId = null;
    clearConfirmedRouteTracking();

    if (state.routeLayer) state.routeLayer.clearLayers();
    if (state.plannerLayer) state.plannerLayer.clearLayers();
    state.routePolylines.clear();

    resetRouteDetailPanel();
    renderAlertsPanels();
  }

  // 渲染 3 条路线卡片，并按“含事件延误后的 ETA”排序
  function renderRouteCards() {
    const container = document.getElementById("route-cards");
    const title = document.getElementById("route-options-title");
    if (!container) return;
    if (title) title.textContent = `ROUTE OPTIONS (${state.routePlans.length}) · SORTED BY TIME`;

    const currentFastestId = state.routeContext?.currentFastestId || null;
    const enriched = state.routePlans.map((r) => {
      const eva = state.routeContext?.evaluation?.evaluations?.get(r.id) || { eventDelayMin: 0 };
      const totalMinutes = r.estMinutes + eva.eventDelayMin * 0.7;
      const trafficLevel = eva.eventDelayMin > 18 ? "Heavy" : eva.eventDelayMin > 8 ? "Moderate" : "Light";
      const routeLabel = r.id === currentFastestId ? "FASTEST NOW" : (ROUTE_LABELS[r.id] || r.id.toUpperCase());
      const routeIncidents = (eva.hits || []).length;
      const routeCameras = (state.cameras || []).filter((cam) => cam.hasRealtimeImage && distanceToRouteMeters(r.coords, cam.lat, cam.lon) <= 250).length;
      return { r, eva, totalMinutes, trafficLevel, routeLabel, routeIncidents, routeCameras };
    });

    const minTotal = Math.min(...enriched.map(x => x.totalMinutes));
    const minDist = Math.min(...enriched.map(x => x.r.totalDist));
    const minLights = Math.min(...enriched.map(x => x.r.trafficLights));
    const avgTotal = enriched.reduce((sum, x) => sum + x.totalMinutes, 0) / Math.max(1, enriched.length);

    const sorted = enriched.slice().sort((a, b) => a.totalMinutes - b.totalMinutes);

    function getStatusTag(item) {
      if (Math.abs(item.totalMinutes - minTotal) < 1e-6) return "Fastest by time";
      if (Math.abs(item.r.totalDist - minDist) < 1e-6) return "Shortest distance";
      if (item.r.trafficLights === minLights) return "Fewest traffic signals";
      const dev = Math.abs(item.totalMinutes - avgTotal);
      const minDev = Math.min(...sorted.map(x => Math.abs(x.totalMinutes - avgTotal)));
      if (Math.abs(dev - minDev) < 1e-6) return "Balanced average";
      return "Balanced route";
    }

    container.innerHTML = sorted.map((item, idx) => {
      const r = item.r;
      const eva = item.eva;
      const totalMinutes = item.totalMinutes;
      const trafficLevel = item.trafficLevel;
      const routeLabel = item.routeLabel;
      const statusTag = getStatusTag(item);
      // Edited by JR here - added new "Save Habit Route" button
      return `
      <div class="route-card route-card-${r.id} ${r.id === state.selectedRouteId ? "selected" : ""}" data-route-id="${r.id}">
        <button type="button" class="save-habit-btn" data-save-id="${r.id}" title="Save as Habit Route">SAVE</button>
        <div class="route-card-main">${Math.round(totalMinutes)} mins</div>
        <div class="route-card-erp">+${Math.round(eva.eventDelayMin)} mins delay</div>
        <div class="route-card-status">#${idx + 1} · ${statusTag}</div>
        <div class="route-card-icons">
          <span class="icon-plane"></span>
          <span class="icon-traffic">${r.trafficLights}</span>
          <span class="dot ${trafficLevel === "Heavy" ? "red" : trafficLevel === "Moderate" ? "orange" : "green"}"></span>
        </div>
        <div class="route-card-metrics">Distance ${(r.totalDist / 1000).toFixed(1)} km · Lights ${r.trafficLights}</div>
        <div class="route-card-metrics">Incidents ${item.routeIncidents} · Cameras ${item.routeCameras}</div>
      </div>
    `;
    }).join("");

    container.querySelectorAll(".route-card").forEach((el) => {
      el.addEventListener("click", () => {
     

        const id = el.getAttribute("data-route-id");
        selectRoute(id);
      });
    });

    // For save btn logic to add habit routes
    container.querySelectorAll(".save-habit-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation(); // Stop from selecting route on map
        const routeId = btn.getAttribute("data-save-id");
        const routeObj = state.routePlans.find(r => r.id === routeId);
        if (routeObj) {
            await saveRouteAsHabit(routeObj, btn);
        }
      });
    });
  }

  // 在规划地图绘制路线折线，并突出选中路线
  function drawRoutes(startGeo, endGeo, options) {
    if (!state.plannerMap || !state.routeLayer || !state.plannerLayer) return;
    const preserveView = Boolean(options && options.preserveView);
    state.routeLayer.clearLayers();
    state.routePolylines.clear();
    state.plannerLayer.clearLayers();

    state.routePlans.forEach((r) => {
      const line = L.polyline(r.coords, {
        color: r.color || ROUTE_COLORS[r.id] || "#2563eb",
        weight: r.id === state.selectedRouteId ? 6 : 4,
        opacity: r.id === state.selectedRouteId ? 0.95 : 0.55
      }).addTo(state.routeLayer);
      line.routeId = r.id;
      state.routePolylines.set(r.id, line);
    });

    const selected = state.routePlans.find(r => r.id === state.selectedRouteId) || state.routePlans[0];
    if (selected) {
      if (!preserveView) {
        const bounds = L.latLngBounds(selected.coords.map(c => [c[0], c[1]]));
        state.plannerMap.fitBounds(bounds.pad(0.05));
      }
      showRouteDetails(selected);
    }
  }

  // 用户点击路线卡片后的联动：高亮折线 + 刷新详情 + 同步 Alerts
  function selectRoute(routeId) {
    state.selectedRouteId = routeId;
    const selected = state.routePlans.find(r => r.id === routeId);
    if (!selected) return;
    showRouteDetails(selected);
    renderRouteCards();
    if (state.routeLayer) {
      state.routeLayer.eachLayer((layer) => {
        const id = layer.routeId;
        layer.setStyle({
          weight: id === routeId ? 6 : 4,
          opacity: id === routeId ? 0.95 : 0.55
        });
      });
    }
    renderAlertsPanels();
  }

  // 获取并标准化摄像头数据（聚合来源由后端负责）
  async function fetchCameras() {
    const res = await fetch("/api/cameras?max=4000");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load cameras");
    return (data.value || []).map((cam, i) => ({
      id: cam.CameraID || `cam-${i}`,
      name: cam.Name || `Camera ${i + 1}`,
      source: cam.Source || "Unknown",
      lat: parseFloat(cam.Latitude),
      lon: parseFloat(cam.Longitude),
      imageLink: cam.ImageLink || null,
      hasRealtimeImage: Boolean(cam.HasRealtimeImage && cam.ImageLink)
    })).filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lon));
  }

  async function fetchOneMotoringErpMarkers() {
    const res = await fetch("/api/onemotoring/erp");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load ERP markers");
    return Array.isArray(data.value) ? data.value : [];
  }

  async function fetchOneMotoringPgsMarkers() {
    const res = await fetch("/api/onemotoring/pgs");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load PGS markers");
    return Array.isArray(data.value) ? data.value : [];
  }

  function formatRateLine(label, value) {
    const safe = String(value || "").trim();
    if (!safe) return "";
    return `<div><strong>${label}: </strong>${escapeHtml(safe)}</div>`;
  }

  function renderLocalErpRatesTable(localRates) {
    const rows = Array.isArray(localRates) ? localRates : [];
    if (!rows.length) return "";
    return `
      <div style="margin-top:8px;">
        <div style="font-weight:700;margin-bottom:6px;">ERP price bands</div>
        <div style="max-height:180px;overflow:auto;border:1px solid #dbeafe;border-radius:8px;">
          <table style="width:100%;border-collapse:collapse;font-size:11px;background:#fff;">
            <thead>
              <tr>
                <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #dbeafe;position:sticky;top:0;background:#eff6ff;">Time</th>
                <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #dbeafe;position:sticky;top:0;background:#eff6ff;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => `
                <tr>
                  <td style="padding:6px 8px;border-bottom:1px solid #eff6ff;">${escapeHtml(row.time || "")}</td>
                  <td style="padding:6px 8px;border-bottom:1px solid #eff6ff;">${escapeHtml(row.price || "")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function drawErpMarkers() {
    if (!state.liveMap || !state.liveErpLayer) return;
    state.liveErpLayer.clearLayers();
    if (!state.mapErpVisible) return;
    (state.mapErpItems || []).forEach((item) => {
      const localRatesHtml = renderLocalErpRatesTable(item.localRates);
      const popupHtml = `
        <div style="font-size:12px;max-width:320px;">
          <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(item.name || "ERP Gantry")}</div>
          ${item.gantryNo ? `<div style="margin-bottom:6px;"><strong>Gantry No: </strong>${escapeHtml(item.gantryNo)}</div>` : ``}
          ${localRatesHtml || ``}
          ${!localRatesHtml ? `<div>Pricing unavailable.</div>` : ``}
        </div>
      `;
      L.marker([item.lat, item.lon], {
        icon: getMapPoiIcon("erp")
      }).bindPopup(popupHtml).addTo(state.liveErpLayer);
    });
  }

  function drawPgsMarkers() {
    if (!state.liveMap || !state.livePgsLayer) return;
    state.livePgsLayer.clearLayers();
    if (!state.mapPgsVisible) return;
    (state.mapPgsItems || []).forEach((item) => {
      const rates = item.rates || null;
      const popupHtml = `
        <div style="font-size:12px;max-width:320px;">
          <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(item.name || "PGS Car Park")}</div>
          ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name || "PGS Car Park")}" style="width:100%;max-width:300px;border-radius:8px;margin-bottom:8px;" />` : ``}
          <div><strong>Available lots: </strong>${escapeHtml(item.availability || "N/A")}</div>
          <div><strong>Updated at: </strong>${escapeHtml(item.availabilityUpdatedAt || "N/A")}</div>
          ${rates ? `
            <hr style="border:none;border-top:1px solid #dbeafe;margin:8px 0;" />
            <div style="font-weight:700;margin-bottom:4px;">Official parking rates</div>
            ${formatRateLine("Weekdays before 5/6pm", rates.weekdayBefore)}
            ${formatRateLine("Weekdays after 5/6pm", rates.weekdayAfter)}
            ${formatRateLine("Saturdays", rates.saturday)}
            ${formatRateLine("Sundays / Public Holidays", rates.sunday)}
          ` : `<div style="margin-top:8px;">Official parking rate data not matched for this location.</div>`}
        </div>
      `;
      L.marker([item.lat, item.lon], {
        icon: getMapPoiIcon("pgs")
      }).bindPopup(popupHtml).addTo(state.livePgsLayer);
    });
  }

  async function toggleMapErpLayer() {
    if (!state.mapErpItems.length) {
      state.mapErpItems = await fetchOneMotoringErpMarkers();
    }
    state.mapErpVisible = !state.mapErpVisible;
    renderMapErpToggleButton();
    drawErpMarkers();
  }

  async function toggleMapPgsLayer() {
    if (!state.mapPgsItems.length) {
      state.mapPgsItems = await fetchOneMotoringPgsMarkers();
    }
    state.mapPgsVisible = !state.mapPgsVisible;
    renderMapPgsToggleButton();
    drawPgsMarkers();
  }

  // 地理编码：支持邮编/地名/MRT（后端做多源解析）
  async function geocodeLocation(inputText) {
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(inputText)}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Geocode failed");
    return {
      lat: parseFloat(d.lat),
      lon: parseFloat(d.lon),
      display: d.display || inputText,
      postal: d.postal || "",
      address: d.address || d.display || inputText
    };
  }

  async function reverseGeocodeLocation(lat, lon) {
    const r = await fetch(`/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Reverse geocode failed");
    return {
      lat: parseFloat(d.lat),
      lon: parseFloat(d.lon),
      display: d.display || "Current Location",
      postal: d.postal || "",
      address: d.address || d.display || "Current Location"
    };
  }

  async function getRouteEndpointWeather(lat, lon) {
    const r = await fetch(`/api/weather/current?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Weather fetch failed");
    return d;
  }

  function formatWeatherLabel(desc) {
    return String(desc || "--").split(" ").map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : "").join(" ");
  }

  async function buildRouteEndpointPopupHtml(label, fallbackGeo) {
    const lat = Number(fallbackGeo?.lat);
    const lon = Number(fallbackGeo?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return `<div style="font-size:12px;max-width:260px;"><strong>${escapeHtml(label)}</strong></div>`;
    }
    const [place, weather] = await Promise.all([
      reverseGeocodeLocation(lat, lon).catch(() => ({
        display: fallbackGeo?.display || label,
        postal: fallbackGeo?.postal || "",
        address: fallbackGeo?.address || fallbackGeo?.display || label
      })),
      getRouteEndpointWeather(lat, lon).catch(() => null)
    ]);
    const rawTitle = String(place.display || fallbackGeo?.display || label).trim();
    const rawAddress = String(place.address || fallbackGeo?.address || "").trim();
    let title = rawTitle;
    if (label === "Start" && String(fallbackGeo?.display || "").trim() === "Current Location") {
      let locationName = rawTitle;
      if (!locationName || locationName.toLowerCase() === "current location") {
        const firstAddressPart = rawAddress ? rawAddress.split(",")[0].trim() : "";
        locationName = firstAddressPart || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      }
      title = `Current Location: ${locationName}`;
    }
    const postal = place.postal || fallbackGeo?.postal || "";
    const weatherText = weather ? `${weather.temp}°C · ${formatWeatherLabel(weather.desc)}` : "Weather unavailable";
    return `
      <div style="font-size:12px;max-width:280px;line-height:1.5;">
        <div><strong>${escapeHtml(label)}</strong></div>
        <div><strong>Name: </strong>${escapeHtml(title)}</div>
        ${postal ? `<div><strong>Postal Code: </strong>${escapeHtml(postal)}</div>` : ""}
        <div><strong>Weather: </strong>${escapeHtml(weatherText)}</div>
      </div>
    `;
  }

  // 新版路径规划入口：调用后端 /api/route-plan（Python A*）
  async function fetchRoutePlansFromPython(startGeo, endGeo, paddingDeg) {
    const resp = await fetch("/api/route-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: { lat: startGeo.lat, lon: startGeo.lon },
        end: { lat: endGeo.lat, lon: endGeo.lon },
        paddingDeg: Number.isFinite(Number(paddingDeg)) ? Number(paddingDeg) : undefined
      })
    });
    const data = await resp.json();
    if (!resp.ok) {
      const detail = data?.details ? `: ${data.details}` : "";
      throw new Error((data.error || "Python route-plan failed") + detail);
    }
    const routes = Array.isArray(data.routes) ? data.routes : [];
    return routes
      .map((r) => ({
        id: r.id,
        label: r.label || (ROUTE_LABELS[r.id] || String(r.id || "").toUpperCase()),
        color: r.color || ROUTE_COLORS[r.id] || "#2563eb",
        desc: r.desc || "",
        totalDist: Number(r.totalDist),
        estMinutes: Number(r.estMinutes),
        trafficLights: Math.max(0, Math.round(Number(r.trafficLights) || 0)),
        coords: (Array.isArray(r.coords) ? r.coords : []).map((c) => [Number(c[0]), Number(c[1])]).filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])),
        signature: r.signature || `${r.id || "route"}-${Math.random().toString(36).slice(2, 8)}`,
        path: []
      }))
      .filter((r) => r.id && Number.isFinite(r.totalDist) && Number.isFinite(r.estMinutes) && Array.isArray(r.coords) && r.coords.length >= 2);
  }

  // 读取管理员模拟配置（事件比例、延误、严重度等）
  async function loadAdminSimulationConfig() {
    if (!isAdmin()) return;
    const panel = document.getElementById("admin-sim-panel");
    if (!panel) return;
    panel.classList.remove("hidden");
    try {
      const resp = await window.fastAuthFetch("/api/admin/simulation-config");
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Load config failed");
      state.adminSimulationConfig = data.config || null;
    } catch (err) {
      console.error(err);
      state.adminSimulationConfig = null;
    }
  }

  async function saveAdminSimulationConfig() {
    return;
  }

  // 构造管理员“独立模拟路段”：固定起终点 + 3 条路线 + 模拟事故
  async function buildStandaloneSimulation() {
    const start = { lat: 1.3114, lon: 103.7808, label: "Sim Start (Queenstown)" };
    const end = { lat: 1.3694, lon: 103.9496, label: "Sim End (Tampines)" };
    const plans = (await fetchRoutePlansFromPython(start, end, 0.03)).slice(0, 3);
    if (plans.length < 2) throw new Error("Not enough simulation route options");

    let shortestRoute = plans[0];
    for (const p of plans) {
      if (p.totalDist < shortestRoute.totalDist) shortestRoute = p;
    }

    const shortestCoords = shortestRoute.coords || getRouteCoords(shortestRoute, start, end);
    const idx = Math.max(1, Math.min(shortestCoords.length - 2, Math.floor((shortestCoords.length - 1) * 0.56)));
    const congestionPoint = shortestCoords[idx];
    const simNow = Date.now();
    const incidents = [
      {
        id: "sim-congestion-1",
        routeId: shortestRoute.id,
        label: "Simulated congestion",
        lat: congestionPoint[0],
        lon: congestionPoint[1],
        delayMin: 12,
        severity: "High",
        color: "#ef4444",
        area: "SIM Corridor A",
        createdAt: new Date(simNow).toISOString(),
        message: "Two-vehicle rear-end collision ahead occupying one lane, causing queue spillback.",
        reason: "Rear-end collision is blocking a lane, reducing road capacity."
      },
      {
        id: "sim-roadwork-1",
        routeId: shortestRoute.id,
        label: "Simulated roadwork",
        lat: shortestCoords[Math.max(1, idx - 1)][0],
        lon: shortestCoords[Math.max(1, idx - 1)][1],
        delayMin: 4,
        severity: "Medium",
        color: "#a855f7",
        area: "SIM Corridor A",
        createdAt: new Date(simNow + 60 * 1000).toISOString(),
        message: "Road maintenance temporarily closes the slow lane; merge is required.",
        reason: "Road maintenance narrows lane width."
      },
      {
        id: "sim-breakdown-1",
        routeId: shortestRoute.id,
        label: "Simulated broken-down vehicle",
        lat: shortestCoords[Math.min(shortestCoords.length - 2, idx + 1)][0],
        lon: shortestCoords[Math.min(shortestCoords.length - 2, idx + 1)][1],
        delayMin: 6,
        severity: "Medium",
        color: "#f59e0b",
        area: "SIM Corridor A",
        createdAt: new Date(simNow + 2 * 60 * 1000).toISOString(),
        message: "Broken-down vehicle on shoulder intermittently affects mainline merge.",
        reason: "Broken-down vehicle causes bottleneck fluctuations."
      }
    ];

    const routeSummaries = plans.map((p) => {
      const ownIncidents = incidents.filter(i => i.routeId === p.id);
      const incidentDelay = ownIncidents.reduce((sum, x) => sum + x.delayMin, 0);
      const simulatedEtaMin = p.estMinutes + incidentDelay;
      return {
        id: p.id,
        label: p.label,
        color: p.color,
        coords: p.coords || getRouteCoords(p, start, end),
        distanceKm: p.totalDist / 1000,
        lights: p.trafficLights,
        baseEtaMin: p.estMinutes,
        incidentDelayMin: incidentDelay,
        simulatedEtaMin,
        incidents: ownIncidents
      };
    });

    routeSummaries.sort((a, b) => a.simulatedEtaMin - b.simulatedEtaMin);
    const fastestByTimeId = routeSummaries[0].id;
    const shortestByDistanceId = shortestRoute.id;

    return {
      start,
      end,
      routes: routeSummaries,
      incidents,
      generatedAt: new Date(simNow).toISOString(),
      notes: {
        shortestByDistanceId,
        fastestByTimeId
      }
    };
  }

  // 渲染管理员模拟结果卡片区（可点击切换高亮路线）
  function renderAdminSimulationStatus() {
    const statusEl = document.getElementById("admin-sim-status");
    if (!statusEl) return;
    statusEl.classList.toggle("hidden", !state.adminSimulationBusy);
    statusEl.textContent = "Running...";
  }

  function renderStandaloneSimulationInfo(sim) {
    const target = document.getElementById("admin-sim-results");
    const toggleBtn = document.getElementById("admin-toggle-sim-btn");
    renderAdminSimulationStatus();
    if (toggleBtn) toggleBtn.textContent = state.adminSimulationVisible ? "HIDE SIMULATION" : "GENERATE SIMULATION";
    if (!target) return;

    if (!state.adminSimulationVisible) {
      target.innerHTML = `<div class="admin-sim-card"><h4>Simulation Hidden</h4><p>Click "GENERATE SIMULATION" to display a standalone simulated route.</p></div>`;
      return;
    }

    if (!sim || !Array.isArray(sim.routes) || !sim.routes.length) {
      target.innerHTML = `<div class="admin-sim-card"><h4>No Simulation</h4><p>Unable to build simulation routes.</p></div>`;
      return;
    }

    const strategyName = (id) => {
      if (id === "fastest") return "Time-priority strategy";
      if (id === "fewerLights") return "Fewer-signals strategy";
      return "Balanced strategy";
    };

    target.innerHTML = sim.routes.map((r, idx) => {
      const tags = [];
      if (r.id === sim.notes.fastestByTimeId) tags.push("Fastest by time");
      if (r.id === sim.notes.shortestByDistanceId) tags.push("Shortest distance");
      if (!tags.length) tags.push("Alternative route");
      const incidentText = r.incidents.length
        ? r.incidents.map(i => `${i.label}(+${i.delayMin}m, ${formatIncidentTime(i.createdAt)}): ${i.reason}`).join(" · ")
        : "No major incidents";
      const selected = r.id === state.adminSimulationSelectedRouteId;
      return `
        <div class="admin-sim-card ${selected ? "selected" : ""}" data-sim-route-id="${r.id}">
          <h4>#${idx + 1} Simulated Route ${String.fromCharCode(65 + idx)}</h4>
          <p>Strategy: ${strategyName(r.id)}</p>
          <p>Status: ${tags.join(" / ")}</p>
          <p>Distance: ${r.distanceKm.toFixed(1)} km · Signals: ${r.lights}</p>
          <p>Base time: ${Math.round(r.baseEtaMin)} mins · Delay: +${Math.round(r.incidentDelayMin)} mins · Simulated total time: ${Math.round(r.simulatedEtaMin)} mins</p>
          <p>Incidents/Road status: ${incidentText}</p>
        </div>
      `;
    }).join("");

    target.querySelectorAll(".admin-sim-card[data-sim-route-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const rid = el.getAttribute("data-sim-route-id");
        state.adminSimulationSelectedRouteId = rid;
        drawStandaloneSimulation(state.adminSimulationData);
        renderStandaloneSimulationInfo(state.adminSimulationData);
        showSimulationRouteDetails(state.adminSimulationData, rid);
        renderAlertsPanels();
      });
    });
  }

  // 在地图绘制Simulated Route、模拟起终点与模拟事故点
  function drawStandaloneSimulation(sim) {
    if (!state.adminSimulationLayer || !state.plannerMap) return;
    state.adminSimulationLayer.clearLayers();
    if (!state.adminSimulationVisible) return;
    if (!sim || !Array.isArray(sim.routes)) return;

    const selectedId = state.adminSimulationSelectedRouteId || sim.notes.fastestByTimeId;

    sim.routes.forEach((r, idx) => {
      const isSelected = r.id === selectedId;
      L.polyline(r.coords, {
        color: r.color || (idx === 1 ? "#f59e0b" : "#22c55e"),
        weight: isSelected ? 7 : 3,
        opacity: isSelected ? 0.96 : 0.28,
        dashArray: isSelected ? null : "8 6"
      }).bindPopup(`${r.label}<br/>${Math.round(r.simulatedEtaMin)} mins`).addTo(state.adminSimulationLayer);
    });

    L.circleMarker([sim.start.lat, sim.start.lon], {
      radius: 8, fillColor: "#22c55e", color: "#fff", weight: 2, fillOpacity: 1
    }).bindPopup(sim.start.label).addTo(state.adminSimulationLayer);

    L.circleMarker([sim.end.lat, sim.end.lon], {
      radius: 8, fillColor: "#e94560", color: "#fff", weight: 2, fillOpacity: 1
    }).bindPopup(sim.end.label).addTo(state.adminSimulationLayer);

    const selectedRouteIncidents = (sim.incidents || []).filter(evt => evt.routeId === selectedId);
    selectedRouteIncidents.forEach((evt) => {
      L.circleMarker([evt.lat, evt.lon], {
        radius: 7, fillColor: evt.color, color: "#fff", weight: 2, fillOpacity: 0.95
      }).bindPopup(`${evt.label} · ${evt.severity} · +${evt.delayMin} mins`).addTo(state.adminSimulationLayer);
    });

    const allCoords = sim.routes.flatMap(r => r.coords || []);
    state.plannerMap.fitBounds(L.latLngBounds(allCoords.map(c => [c[0], c[1]])).pad(0.05));
  }

  // 管理员“生成/隐藏模拟路段”总开关
  async function toggleStandaloneSimulation() {
    if (!isAdmin()) return;
    state.adminSimulationVisible = !state.adminSimulationVisible;
    state.adminSimulationBusy = state.adminSimulationVisible;
    renderAdminSimulationStatus();
    try {
      const simulation = state.adminSimulationVisible ? await buildStandaloneSimulation() : null;
      state.adminSimulationData = simulation;
      state.adminSimulationSelectedRouteId = simulation?.notes?.fastestByTimeId || null;
      state.adminSimulationBusy = false;
      drawStandaloneSimulation(state.adminSimulationData);
      renderStandaloneSimulationInfo(state.adminSimulationData);
      if (state.adminSimulationVisible && state.adminSimulationData) {
        showSimulationRouteDetails(state.adminSimulationData, state.adminSimulationSelectedRouteId);
      } else {
        const normalRoute = state.routePlans.find(r => r.id === state.selectedRouteId) || state.routePlans[0];
        if (normalRoute) showRouteDetails(normalRoute);
      }
      renderAlertsPanels();
    } catch (err) {
      state.adminSimulationBusy = false;
      state.adminSimulationVisible = false;
      state.adminSimulationData = null;
      state.adminSimulationSelectedRouteId = null;
      drawStandaloneSimulation(state.adminSimulationData);
      const target = document.getElementById("admin-sim-results");
      if (target) target.innerHTML = `<div class="admin-sim-card"><h4>Simulation Error</h4><p>${err.message}</p></div>`;
      renderAlertsPanels();
    }
  }

  // 普通路径规划主流程：
  // 1) 输入解析与地理编码
  // 2) 调后端 Python 生成 3 条路线
  // 3) 叠加事件评估并决定“当前最快”
  // 4) 刷新地图、路线卡片、详情与 Alerts
  async function calculateRoutes() {
    const btn = document.getElementById("route-calculate-btn");
    const hintEl = document.getElementById("route-planning-hint");
    const startInput = document.getElementById("route-start-postal");
    const endInput = document.getElementById("route-end-postal");
    const startQuery = (startInput?.value || "").trim();
    const endQuery = (endInput?.value || "").trim();

    if (!startQuery || !endQuery) {
      alert("Please enter start and destination (postal code or location name).");
      return;
    }

    if (btn) btn.disabled = true;
    const startedAt = Date.now();
    let waitSeconds = 0;
    let waitTimer = null;
    if (hintEl) {
      hintEl.textContent = `Planning route, estimated 10-20 seconds. You have waited ${waitSeconds} seconds.`;
      waitTimer = setInterval(() => {
        waitSeconds += 1;
        hintEl.textContent = `Planning route, estimated 10-20 seconds. You have waited ${waitSeconds} seconds.`;
      }, 1000);
    }
    try {
      const startGeoPromise = state.routeStartCurrentGeo && startQuery === "Current Location"
        ? Promise.resolve({ ...state.routeStartCurrentGeo, display: "Current Location" })
        : geocodeLocation(startQuery);
      const [userLoc, startGeo, endGeo] = await Promise.all([getUserLocation(), startGeoPromise, geocodeLocation(endQuery)]);
      const plans = await fetchRoutePlansFromPython(startGeo, endGeo, 0.03);
      if (!plans.length) throw new Error("No valid route plan generated.");

      const realtimeCameras = state.cameras.filter(c => c.hasRealtimeImage);
      const liveRouteEvents = mapLiveIncidentsToRouteEvents(state.dashboardIncidents);
      const defaultRoute = plans.find(r => r.id === "fastest") || plans[0];
      const baseCoords = getRouteCoords(defaultRoute, startGeo, endGeo);
      const relevantEvents = await analyzeEventsViaBackend(liveRouteEvents, userLoc, baseCoords);
      const eventsWithCameras = attachEventCameras(relevantEvents, realtimeCameras);
      const evaluation = await evaluateRoutesByEventsViaBackend(plans, eventsWithCameras);
      const currentFastestId = evaluation.currentFastestId || deriveCurrentFastestId(plans, evaluation) || plans[0].id;

      state.routePlans = plans;
      state.routeContext = {
        userLoc,
        events: eventsWithCameras,
        evaluation,
        startGeo,
        endGeo,
        currentFastestId,
        generatedAt: new Date().toISOString()
      };
      state.selectedRouteId = evaluation.recommendedRouteId || plans[0].id;
      clearConfirmedRouteTracking();

      drawRoutes(startGeo, endGeo);
      applyRoutePreferenceSelection();
      renderRouteCards();
      showRouteDetails(state.routePlans.find(r => r.id === state.selectedRouteId));
      if (state.adminSimulationVisible && state.adminSimulationData) {
        showSimulationRouteDetails(state.adminSimulationData, state.adminSimulationSelectedRouteId);
      }
      renderAlertsPanels();
      const elapsedSeconds = Math.max(waitSeconds, Math.ceil((Date.now() - startedAt) / 1000));
      if (hintEl) hintEl.textContent = `Route planning completed. You waited ${elapsedSeconds} seconds. 3 routes are sorted by ETA.`;
    } catch (err) {
      alert(`Route calculation failed: ${err.message}`);
      const elapsedSeconds = Math.max(waitSeconds, Math.ceil((Date.now() - startedAt) / 1000));
      if (hintEl) hintEl.textContent = `Route planning failed after ${elapsedSeconds} seconds: ${err.message}`;
    } finally {
      if (waitTimer) clearInterval(waitTimer);
      if (btn) btn.disabled = false;
    }
  }

  // 统一绑定所有页面事件：按钮、tab、hash、列表项、dismiss 等
  function bindActions() {
    const calcBtn = document.getElementById("route-calculate-btn");
    if (calcBtn) calcBtn.addEventListener("click", calculateRoutes);

    const preferenceBtn = document.getElementById("route-preference-btn");
    if (preferenceBtn) {
      preferenceBtn.addEventListener("click", cycleRoutePreference);
    }

    const cancelBtn = document.getElementById("route-cancel-btn");
    if (cancelBtn) cancelBtn.addEventListener("click", clearCurrentRoutePlan);

    const confirmBtn = document.getElementById("route-confirm-btn");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", () => {
        confirmSelectedRouteUsage().catch((err) => {
          alert(`Failed to start navigation: ${err.message}`);
        });
      });
    }

    const startInput = document.getElementById("route-start-postal");
    const startSuggestions = document.getElementById("route-start-suggestions");
    const currentLocationOption = document.getElementById("route-start-current-option");
    if (startInput) {
      const maybeShowSuggestions = () => {
        const value = startInput.value.trim().toLowerCase();
        toggleRouteStartSuggestions(!value || "current location".includes(value));
      };
      startInput.addEventListener("focus", maybeShowSuggestions);
      startInput.addEventListener("click", maybeShowSuggestions);
      startInput.addEventListener("input", () => {
        if (startInput.value.trim() !== "Current Location") {
          state.routeStartCurrentGeo = null;
        }
        maybeShowSuggestions();
      });
      startInput.addEventListener("blur", () => {
        setTimeout(() => toggleRouteStartSuggestions(false), 120);
      });
    }
    if (currentLocationOption) {
      currentLocationOption.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      currentLocationOption.addEventListener("click", async () => {
        await useCurrentLocationAsRouteStart();
        toggleRouteStartSuggestions(false);
      });
    }
    document.addEventListener("click", (e) => {
      if (startSuggestions && startInput) {
        const inStartPicker = startSuggestions.contains(e.target) || startInput.contains(e.target);
        if (!inStartPicker) toggleRouteStartSuggestions(false);
      }
    });

    const viewCameraBtn = document.getElementById("route-view-cameras-btn");
    if (viewCameraBtn) {
      renderRouteCameraToggleButton();
      viewCameraBtn.addEventListener("click", () => {
        toggleRouteNearestLiveCamera();
      });
    }

    const simToggleBtn = document.getElementById("admin-toggle-sim-btn");
    if (simToggleBtn) simToggleBtn.addEventListener("click", toggleStandaloneSimulation);
    const adminUsersRefreshBtn = document.getElementById("admin-users-refresh-btn");
    if (adminUsersRefreshBtn) {
      adminUsersRefreshBtn.addEventListener("click", async () => {
        await renderAdminUsersPanel();
        await renderAdminFeedbackPanel();
      });
    }
    const feedbackTimeFilter = document.getElementById("admin-feedback-time-filter");
    const feedbackSeverityFilter = document.getElementById("admin-feedback-severity-filter");
    if (feedbackTimeFilter) {
      feedbackTimeFilter.addEventListener("change", () => {
        state.adminFeedbackFilters.timeRange = feedbackTimeFilter.value || "all";
        applyAdminFeedbackFilters();
      });
    }
    if (feedbackSeverityFilter) {
      feedbackSeverityFilter.addEventListener("change", () => {
        state.adminFeedbackFilters.severity = feedbackSeverityFilter.value || "all";
        applyAdminFeedbackFilters();
      });
    }
    const incidentSortBtn = document.getElementById("incident-sort-btn");
    if (incidentSortBtn) {
      incidentSortBtn.addEventListener("click", () => {
        state.incidentSortMode = state.incidentSortMode === "time" ? "severity" : "time";
        renderIncidentSortButton();
        renderIncidentUpdatesList();
      });
    }
    const dashboardUpdatesList = document.getElementById("dashboard-updates-list");
    if (dashboardUpdatesList) {
      dashboardUpdatesList.addEventListener("click", (event) => {
        const row = event.target.closest(".dashboard-update-item");
        if (!row) return;
        const incidentId = row.getAttribute("data-incident-id");
        highlightDashboardEvidenceCard(incidentId);
      });
    }
    const mapIncidentToggleBtn = document.getElementById("map-toggle-incidents-btn");
    if (mapIncidentToggleBtn) {
      mapIncidentToggleBtn.addEventListener("click", async () => {
        mapIncidentToggleBtn.disabled = true;
        try {
          await toggleMapIncidentsLayer();
        } catch (err) {
          alert(`Load LTA incidents failed: ${err.message}`);
        } finally {
          mapIncidentToggleBtn.disabled = false;
        }
      });
    }
    const mapErpToggleBtn = document.getElementById("map-toggle-erp-btn");
    if (mapErpToggleBtn) {
      mapErpToggleBtn.addEventListener("click", async () => {
        mapErpToggleBtn.disabled = true;
        try {
          await toggleMapErpLayer();
        } catch (err) {
          alert(`Load ERP markers failed: ${err.message}`);
        } finally {
          mapErpToggleBtn.disabled = false;
        }
      });
    }
    const mapPgsToggleBtn = document.getElementById("map-toggle-pgs-btn");
    if (mapPgsToggleBtn) {
      mapPgsToggleBtn.addEventListener("click", async () => {
        mapPgsToggleBtn.disabled = true;
        try {
          await toggleMapPgsLayer();
        } catch (err) {
          alert(`Load PGS markers failed: ${err.message}`);
        } finally {
          mapPgsToggleBtn.disabled = false;
        }
      });
    }
    const mapCameraToggleBtn = document.getElementById("map-toggle-cameras-btn");
    if (mapCameraToggleBtn) {
      mapCameraToggleBtn.addEventListener("click", () => {
        toggleMapCamerasVisibility();
      });
    }
    const mapFeedbackToggleBtn = document.getElementById("map-toggle-feedback-btn");
    if (mapFeedbackToggleBtn) {
      mapFeedbackToggleBtn.addEventListener("click", async () => {
        mapFeedbackToggleBtn.disabled = true;
        try {
          await toggleAdminFeedbackLayer();
        } catch (err) {
          alert(`Load feedback markers failed: ${err.message}`);
        } finally {
          mapFeedbackToggleBtn.disabled = false;
        }
      });
    }
    const routeFavoritesBtn = document.getElementById("route-toggle-favorites-btn");
    if (routeFavoritesBtn) {
      routeFavoritesBtn.addEventListener("click", () => {
        toggleRouteFavoritesPanel();
      });
    }
    const incidentSourceBtn = document.getElementById("admin-incident-source-btn");
    if (incidentSourceBtn) {
      incidentSourceBtn.addEventListener("click", async () => {
        if (!isAdmin()) return;
        state.incidentDataSource = state.incidentDataSource === "live" ? "mock" : "live";
        renderIncidentSourceButton();
        try {
          await refreshDashboardIncidents();
        } catch (err) {
          console.error(err);
          alert(`Failed to switch incident data source: ${err.message}`);
        }
      });
    }
    // Habit Route buttons
    const habitRefreshBtn = document.getElementById("habit-routes-refresh-btn");
    if (habitRefreshBtn) {
      habitRefreshBtn.addEventListener("click", async () => {
        await loadHabitRoutesFromServer();
        if (state.habitRoutesMap) {
          setTimeout(() => state.habitRoutesMap.invalidateSize(), 40);
        }
      });
    }

    const habitClearBtn = document.getElementById("habit-routes-clear-map-btn");
    if (habitClearBtn) {
      habitClearBtn.addEventListener("click", () => {
        if (state.habitRoutePolylineLayer) state.habitRoutePolylineLayer.clearLayers();
      });
    }

    const alertBackBtn = document.getElementById("alert-detail-back-btn");
    if (alertBackBtn) {
      alertBackBtn.addEventListener("click", () => {
        window.location.hash = "alerts";
      });
    }

    document.addEventListener("click", (e) => {
      const detailBtn = e.target.closest(".alert-view-detail-btn");
      if (detailBtn) {
        const incidentId = detailBtn.getAttribute("data-incident-id");
        state.selectedAlertIncidentId = incidentId;
        window.location.hash = "alert-detail";
        renderAlertDetailPage();
        return;
      }
      const dismissBtn = e.target.closest(".alert-dismiss-btn");
      if (dismissBtn) {
        const incidentId = dismissBtn.getAttribute("data-incident-id");
        state.alertDismissedIds.add(String(incidentId || ""));
        renderAlertsPanels();
      }
    });

    window.addEventListener("hashchange", () => {
      const page = (window.location.hash || "#home").slice(1);
      if (page === "alerts") {
        renderAlertsPanels();
        refreshAlertsInfoFeed();
      }
      if (page === "admin-users" && isAdmin()) {
        renderAdminUsersPanel();
        renderAdminFeedbackPanel();
      }
      if (page === "alert-detail") {
        if (!state.selectedAlertIncidentId && state.dashboardIncidents.length) {
          state.selectedAlertIncidentId = String(state.dashboardIncidents[0].id || "");
        }
        renderAlertDetailPage();
      }
    });

    const tabs = document.querySelectorAll(".nav-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        if (tab.getAttribute("data-page") === "alerts") {
          renderAlertsPanels();
          refreshAlertsInfoFeed();
        }
        if (tab.getAttribute("data-page") === "admin-users" && isAdmin()) {
          renderAdminUsersPanel();
          renderAdminFeedbackPanel();
        }
        if (tab.getAttribute("data-page") === "habit-routes") {
          loadHabitRoutesFromServer().catch((err) => {
            console.error("Failed to load habit routes:", err);
          });
        }
        setTimeout(() => {
          if (state.liveMap) state.liveMap.invalidateSize();
          if (state.plannerMap) state.plannerMap.invalidateSize();
          // Added Habit Route Map invalidate
          if (state.habitRoutesMap) state.habitRoutesMap.invalidateSize(); 
        }, 40);
      });
    });
  }

  // 页面启动入口：初始化地图、拉取基础数据、按当前 hash 渲染目标页面
  async function bootstrapDemo() {
    if (!window.L) return;
    ensureMaps();
    bindActions();

    try {
      const panel = document.getElementById("admin-sim-panel");
      if (panel) panel.classList.toggle("hidden", !isAdmin());
      if (isAdmin()) await loadAdminSimulationConfig();
      renderIncidentSourceButton();
      renderMapCameraToggleButton();
      renderMapIncidentToggleButton();
      renderMapErpToggleButton();
      renderMapPgsToggleButton();
      renderMapFeedbackToggleButton();
      renderRoutePreferenceButton();
      renderRouteFavoritesToggleButton();
      renderRouteFavoritesPanel();
      state.cameras = await fetchCameras();
      updateDashboardStats();
      try {
        await refreshDashboardIncidents();
      } catch (incErr) {
        console.error(incErr);
        state.dashboardIncidents = [];
        renderAlertsPanels();
        renderDashboardEvidence();
      }
      await renderAdminUsersPanel();
      await renderAdminFeedbackPanel();
      renderLiveMapAndList();
      if (state.mapIncidentsVisible) drawLiveIncidentMarkers(state.mapLiveIncidents);
      if (state.mapErpVisible) drawErpMarkers();
      if (state.mapPgsVisible) drawPgsMarkers();
      if (state.adminFeedbackVisible) drawAdminFeedbackMarkers();
      await loadHabitRoutesFromServer();
      checkTrafficAlerts();
      if (isAdmin()) renderStandaloneSimulationInfo(null);
      const currentPage = (window.location.hash || "#home").slice(1);
      if (currentPage === "alerts") renderAlertsPanels();
      if (currentPage === "alerts") refreshAlertsInfoFeed();
      if (currentPage === "admin-users" && isAdmin()) {
        await renderAdminUsersPanel();
        await renderAdminFeedbackPanel();
      }
      if (currentPage === "alert-detail") {
        if (!state.selectedAlertIncidentId && state.dashboardIncidents.length) {
          state.selectedAlertIncidentId = String(state.dashboardIncidents[0].id || "");
        }
        renderAlertDetailPage();
      }
      // FOR TRAFFIC ALERTS. Call FastAPI to check traffic alerts every 60s
      setInterval(checkTrafficAlerts, 60000); 

      // Handle the alerts dropdown toggle to view alerts
      const alertsToggle = document.getElementById("alerts-toggle");
      if (alertsToggle) {
        alertsToggle.addEventListener("click", (e) => {
          e.stopPropagation();
          document.getElementById("alerts-nav-dropdown").classList.toggle("hidden");
        });
      }

      setTimeout(() => {
        if (state.liveMap) state.liveMap.invalidateSize();
        if (state.plannerMap) state.plannerMap.invalidateSize();
      }, 80);
    } catch (err) {
      console.error(err);
    }
  }

  // 登录态变化后的全局重同步：管理员区块、事故源、模拟状态、告警联动全部刷新
  window.addEventListener("fast-auth-changed", async () => {
    const panel = document.getElementById("admin-sim-panel");
    if (panel) panel.classList.toggle("hidden", !isAdmin());
    const simResults = document.getElementById("admin-sim-results");
    const usersPanel = document.getElementById("admin-users-panel");
    if (usersPanel) usersPanel.classList.toggle("hidden", !isAdmin());
    if (!isAdmin()) state.incidentDataSource = "live";
    renderIncidentSourceButton();
    renderMapFeedbackToggleButton();
    if (!window.getFastAuth || !window.getFastAuth()) {
      state.favoritePlannerPanelVisible = false;
    }
    updateGuestFeatureVisibility();
    renderRouteFavoritesToggleButton();
    renderRouteFavoritesPanel();
    if (isAdmin()) {
      await loadAdminSimulationConfig();
      await renderAdminUsersPanel();
      await renderAdminFeedbackPanel();
      state.adminSimulationData = null;
      state.adminSimulationSelectedRouteId = null;
      renderStandaloneSimulationInfo(state.adminSimulationData);
    } else {
      state.adminSimulationConfig = null;
      state.adminSimulationVisible = false;
      state.adminSimulationData = null;
      state.adminSimulationSelectedRouteId = null;
      state.adminFeedbackVisible = false;
      state.adminFeedbackItems = [];
      if (state.adminFeedbackMapLayer) state.adminFeedbackMapLayer.clearLayers();
      if (state.adminSimulationLayer) state.adminSimulationLayer.clearLayers();
      if (simResults) simResults.innerHTML = "";
    }
    try {
      await refreshDashboardIncidents();
    } catch (err) {
      console.error(err);
    }
    renderAlertsPanels();
    refreshAlertsInfoFeed();
  });

  window.addEventListener("fast-settings-changed", async () => {
    renderRouteFavoritesPanel();
  });

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



  // Habit Routes section for JR.
  // 现在统一改为走当前 demo 自己的登录态和 Node.js 后端，
  // 不再依赖单独的 Supabase Auth / 外部 FastAPI。

  
  async function loadHabitRoutesFromServer() {
    const auth = window.getFastAuth ? window.getFastAuth() : null;
    if (!auth || !auth.token) {
      state.habitSavedRoutes = [];
      renderHabitRoutesList();
      return;
    }

    const res = await window.fastAuthFetch("/api/habit-routes");
    const data = await res.json();

    if (!res.ok) {
      console.error("Habit routes load failed:", data);
      state.habitSavedRoutes = [];
      renderHabitRoutesList();
      return;
    }

    // Load all the required data and render
    state.habitSavedRoutes = (data.routes || []).map((r) => ({
      id: r.id,
      from: r.from_label || "Unknown start",
      to: r.to_label || "Unknown destination",
      coords: r.coords_json || [],
      distance_m: r.distance_m || 0,
      link_ids: r.link_ids || [],
      alert_enabled: r.alert_enabled,
      alert_start_time: r.alert_start_time,
      alert_end_time: r.alert_end_time,
      route_name: r.route_name || ""
    }));

    renderHabitRoutesList();
  }

  // Render the data
  // Should load the list of saved habit routes, display the relevant details 
  // and put action buttons for each row
  function renderHabitRoutesList() {
    const container = document.getElementById("habit-routes-list");
    if (!container) return;

    if (!state.habitSavedRoutes.length) {
      container.innerHTML = `<div class="habit-route-card">No saved habit routes yet.</div>`;
      return;
    }

    container.innerHTML = "";

    state.habitSavedRoutes.forEach((route, i) => {
      const card = document.createElement("div");
      card.className = "habit-route-card";

      const routeDisplayName = route.route_name || "My Route";
      const directions = `${escapeHtml(route.from)} → ${escapeHtml(route.to)}`;

      // Update the list to enable users to update name of their route
      card.innerHTML = `
      <div style="padding: 16px; position: relative;">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 4px;">
            <div style="flex: 1; padding-right: 10px;">
                <div class="habit-route-title" id="title-${route.id}" style="font-weight: 700; font-size: 16px; color: #1e293b; line-height: 1.2;">
                    ${escapeHtml(route.route_name || "My Route")}
                </div>
                <div style="font-size: 12px; color: #64748b; line-height: 1.4; margin-top: 4px;">
                    ${escapeHtml(route.from)} → ${escapeHtml(route.to)}
                </div>
            </div>
            <button type="button" class="btn-rename-edit" style="border:none; background:none; color:#94a3b8; cursor:pointer; padding-left:8px;">
              ✎
            </button>
        </div>

        <div class="habit-rename-group hidden mb-3 p-2 bg-light rounded" id="rename-group-${route.id}">
            <input type="text" class="form-control form-control-sm mb-2 habit-new-name-input" value="${escapeHtml(route.route_name || "")}">
            <button class="btn btn-sm btn-primary habit-confirm-rename">Save</button>
            <button class="btn btn-sm btn-link habit-cancel-rename text-muted">Cancel</button>
        </div>

        <div style="font-size: 12px; color: #94a3b8; margin-bottom: 12px;">${(Number(route.distance_m || 0) / 1000).toFixed(1)} km</div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
            <button class="btn btn-sm btn-outline-primary habit-load-btn" style="font-weight: 600; font-size: 11px; padding: 6px 0;">LOAD</button>
            <button class="btn btn-sm btn-outline-secondary habit-alerts-btn" style="font-weight: 600; font-size: 11px; padding: 6px 0;">ALERTS</button>
            <button class="btn btn-sm btn-outline-danger habit-delete-btn" style="font-weight: 600; font-size: 11px; padding: 6px 0;">DELETE</button>
        </div>

        <div class="habit-route-settings hidden mt-3 p-3" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; box-sizing: border-box; width: 100%; overflow: hidden;">
            <label style="font-size: 12px; display: block; margin-bottom: 8px; font-weight: 600; color: #475569;">
                <input type="checkbox" class="habit-alert-toggle" ${route.alert_enabled ? "checked" : ""}> Monitor Traffic
            </label>
            
            <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 12px; color: #64748b; margin-bottom: 12px; width: 100%;">
                <span>Window:</span>
                <input type="time" class="habit-alert-start" style="flex: 1; min-width: 70px; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px;" value="${route.alert_start_time || "07:30"}">
                <span>to</span>
                <input type="time" class="habit-alert-end" style="flex: 1; min-width: 70px; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px;" value="${route.alert_end_time || "09:00"}">
            </div>
            
            <button type="button" class="btn btn-dark habit-save-settings-btn w-100" style="font-size: 11px; font-weight: 700; padding: 8px; box-sizing: border-box;">SAVE SETTINGS</button>
        </div>
      </div>
    `;
      const renameGroup = card.querySelector(`#rename-group-${route.id}`);
      const titleEl = card.querySelector(`#title-${route.id}`);

      card.querySelector(".btn-rename-edit").onclick = () => renameGroup.classList.remove("hidden");
      card.querySelector(".habit-cancel-rename").onclick = () => renameGroup.classList.add("hidden");

      // send the patch request
      card.querySelector(".habit-confirm-rename").onclick = async () => {
        const newName = card.querySelector(".habit-new-name-input").value.trim();
        if (!newName) return;

        const res = await window.fastAuthFetch(`/api/habit-routes/${route.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ route_name: newName })
        });

        if (res.ok) {
          titleEl.innerText = newName;
          renameGroup.classList.add("hidden");
          route.route_name = newName; 
        } else {
          alert("Failed to rename route.");
        }
      };
      // Handle save, update alerts and delete button
      const settingsPanel = card.querySelector(".habit-route-settings");

      card.querySelector(".habit-load-btn").addEventListener("click", async () => {
        await drawHabitRouteOnMap(route);
      });

      card.querySelector(".habit-alerts-btn").addEventListener("click", () => {
        settingsPanel.classList.toggle("hidden");
      });

      card.querySelector(".habit-save-settings-btn").addEventListener("click", async () => {
        await saveHabitRouteSettings(route.id, card);
      });

      card.querySelector(".habit-delete-btn").addEventListener("click", async () => {
        await deleteHabitRoute(route.id);
      });

      container.appendChild(card);
    });
  }

  // Load route to map
  async function drawHabitRouteOnMap(route) {
    if (!state.habitRoutesMap || !state.habitRoutePolylineLayer) return;
    if (!route || !Array.isArray(route.coords) || route.coords.length < 2) return;
    
    const res = await window.fastAuthFetch("/api/habit-routes/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        coords_json: route.coords
      })
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Habit route analyze failed:", data);
      alert("Failed to load saved route.");
      return;
    }

    state.habitRoutePolylineLayer.clearLayers();

    
    const coords = data.coords || route.coords;
    const matchInfo = data.match_info || {};
    const segmentMatches = matchInfo.segment_matches || [];
    const segments = [];
    for (let j = 0; j < coords.length - 1; j += 1) {
      const matchData = segmentMatches[j];

      if (matchData) {
        const lineColor = matchData.color || "#3b82f6";
        const trafficStatus = matchData.traffic_status || "Collecting Data...";
        const currentBand = matchData.current_band || "N/A";
        const predBand = matchData.pred_band;

        const line = L.polyline([coords[j], coords[j + 1]], {
          color: lineColor,
          weight: 7,
          opacity: 1
        });

        line.bindPopup(`
          <div style="font-size:12px;max-width:260px;">
            <strong>${escapeHtml(matchData.road_name || "LTA Road")}</strong><br/>
            <b>Link ID:</b> ${escapeHtml(matchData.link_id || "")}<br/>
            <b>Distance to incident:</b> ${escapeHtml(matchData.distance_m ?? "N/A")} m<br/>
            <b>Current Band:</b> ${escapeHtml(currentBand)}<br/>
            <b>Predicted Band:</b> ${escapeHtml(predBand ?? "N/A")} (${escapeHtml(trafficStatus)})
          </div>
        `);

        line.addTo(state.habitRoutePolylineLayer);
        segments.push(line);
      } else {
        const line = L.polyline([coords[j], coords[j + 1]], {
          color: "#94a3b8",
          weight: 4,
          opacity: 0.6,
          dashArray: "5, 10"
        });
        line.addTo(state.habitRoutePolylineLayer);
        segments.push(line);
      }
    }

    if (segments.length) {
      const fg = L.featureGroup(segments);
      state.habitRoutesMap.fitBounds(fg.getBounds(), { padding: [40, 40] });
    }
  }

  // Update Habit Route settings
  async function saveHabitRouteSettings(routeId, card) {
    const alert_enabled = card.querySelector(".habit-alert-toggle").checked;
    const alert_start_time = card.querySelector(".habit-alert-start").value;
    const alert_end_time = card.querySelector(".habit-alert-end").value;

    const res = await window.fastAuthFetch(`/api/habit-routes/${routeId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        alert_enabled,
        alert_start_time,
        alert_end_time
      })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error("Habit route settings update failed:", data);
      alert("Failed to save route settings.");
      return;
    }

    await loadHabitRoutesFromServer();

  }

  // Delete Habit Route
  async function deleteHabitRoute(routeId) {
    const res = await window.fastAuthFetch(`/api/habit-routes/${routeId}`, {
      method: "DELETE",
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error("Habit route delete failed:", data);
      alert("Failed to delete habit route.");
      return;
    }

    await loadHabitRoutesFromServer();
    if (state.habitRoutePolylineLayer) state.habitRoutePolylineLayer.clearLayers();
  }

  // Save to Habit Routes
  async function saveRouteAsHabit(routeObj, btn) {
    const auth = window.getFastAuth ? window.getFastAuth() : null;
    if (!auth || !auth.token) {
      alert("Please log in first.");
      return;
    }

    // Modify button to showed that it has been clicked
    const originalText = btn.innerHTML;
    btn.innerHTML = "Saving..."; 
    btn.style.pointerEvents = "none";

    // Create a default name first, to design a name input panel later
    const startInput = document.getElementById("route-start-postal")?.value || "Start";
    const endInput = document.getElementById("route-end-postal")?.value || "Destination";
    
    const autoName = `${startInput} → ${endInput}`;
    let savedOk = false;

    try {
      const analyzeRes = await window.fastAuthFetch("/api/habit-routes/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ coords_json: routeObj.coords })
      });
      const analysis = await analyzeRes.json();
      
      if (!analyzeRes.ok) throw new Error("Link analysis failed");

      const saveRes = await window.fastAuthFetch("/api/habit-routes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          route_name: autoName, 
          from_label: startInput,
          to_label: endInput,
          coords_json: routeObj.coords,
          distance_m: routeObj.totalDist,
          link_ids: analysis.match_info.matched_links.map(l => l.link_id)
        })
      });

      if (saveRes.ok) {
        savedOk = true;
        // Update button to show that route was saved successfully
        btn.innerHTML = "✓";
        btn.style.background = "#10b981";
        btn.style.color = "white";
        btn.style.borderColor = "#10b981";
        loadHabitRoutesFromServer();

        // Revert back button
        setTimeout(() => {
          btn.innerHTML = originalText;
          btn.style = "";
        }, 3000);
      }
    } catch (err) {
      console.error(err);
      alert("System error while saving.");
    } finally {
      btn.style.pointerEvents = "";
      if (!savedOk) {
        btn.innerHTML = originalText;
      }
    }
  }

  // ALERTS section
  async function checkTrafficAlerts() {

    if (!state.habitSavedRoutes || state.habitSavedRoutes.length === 0) {
      // If routes aren't loaded yet, try to load them once
      await loadHabitRoutesFromServer(); 
    }
    const auth = window.getFastAuth ? window.getFastAuth() : null;
    const badge = document.getElementById("nav-alert-badge");
    const list = document.getElementById("nav-alerts-list");
    if (!auth || !auth.token) {
      if (badge) badge.classList.add("hidden");
      if (list) list.innerHTML = `<li class="no-alerts" style="padding:15px; color:#94a3b8; font-size:12px;">Log in to monitor your habit routes.</li>`;
      return;
    }

    try {
        const res = await window.fastAuthFetch("/api/my-alerts");
        const alerts = await res.json();

        if (alerts && alerts.length > 0) {
            badge.innerText = alerts.length;
            badge.classList.remove("hidden");
            
            // Populate the dropdown list from alerts navbar
            list.innerHTML = "";
            alerts.forEach(alert => {
                // Lookup the route name from your state cache
                const routeInfo = state.habitSavedRoutes.find(r => r.id === alert.route_id);
                const routeDisplayName = routeInfo ? (routeInfo.route_name || routeInfo.from) : `ID: ${alert.route_id}`;

                list.innerHTML += `
                    <li class="nav-alert-item-wrap">
                        <div class="nav-alert-card">
                            <div class="nav-alert-title">Traffic Alert!</div>
                            <div class="nav-alert-text">Route <strong>${escapeHtml(routeDisplayName)}</strong> is facing delays near ${escapeHtml(alert.area || "the route")}.</div>
                            <button type="button" class="btn-dismiss-alert" data-route-id="${escapeHtml(alert.route_id)}" data-alert-id="${escapeHtml(alert.id)}">Dismiss</button>
                        </div>
                    </li>
                `;
            });
            list.querySelectorAll(".btn-dismiss-alert").forEach((btn) => {
              btn.addEventListener("click", async () => {
                const routeId = btn.getAttribute("data-route-id");
                const alertId = btn.getAttribute("data-alert-id");
                await dismissHabitAlert(routeId, alertId, btn);
              });
            });
        } else {
            badge.classList.add("hidden");
            list.innerHTML = `<li class="no-alerts" style="padding:15px; color:#94a3b8; font-size:12px;">No active traffic jams.</li>`;
        }
    } catch (err) {
        console.error("Alert check failed:", err);
    }
  }

  async function dismissHabitAlert(routeId, alertId, btn) {
    try {
      const res = await window.fastAuthFetch("/api/my-alerts/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeId: Number(routeId), alertId: Number(alertId) })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Dismiss failed");
      const item = btn && btn.closest(".nav-alert-item-wrap");
      if (item) item.remove();
      await checkTrafficAlerts();
    } catch (err) {
      alert(`Dismiss alert failed: ${err.message}`);
    }
  }

    



  // 模块真实启动点
  document.addEventListener("DOMContentLoaded", bootstrapDemo);
})();
