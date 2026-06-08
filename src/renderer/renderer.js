const state = {
  config: null,
  news: [],
  instances: [],
  accounts: [],
  selectedAccountId: null,
  selectedInstance: null,
  settings: {},
  warnings: [],
  webBaseUrl: "",
  launcherBaseUrl: ""
};

const els = {
  app: document.getElementById("app"),
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
  settingsMessage: document.getElementById("settings-message")
};

function selectedAccount() {
  return state.accounts.find((account) => account.ID === state.selectedAccountId) || state.accounts[0] || null;
}

function selectedInstance() {
  return state.instances.find((instance) => instance.name === state.selectedInstance) || state.instances[0] || null;
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

function renderProfile() {
  const account = selectedAccount();
  if (!account) {
    els.profileName.textContent = "Aucun compte";
    els.profileHead.style.backgroundImage = "";
    return;
  }
  els.profileName.textContent = account.name;
  const skinUrl = `${state.webBaseUrl}/Images/Skins/textures/${encodeURIComponent(account.name)}.png?t=${Date.now()}`;
  els.profileHead.style.backgroundImage = `url("${skinUrl}"), url("assets/icon.png")`;
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
  document.getElementById("memory-min").value = state.settings.memoryMin ?? 2;
  document.getElementById("memory-max").value = state.settings.memoryMax ?? 4;
  document.getElementById("screen-width").value = state.settings.width ?? 854;
  document.getElementById("screen-height").value = state.settings.height ?? 480;
  document.getElementById("download-multi").value = state.settings.downloadMulti ?? 5;
  document.getElementById("close-mode").value = state.settings.closeMode ?? "minimize";
  document.getElementById("java-path").value = state.settings.javaPath ?? "";
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

function renderAll() {
  renderWarnings();
  renderProfile();
  renderInstances();
  renderNews();
  renderSettings();
  renderAccounts();
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

function applyState(next) {
  Object.assign(state, next);
  if (!state.selectedAccountId && state.accounts[0]) state.selectedAccountId = state.accounts[0].ID;
  showMode(state.accounts.length ? "launcher" : "login");
  renderAll();
}

async function boot() {
  bindEvents();
  window.ys.onLaunchEvent(handleLaunchEvent);
  window.ys.onUpdateEvent(handleUpdateEvent);
  try {
    const initial = await window.ys.appReady();
    applyState(initial);
  } catch (error) {
    showMode("login");
    setMessage(els.authMessage, error.message || "Impossible de charger le launcher.", true);
  }
}

function bindEvents() {
  document.getElementById("minimize").addEventListener("click", () => window.ys.minimize());
  document.getElementById("maximize").addEventListener("click", () => window.ys.maximize());
  document.getElementById("close").addEventListener("click", () => window.ys.close());

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

  document.getElementById("save-settings").addEventListener("click", async () => {
    const settings = {
      memoryMin: Number(document.getElementById("memory-min").value),
      memoryMax: Number(document.getElementById("memory-max").value),
      width: Number(document.getElementById("screen-width").value),
      height: Number(document.getElementById("screen-height").value),
      downloadMulti: Number(document.getElementById("download-multi").value),
      closeMode: document.getElementById("close-mode").value,
      javaPath: document.getElementById("java-path").value.trim() || null
    };
    state.settings = await window.ys.saveSettings(settings);
    renderSettings();
    setMessage(els.settingsMessage, "Parametres enregistres.");
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
    try {
      await window.ys.uploadSkin();
      const next = await window.ys.getState();
      applyState(next);
    } catch (error) {
      alert(error.message);
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
