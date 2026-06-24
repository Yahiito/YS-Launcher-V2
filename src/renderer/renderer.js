const state = {
  config: null,
  news: [],
  instances: [],
  accounts: [],
  selectedAccountId: null,
  selectedInstance: null,
  settings: {},
  warnings: [],
  systemMemoryMaxGb: 4,
  webBaseUrl: "",
  launcherBaseUrl: ""
};

const AUTO_REFRESH_INTERVAL_MS = 15000;

const els = {
  app: document.getElementById("app"),
  content: document.querySelector(".content"),
  loadingView: document.querySelector(".loading-view"),
  loginView: document.querySelector(".login-view"),
  launcherView: document.querySelector(".launcher-view"),
  authMessage: document.getElementById("auth-message"),
  loginForm: document.getElementById("login-form"),
  registerForm: document.getElementById("register-form"),
  profileName: document.getElementById("profile-name"),
  profileHead: document.getElementById("profile-head"),
  instanceSelect: document.getElementById("instance-select"),
  serverName: document.getElementById("server-name"),
  serverStatus: document.getElementById("server-status"),
  players: document.getElementById("players"),
  newsList: document.getElementById("news-list"),
  play: document.getElementById("play"),
  launchState: document.getElementById("launch-state"),
  launchMessage: document.getElementById("launch-message"),
  launchProgress: document.getElementById("launch-progress"),
  launchLog: document.getElementById("launch-log"),
  updateStatus: document.getElementById("update-status"),
  accountsList: document.getElementById("accounts-list"),
  warningBox: document.getElementById("warning-box"),
  settingsMessage: document.getElementById("settings-message"),
  skinViewer: document.getElementById("skin-viewer"),
  skinAccountName: document.getElementById("skin-account-name"),
  skinFilename: document.getElementById("skin-filename"),
  skinMessage: document.getElementById("skin-message")
};

let skinViewerInstance = null;
let skinRenderRequest = 0;
let refreshInProgress = false;

function selectedAccount() {
  return state.accounts.find((account) => account.ID === state.selectedAccountId) || state.accounts[0] || null;
}

function selectedInstance() {
  return state.instances.find((instance) => instance.name === state.selectedInstance) || state.instances[0] || null;
}

function backgroundUrlFor(instance) {
  return instance?.background || instance?.background_image || "";
}

function applyInstanceBackground() {
  const backgroundUrl = backgroundUrlFor(selectedInstance());
  if (!backgroundUrl) {
    els.content.style.removeProperty("--instance-background-image");
    els.content.classList.remove("has-instance-background");
    return;
  }

  const escapedUrl = String(backgroundUrl).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  els.content.style.setProperty("--instance-background-image", `url("${escapedUrl}")`);
  els.content.classList.add("has-instance-background");
}

function showMode(mode) {
  els.loadingView.classList.toggle("hidden", mode !== "loading");
  els.loginView.classList.toggle("hidden", mode !== "login");
  els.launcherView.classList.toggle("hidden", mode !== "launcher");
}

function setMessage(element, message, error = false) {
  element.textContent = message || "";
  element.style.color = error ? "var(--danger)" : "var(--muted)";
}

function memoryLimitGb() {
  return Math.max(1, Number(state.systemMemoryMaxGb) || 4);
}

function clampMemoryValue(value, fallback = 1) {
  const parsed = Number(value);
  const safeValue = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(memoryLimitGb(), Math.max(1, safeValue));
}

function renderProfile() {
  const account = selectedAccount();
  if (!account) {
    els.profileName.textContent = "Aucun compte";
    els.profileHead.style.backgroundImage = "";
    els.profileHead.style.backgroundSize = "";
    els.profileHead.style.backgroundPosition = "";
    els.profileHead.style.backgroundRepeat = "";
    return;
  }
  els.profileName.textContent = account.name;
  const skinUrl = skinUrlFor(account);
  els.profileHead.style.backgroundImage = `url("${skinUrl}"), url("${skinUrl}"), url("assets/icon.png")`;
  els.profileHead.style.backgroundSize = "800% 800%, 800% 800%, cover";
  els.profileHead.style.backgroundPosition = "-260px -52px, -52px -52px, center";
  els.profileHead.style.backgroundRepeat = "no-repeat";
}

function skinUrlFor(account) {
  return `${state.webBaseUrl}/Images/Skins/textures/${encodeURIComponent(account.name)}.png?t=${Date.now()}`;
}

function renderInstances() {
  const account = selectedAccount();
  els.instanceSelect.innerHTML = "";
  const visibleInstances = state.instances.filter((instance) => {
    if (!instance.whitelistActive) return true;
    return Array.isArray(instance.whitelist) && instance.whitelist.includes(account?.name);
  });

  for (const instance of visibleInstances) {
    const option = document.createElement("option");
    option.value = instance.name;
    option.textContent = instance.name;
    option.selected = instance.name === state.selectedInstance;
    els.instanceSelect.appendChild(option);
  }

  if (!visibleInstances.some((instance) => instance.name === state.selectedInstance)) {
    state.selectedInstance = visibleInstances[0]?.name || null;
  }

  applyInstanceBackground();
}

function renderNews() {
  els.newsList.innerHTML = "";
  if (!state.news.length) {
    els.newsList.innerHTML = `<div class="news-item">Aucune actualite disponible.</div>`;
    return;
  }

  for (const item of state.news) {
    const block = document.createElement("article");
    block.className = "news-item";
    block.innerHTML = `
      <h3>${escapeHtml(item.title || "Actualite")}</h3>
      <div>${item.content || ""}</div>
      <p class="message">Par ${escapeHtml(item.author || "Y&S")} - ${escapeHtml(String(item.publish_date || ""))}</p>
    `;
    els.newsList.appendChild(block);
  }
}

function renderSettings() {
  const memoryLimit = memoryLimitGb();
  const memoryMinInput = document.getElementById("memory-min");
  const memoryMaxInput = document.getElementById("memory-max");
  const memoryMin = clampMemoryValue(state.settings.memoryMin ?? 2, 2);
  const memoryMax = Math.min(memoryLimit, Math.max(memoryMin, clampMemoryValue(state.settings.memoryMax ?? 4, 4)));
  memoryMinInput.max = memoryLimit;
  memoryMaxInput.max = memoryLimit;
  memoryMaxInput.min = memoryMin;
  memoryMinInput.value = memoryMin;
  memoryMaxInput.value = memoryMax;
  document.getElementById("screen-width").value = state.settings.width ?? 854;
  document.getElementById("screen-height").value = state.settings.height ?? 480;
  document.getElementById("download-multi").value = state.settings.downloadMulti ?? 5;
  document.getElementById("close-mode").value = state.settings.closeMode ?? "minimize";
  document.getElementById("java-path").value = state.settings.javaPath ?? "";
  document.getElementById("jvm-args").value = Array.isArray(state.settings.jvmArgs)
    ? state.settings.jvmArgs.join("\n")
    : state.settings.jvmArgs ?? "";
}

function renderAccounts() {
  els.accountsList.innerHTML = "";
  for (const account of state.accounts) {
    const row = document.createElement("div");
    row.className = "account-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(account.name)}</strong>
        <div class="message">${escapeHtml(account.uuid || "UUID indisponible")}</div>
      </div>
      <div>
        <button class="secondary" data-account-select="${account.ID}">Utiliser</button>
        <button class="secondary" data-account-delete="${account.ID}">Supprimer</button>
      </div>
    `;
    els.accountsList.appendChild(row);
  }
}

async function renderSkinPreview() {
  const requestId = ++skinRenderRequest;
  const account = selectedAccount();

  if (skinViewerInstance?.dispose) {
    skinViewerInstance.dispose();
    skinViewerInstance = null;
  }

  els.skinViewer.innerHTML = "";
  setMessage(els.skinMessage, "");

  if (!account) {
    els.skinAccountName.textContent = "Aucun compte";
    els.skinFilename.textContent = "Connecte un compte pour afficher son skin.";
    els.skinViewer.innerHTML = `<div class="skin-empty">Aucun skin</div>`;
    return;
  }

  els.skinAccountName.textContent = account.name;
  els.skinFilename.textContent = `${account.name}.png`;

  if (!window.skinview3d) {
    els.skinViewer.innerHTML = `<div class="skin-empty">Apercu 3D indisponible</div>`;
    setMessage(els.skinMessage, "Le moteur 3D du skin n'a pas pu etre charge.", true);
    return;
  }

  const remoteSkinUrl = skinUrlFor(account);
  const fallbackSkinUrl = "assets/images/skin/steve.png";
  const skinUrl = await imageExists(remoteSkinUrl).then(
    () => remoteSkinUrl,
    () => fallbackSkinUrl
  );

  if (requestId !== skinRenderRequest) return;
  if (skinUrl === fallbackSkinUrl) {
    els.skinFilename.textContent = "Steve.png";
    setMessage(els.skinMessage, "Aucun skin distant trouve pour ce compte.");
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = 260;
    canvas.height = 360;
    skinViewerInstance = new skinview3d.SkinViewer({
      canvas,
      width: 260,
      height: 360,
      skin: skinUrl
    });

    skinViewerInstance.controls.enableRotate = true;
    skinViewerInstance.autoRotate = true;
    skinViewerInstance.autoRotateSpeed = 0.55;

    if (skinViewerInstance.animations && typeof skinViewerInstance.animations.add === "function") {
      skinViewerInstance.animations.add(new skinview3d.WalkingAnimation());
      skinViewerInstance.animations.play();
    } else if (typeof skinview3d.WalkingAnimation === "function") {
      skinViewerInstance.animation = new skinview3d.WalkingAnimation();
    }

    els.skinViewer.appendChild(canvas);
  } catch (error) {
    els.skinViewer.innerHTML = `<div class="skin-empty">Erreur 3D</div>`;
    setMessage(els.skinMessage, error.message || "Impossible d'afficher le skin.", true);
  }
}

function imageExists(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
}

function renderAll(options = {}) {
  const refreshSkin = options.refreshSkin ?? true;
  const refreshSettings = options.refreshSettings ?? true;

  renderWarnings();
  renderProfile();
  renderInstances();
  renderNews();
  if (refreshSettings) renderSettings();
  renderAccounts();
  if (refreshSkin) renderSkinPreview();
  refreshServerStatus();
}

function renderWarnings() {
  const warnings = Array.isArray(state.warnings) ? state.warnings : [];
  els.warningBox.classList.toggle("hidden", !warnings.length);
  els.warningBox.textContent = warnings.join(" | ");
}

async function refreshServerStatus() {
  const instance = selectedInstance();
  if (!instance?.status) {
    els.serverName.textContent = "Minecraft";
    els.serverStatus.textContent = "Statut indisponible";
    els.players.textContent = "0";
    return;
  }

  els.serverName.textContent = instance.status.nameServer || instance.name;
  els.serverStatus.textContent = "Verification...";
  const status = await window.ys.getServerStatus(instance.status).catch(() => ({ online: false }));
  els.serverStatus.textContent = status.online ? `En ligne - ${status.ms} ms` : "Ferme";
  els.players.textContent = String(status.players || 0);
}

function applyState(next, options = {}) {
  Object.assign(state, next);
  if (!state.selectedAccountId && state.accounts[0]) state.selectedAccountId = state.accounts[0].ID;
  showMode(state.accounts.length ? "launcher" : "login");
  renderAll(options);
}

async function refreshLauncherState(options = {}) {
  if (refreshInProgress) return;

  const silent = options.silent ?? false;
  const previousInstance = state.selectedInstance;
  refreshInProgress = true;

  if (!silent) {
    els.updateStatus.textContent = "Actualisation du launcher...";
  }

  try {
    const next = await window.ys.getState();
    applyState(next, {
      refreshSkin: options.refreshSkin ?? false,
      refreshSettings: options.refreshSettings ?? false
    });

    if (state.selectedInstance && state.selectedInstance !== previousInstance) {
      await window.ys.selectInstance(state.selectedInstance);
    }

    if (!silent) {
      els.updateStatus.textContent = "Launcher actualise.";
    }
  } catch (error) {
    if (!silent) {
      els.updateStatus.textContent = error.message || "Actualisation impossible.";
    }
  } finally {
    refreshInProgress = false;
  }
}

function startAutoRefresh() {
  setInterval(() => {
    if (document.visibilityState === "visible") {
      refreshLauncherState({ silent: true });
    }
  }, AUTO_REFRESH_INTERVAL_MS);

  window.addEventListener("focus", () => {
    refreshLauncherState({ silent: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshLauncherState({ silent: true });
    }
  });
}

async function boot() {
  bindEvents();
  window.ys.onLaunchEvent(handleLaunchEvent);
  window.ys.onUpdateEvent(handleUpdateEvent);
  try {
    const initial = await window.ys.appReady();
    applyState(initial);
    startAutoRefresh();
  } catch (error) {
    showMode("login");
    setMessage(els.authMessage, error.message || "Impossible de charger le launcher.", true);
  }
}

function bindEvents() {
  document.getElementById("minimize").addEventListener("click", () => window.ys.minimize());
  document.getElementById("maximize").addEventListener("click", () => window.ys.maximize());
  document.getElementById("close").addEventListener("click", () => window.ys.close());

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (event.key === "F5" || (event.ctrlKey && key === "r")) {
      event.preventDefault();
      refreshLauncherState({ silent: false, refreshSkin: true, refreshSettings: true });
    }
  });

  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-auth-tab]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      const tab = button.dataset.authTab;
      els.loginForm.classList.toggle("hidden", tab !== "login");
      els.registerForm.classList.toggle("hidden", tab !== "register");
      setMessage(els.authMessage, "");
    });
  });

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage(els.authMessage, "Connexion...");
    try {
      const result = await window.ys.login({
        username: document.getElementById("login-username").value,
        password: document.getElementById("login-password").value
      });
      state.accounts = result.accounts;
      state.selectedAccountId = result.account.ID;
      const next = await window.ys.getState();
      applyState(next);
    } catch (error) {
      setMessage(els.authMessage, error.message, true);
    }
  });

  els.registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage(els.authMessage, "Creation du compte...");
    try {
      await window.ys.register({
        username: document.getElementById("register-username").value,
        email: document.getElementById("register-email").value,
        password: document.getElementById("register-password").value
      });
      setMessage(els.authMessage, "Compte cree. Tu peux te connecter.");
    } catch (error) {
      setMessage(els.authMessage, error.message, true);
    }
  });

  document.getElementById("logout").addEventListener("click", () => showMode("login"));

  document.querySelectorAll(".nav").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".content-view").forEach((item) => item.classList.add("hidden"));
      button.classList.add("active");
      document.getElementById(`${button.dataset.view}-view`).classList.remove("hidden");
    });
  });

  els.instanceSelect.addEventListener("change", async () => {
    state.selectedInstance = els.instanceSelect.value;
    await window.ys.selectInstance(state.selectedInstance);
    applyInstanceBackground();
    refreshServerStatus();
  });

  els.play.addEventListener("click", async () => {
    els.play.disabled = true;
    els.launchState.classList.remove("hidden");
    els.launchLog.textContent = "";
    els.launchMessage.textContent = "Preparation...";
    els.launchProgress.removeAttribute("value");
    try {
      await window.ys.launch();
    } catch (error) {
      handleLaunchEvent({ type: "error", message: error.message });
    }
  });

  document.getElementById("memory-min").addEventListener("change", () => {
    const memoryMinInput = document.getElementById("memory-min");
    const memoryMaxInput = document.getElementById("memory-max");
    const memoryMin = clampMemoryValue(memoryMinInput.value, 2);
    const memoryMax = Math.min(memoryLimitGb(), Math.max(memoryMin, clampMemoryValue(memoryMaxInput.value, 4)));
    memoryMinInput.value = memoryMin;
    memoryMaxInput.min = memoryMin;
    memoryMaxInput.value = memoryMax;
  });

  document.getElementById("memory-max").addEventListener("change", () => {
    const memoryMin = clampMemoryValue(document.getElementById("memory-min").value, 2);
    const memoryMaxInput = document.getElementById("memory-max");
    memoryMaxInput.value = Math.min(memoryLimitGb(), Math.max(memoryMin, clampMemoryValue(memoryMaxInput.value, 4)));
  });

  document.getElementById("save-settings").addEventListener("click", async () => {
    const memoryLimit = memoryLimitGb();
    const memoryMin = clampMemoryValue(document.getElementById("memory-min").value, 2);
    const memoryMax = Math.min(memoryLimit, Math.max(memoryMin, clampMemoryValue(document.getElementById("memory-max").value, 4)));
    const settings = {
      memoryMin,
      memoryMax,
      width: Number(document.getElementById("screen-width").value),
      height: Number(document.getElementById("screen-height").value),
      downloadMulti: Number(document.getElementById("download-multi").value),
      closeMode: document.getElementById("close-mode").value,
      javaPath: document.getElementById("java-path").value.trim() || null,
      jvmArgs: document.getElementById("jvm-args").value
    };
    state.settings = await window.ys.saveSettings(settings);
    renderSettings();
    setMessage(els.settingsMessage, `Parametres enregistres. RAM maximum detectee : ${memoryLimit} Go.`);
  });

  els.accountsList.addEventListener("click", async (event) => {
    const select = event.target.dataset.accountSelect;
    const remove = event.target.dataset.accountDelete;
    if (select) {
      const result = await window.ys.selectAccount(Number(select));
      state.selectedAccountId = result.selectedAccountId;
      renderAll();
    }
    if (remove) {
      const result = await window.ys.deleteAccount(Number(remove));
      state.accounts = result.accounts;
      state.selectedAccountId = result.selectedAccountId;
      showMode(state.accounts.length ? "launcher" : "login");
      renderAll();
    }
  });

  document.getElementById("upload-skin").addEventListener("click", async () => {
    setMessage(els.skinMessage, "Selection du fichier...");
    try {
      const uploadResult = await window.ys.uploadSkin();
      if (uploadResult?.canceled) {
        setMessage(els.skinMessage, "Changement de skin annule.");
        return;
      }
      const next = await window.ys.getState();
      applyState(next);
      setMessage(els.skinMessage, "Skin mis a jour.");
    } catch (error) {
      setMessage(els.skinMessage, error.message, true);
    }
  });
}

function handleLaunchEvent(event) {
  els.launchState.classList.remove("hidden");
  els.launchMessage.textContent = event.message || "Lancement...";

  if (event.type === "progress" || event.type === "check") {
    els.launchProgress.max = event.size || 1;
    els.launchProgress.value = event.progress || 0;
  } else if (event.indeterminate) {
    els.launchProgress.removeAttribute("value");
  }

  if (event.line) {
    els.launchLog.textContent = `${event.line}\n${els.launchLog.textContent}`.slice(0, 4000);
  }

  if (event.type === "error" || event.type === "close") {
    els.play.disabled = false;
    els.launchProgress.value = 0;
  }
}

function handleUpdateEvent(event) {
  els.updateStatus.textContent = event.message || "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

boot();
