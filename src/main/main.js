const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const Store = require("electron-store");
const { Launch, Status } = require("minecraft-java-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const pkg = require("../../package.json");

Store.initRenderer();

const isDev = process.env.NODE_ENV === "development";
const webBaseUrl = pkg.ysLauncher.webBaseUrl.replace(/\/$/, "");
const launcherBaseUrl = pkg.ysLauncher.launcherBaseUrl.replace(/\/$/, "");
const store = new Store({
  name: "launcher-v2",
  encryptionKey: isDev ? undefined : "ys-launcher-v2-local-data"
});

let mainWindow = null;
let launchRunning = false;
let lastRemoteState = {
  config: null,
  news: [],
  instances: [],
  warnings: []
};

const defaultSettings = {
  theme: "dark",
  memoryMin: 2,
  memoryMax: 4,
  width: 854,
  height: 480,
  javaPath: null,
  downloadMulti: 5,
  closeMode: "minimize",
  gameDirectoryName: "YS-Launcher"
};

function getSystemMemoryMaxGb() {
  return Math.max(1, Math.floor(os.totalmem() / 1024 / 1024 / 1024));
}

function normalizeSettings(settings) {
  const memoryLimit = getSystemMemoryMaxGb();
  const next = { ...defaultSettings, ...(settings || {}) };
  next.memoryMin = Math.min(memoryLimit, Math.max(1, Number(next.memoryMin) || defaultSettings.memoryMin));
  next.memoryMax = Math.min(memoryLimit, Math.max(next.memoryMin, Number(next.memoryMax) || defaultSettings.memoryMax));
  next.width = Math.max(320, Number(next.width) || defaultSettings.width);
  next.height = Math.max(240, Number(next.height) || defaultSettings.height);
  next.downloadMulti = Math.min(30, Math.max(1, Number(next.downloadMulti) || defaultSettings.downloadMulti));
  return next;
}

function getSettings() {
  return normalizeSettings(store.get("settings"));
}

function saveSettings(settings) {
  const next = normalizeSettings({ ...getSettings(), ...settings });
  store.set("settings", next);
  return next;
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function sendGame(type, message, extra = {}) {
  send("game:event", {
    type,
    message,
    time: Date.now(),
    ...extra
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 760,
    minWidth: 980,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: "#111318",
    icon: path.join(__dirname, "../renderer/assets/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.on("close", (event) => {
    if (launchRunning && getSettings().closeMode === "hide-until-game-close") {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
  });
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 15000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: text || "Reponse serveur invalide." };
    }
    if (!response.ok) {
      const message = body?.message || body?.error || `Erreur HTTP ${response.status}`;
      throw new Error(`${message} (${url})`);
    }
    return body;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Delai depasse (${url})`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getFallbackInstances(reason = null) {
  const filesUrl = `${launcherBaseUrl}/files`;

  return {
    instances: [
      {
        name: "Minecraft",
        url: `${filesUrl}?instance=Minecraft`,
        loadder: {
          minecraft_version: "1.21.11",
          loadder_type: "forge",
          loadder_version: "latest"
        },
        verify: false,
        ignored: [
          "config",
          "essential",
          "logs",
          "resourcepacks",
          "saves",
          "screenshots",
          "shaderpacks",
          "W-OVERFLOW",
          "options.txt",
          "optionsof.txt"
        ],
        whitelist: [],
        whitelistActive: false,
        status: {
          nameServer: "Hypixel",
          ip: "mc.hypixel.net",
          port: 25565
        }
      },
      {
        name: "MugiRP",
        url: `${filesUrl}?instance=MugiRP`,
        loadder: {
          minecraft_version: "1.20.1",
          loadder_type: "forge",
          loadder_version: "latest"
        },
        verify: true,
        ignored: [
          "config",
          "essential",
          "logs",
          "resourcepacks",
          "saves",
          "screenshots",
          "shaderpacks",
          "W-OVERFLOW",
          "options.txt",
          "optionsof.txt"
        ],
        whitelist: [],
        whitelistActive: false,
        status: {
          nameServer: "MugiRP",
          ip: "mcrpbready.ddns.net",
          port: 25565
        }
      }
    ],
    warnings: []
  };
}

async function loadRemoteState() {
  const configUrl = `${launcherBaseUrl}/launcher/config-launcher/config.json`;
  const newsUrl = `${launcherBaseUrl}/launcher/news-launcher/news.json`;
  const instancesUrl = `${launcherBaseUrl}/files`;
  const [config, news, instancesResult] = await Promise.all([
    fetchJson(configUrl).catch((error) => {
      throw new Error(`Configuration indisponible: ${error.message}`);
    }),
    fetchJson(newsUrl).catch(() => []),
    fetchJson(instancesUrl).catch((error) => {
      return getFallbackInstances(error.message);
    })
  ]);

  const fallbackWarnings = instancesResult?.warnings || [];
  const instancesSource = Array.isArray(instancesResult?.instances)
    ? instancesResult.instances
    : Object.values(instancesResult || {});
  let instances = instancesSource.filter((item) => item && item.name);
  if (!instances.length) {
    const fallback = getFallbackInstances("liste distante vide");
    instances = fallback.instances;
    fallbackWarnings.push(...fallback.warnings);
  }

  lastRemoteState = {
    config,
    news: Array.isArray(news) ? news : [],
    instances,
    warnings: fallbackWarnings
  };
  return lastRemoteState;
}

function normalizeAccount(data, credentials = {}) {
  const name = data?.name || data?.username || credentials.username;
  const uuid = data?.uuid || data?.UUID || data?.id || data?.ID || null;
  const accessToken = data?.access_token || data?.accessToken || "offline-token";
  const clientToken = data?.client_token || data?.clientToken || uuid || accessToken || "offline-client";

  return {
    ID: Number(data?.ID || Date.now()),
    name,
    username: credentials.username || name,
    password: credentials.password || null,
    uuid,
    access_token: accessToken,
    client_token: clientToken,
    user_properties: typeof data?.user_properties === "string"
      ? data.user_properties
      : JSON.stringify(data?.user_properties || {}),
    email: data?.email || null,
    skin: data?.skin || null,
    meta: {
      online: false,
      type: "Mojang",
      provider: "web",
      ...(data?.meta || {})
    },
    web: {
      accountId: data?.ID || null
    }
  };
}

function getAccounts() {
  return store.get("accounts") || [];
}

function saveAccount(account) {
  const accounts = getAccounts();
  const existingIndex = accounts.findIndex((item) => item.ID === account.ID || item.name === account.name);
  if (existingIndex >= 0) accounts[existingIndex] = { ...accounts[existingIndex], ...account };
  else accounts.push(account);
  store.set("accounts", accounts);
  store.set("selectedAccountId", account.ID);
  return account;
}

function getSelectedAccount() {
  const accounts = getAccounts();
  const selectedAccountId = store.get("selectedAccountId");
  return accounts.find((account) => account.ID === selectedAccountId) || accounts[0] || null;
}

function getSelectedInstance() {
  const selected = store.get("selectedInstance");
  if (selected && lastRemoteState.instances.some((instance) => instance.name === selected)) return selected;
  const firstPublic = lastRemoteState.instances.find((instance) => !instance.whitelistActive);
  const fallback = firstPublic?.name || lastRemoteState.instances[0]?.name || null;
  if (fallback) store.set("selectedInstance", fallback);
  return fallback;
}

function toMinecraftAuthenticator(account) {
  return {
    access_token: account.access_token || "offline-token",
    client_token: account.client_token || account.uuid || "offline-client",
    uuid: account.uuid,
    name: account.name,
    user_properties: account.user_properties || "{}",
    meta: {
      online: false,
      type: "Mojang",
      provider: "web"
    }
  };
}

function getGameRoot(config, settings) {
  const directoryName = settings.gameDirectoryName || config?.dataDirectory || "YS-Launcher";
  const folderName = process.platform === "darwin" ? directoryName : `.${directoryName}`;
  return path.join(app.getPath("appData"), folderName);
}

function clearCachedSkins(gameRoot) {
  const root = path.resolve(gameRoot);
  const skinsPath = path.resolve(root, "assets", "skins");
  if (!skinsPath.startsWith(root + path.sep)) {
    throw new Error("Chemin de cache skins invalide.");
  }
  fs.rmSync(skinsPath, { recursive: true, force: true });
}

function normalizeLoader(loader) {
  const type = String(loader?.loadder_type || loader?.loader_type || "none").toLowerCase();
  if (["none", "vanilla", "default"].includes(type)) {
    return { type: "none", build: "latest", enable: false };
  }
  return {
    type,
    build: String(loader?.loadder_version || loader?.loader_version || "latest").toLowerCase(),
    enable: true
  };
}

function buildLaunchOptions() {
  const settings = getSettings();
  const account = getSelectedAccount();
  const selectedInstance = getSelectedInstance();
  const instance = lastRemoteState.instances.find((item) => item.name === selectedInstance);
  const config = lastRemoteState.config;

  if (!account) throw new Error("Aucun compte connecte.");
  if (!instance) throw new Error("Aucune instance selectionnee.");
  if (!config) throw new Error("Configuration launcher indisponible.");

  const loader = normalizeLoader(instance.loadder || instance.loader);
  const gameRoot = getGameRoot(config, settings);

  return {
    instance,
    options: {
      url: instance.url,
      authenticator: toMinecraftAuthenticator(account),
      timeout: 15000,
      path: gameRoot,
      instance: instance.name,
      version: instance.loadder?.minecraft_version || instance.loader?.minecraft_version || "latest_release",
      detached: settings.closeMode !== "close-with-game",
      downloadFileMultiple: settings.downloadMulti,
      intelEnabledMac: true,
      loader,
      verify: Boolean(instance.verify),
      ignored: Array.isArray(instance.ignored) ? instance.ignored : [],
      java: {
        path: settings.javaPath || null
      },
      JVM_ARGS: Array.isArray(instance.jvm_args) ? instance.jvm_args : [],
      GAME_ARGS: Array.isArray(instance.game_args) ? instance.game_args : [],
      screen: {
        width: settings.width,
        height: settings.height
      },
      memory: {
        min: `${settings.memoryMin * 1024}M`,
        max: `${settings.memoryMax * 1024}M`
      }
    }
  };
}

async function launchGame() {
  if (launchRunning) throw new Error("Un lancement est deja en cours.");
  await loadRemoteState();

  const { instance, options } = buildLaunchOptions();
  clearCachedSkins(options.path);

  const launch = new Launch();
  const settings = getSettings();
  launchRunning = true;

  sendGame("prepare", `Preparation de ${instance.name}...`, { indeterminate: true });

  launch.on("extract", (file) => {
    sendGame("extract", `Extraction ${file || ""}`.trim(), { indeterminate: true });
  });

  launch.on("progress", (progress, size, element) => {
    sendGame("progress", `Telechargement ${Math.round((progress / Math.max(size, 1)) * 100)}%`, {
      progress,
      size,
      element
    });
  });

  launch.on("check", (progress, size, element) => {
    sendGame("check", `Verification ${Math.round((progress / Math.max(size, 1)) * 100)}%`, {
      progress,
      size,
      element
    });
  });

  launch.on("patch", () => {
    sendGame("patch", "Patch du loader en cours...", { indeterminate: true });
  });

  launch.on("estimated", (seconds) => {
    sendGame("estimated", "Estimation du temps restant...", { seconds });
  });

  launch.on("speed", (speed) => {
    sendGame("speed", "Telechargement en cours...", { speed });
  });

  launch.on("data", (line) => {
    sendGame("data", "Demarrage de Minecraft...", { line: String(line || "") });
    if (settings.closeMode === "minimize" && mainWindow && !mainWindow.isMinimized()) {
      mainWindow.minimize();
    } else if (settings.closeMode === "hide-until-game-close" && mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
    }
  });

  launch.on("close", () => {
    launchRunning = false;
    sendGame("close", "Minecraft est ferme.");
    if ((settings.closeMode === "minimize" || settings.closeMode === "hide-until-game-close") && mainWindow) {
      mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  launch.on("error", (error) => {
    launchRunning = false;
    const message = error?.error?.message || error?.error || error?.message || "Erreur inconnue.";
    sendGame("error", message);
    if ((settings.closeMode === "minimize" || settings.closeMode === "hide-until-game-close") && mainWindow) {
      mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  sendGame("prepare", "Lecture des manifests et verification des fichiers...", { indeterminate: true });
  launch.Launch(options);
  return { ok: true };
}

async function uploadSkin(filePath) {
  const account = getSelectedAccount();
  if (!account) throw new Error("Aucun compte connecte.");

  let selectedPath = filePath;
  if (!selectedPath) {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choisir un skin Minecraft",
      filters: [{ name: "Images PNG", extensions: ["png"] }],
      properties: ["openFile"]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    selectedPath = result.filePaths[0];
  }

  const bytes = fs.readFileSync(selectedPath);
  const form = new FormData();
  form.append("username", account.name);
  form.append("skin", new Blob([bytes], { type: "image/png" }), path.basename(selectedPath));

  const response = await fetch(`${webBaseUrl}/upload_skin.php`, {
    method: "POST",
    body: form
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Upload impossible.");

  account.skin = data.filename;
  saveAccount(account);
  return data;
}

function setupIpc() {
  ipcMain.handle("app:ready", async () => {
    const remote = await loadRemoteState();
    const selected = getSelectedInstance();
    return {
      ...remote,
      accounts: getAccounts(),
      selectedAccountId: store.get("selectedAccountId") || null,
      selectedInstance: selected,
      settings: getSettings(),
      systemMemoryMaxGb: getSystemMemoryMaxGb(),
      webBaseUrl,
      launcherBaseUrl,
      isDev
    };
  });

  ipcMain.handle("state:get", async () => {
    const remote = await loadRemoteState();
    return {
      ...remote,
      accounts: getAccounts(),
      selectedAccountId: store.get("selectedAccountId") || null,
      selectedInstance: getSelectedInstance(),
      settings: getSettings(),
      systemMemoryMaxGb: getSystemMemoryMaxGb()
    };
  });

  ipcMain.handle("auth:login", async (_, payload) => {
    const username = String(payload?.username || "").trim();
    const password = String(payload?.password || "");
    if (!username || !password) throw new Error("Pseudo et mot de passe requis.");

    const data = await fetchJson(`${webBaseUrl}/auth.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ username, password })
    });
    if (data.error) throw new Error(data.error);
    const account = saveAccount(normalizeAccount(data, { username, password }));
    return { account, accounts: getAccounts() };
  });

  ipcMain.handle("auth:register", async (_, payload) => {
    const username = String(payload?.username || "").trim();
    const email = String(payload?.email || "").trim();
    const password = String(payload?.password || "");
    if (!username || !email || !password) throw new Error("Tous les champs sont requis.");
    const data = await fetchJson(`${webBaseUrl}/register.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ username, email, password })
    });
    if (data.error) throw new Error(data.error);
    return data;
  });

  ipcMain.handle("auth:logout", () => {
    store.delete("selectedAccountId");
    return { accounts: getAccounts() };
  });

  ipcMain.handle("accounts:select", (_, id) => {
    store.set("selectedAccountId", Number(id));
    return { selectedAccountId: Number(id) };
  });

  ipcMain.handle("accounts:delete", (_, id) => {
    const accountId = Number(id);
    const accounts = getAccounts().filter((account) => account.ID !== accountId);
    store.set("accounts", accounts);
    if (store.get("selectedAccountId") === accountId) {
      store.set("selectedAccountId", accounts[0]?.ID || null);
    }
    return { accounts, selectedAccountId: store.get("selectedAccountId") || null };
  });

  ipcMain.handle("instances:select", (_, name) => {
    store.set("selectedInstance", String(name));
    return { selectedInstance: String(name) };
  });

  ipcMain.handle("settings:save", (_, settings) => saveSettings(settings || {}));

  ipcMain.handle("server:status", async (_, status) => {
    if (!status?.ip) return { online: false, players: 0, ms: 0 };
    const res = await new Status(status.ip, status.port || 25565)
      .getStatus()
      .catch((error) => ({ error }));
    if (res.error) return { online: false, players: 0, ms: 0 };
    return {
      online: true,
      players: res.playersConnect || 0,
      ms: res.ms || 0
    };
  });

  ipcMain.handle("skin:upload", (_, filePath) => uploadSkin(filePath));
  ipcMain.handle("game:launch", () => launchGame());
  ipcMain.handle("game:cancel", () => {
    sendGame("info", "Annulation demandee. Minecraft terminera l'etape en cours.");
    return { ok: true };
  });
  ipcMain.handle("shell:open", (_, url) => shell.openExternal(url));

  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on("window:close", () => mainWindow?.close());
}

function setupUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => send("update:event", { type: "checking", message: "Recherche de mise a jour..." }));
  autoUpdater.on("update-available", (info) => send("update:event", { type: "available", message: "Mise a jour disponible.", info }));
  autoUpdater.on("update-not-available", () => send("update:event", { type: "none", message: "Launcher a jour." }));
  autoUpdater.on("download-progress", (progress) => send("update:event", { type: "progress", message: "Telechargement de la mise a jour...", progress }));
  autoUpdater.on("update-downloaded", (info) => {
    send("update:event", { type: "downloaded", message: "Mise a jour prete. Installation...", info });
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 1500);
  });
  autoUpdater.on("error", (error) => send("update:event", { type: "error", message: error?.message || "Erreur de mise a jour." }));

  if (!isDev) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 2500);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    setupIpc();
    createWindow();
    setupUpdater();
  });
}

app.on("window-all-closed", () => {
  app.quit();
});
