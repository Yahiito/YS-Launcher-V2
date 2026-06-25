const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ys", {
  appReady: () => ipcRenderer.invoke("app:ready"),
  login: (payload) => ipcRenderer.invoke("auth:login", payload),
  register: (payload) => ipcRenderer.invoke("auth:register", payload),
  logout: () => ipcRenderer.invoke("auth:logout"),
  getState: () => ipcRenderer.invoke("state:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  selectAccount: (id) => ipcRenderer.invoke("accounts:select", id),
  deleteAccount: (id) => ipcRenderer.invoke("accounts:delete", id),
  selectInstance: (name) => ipcRenderer.invoke("instances:select", name),
  requestWhitelist: (name) => ipcRenderer.invoke("whitelist:request", name),
  resolveWhitelistRequest: (payload) => ipcRenderer.invoke("admin:whitelist:resolve", payload),
  getServerStatus: (status) => ipcRenderer.invoke("server:status", status),
  uploadSkin: (filePath) => ipcRenderer.invoke("skin:upload", filePath),
  launch: () => ipcRenderer.invoke("game:launch"),
  cancelLaunch: () => ipcRenderer.invoke("game:cancel"),
  openExternal: (url) => ipcRenderer.invoke("shell:open", url),
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  onLaunchEvent: (callback) => {
    ipcRenderer.removeAllListeners("game:event");
    ipcRenderer.on("game:event", (_, event) => callback(event));
  },
  onUpdateEvent: (callback) => {
    ipcRenderer.removeAllListeners("update:event");
    ipcRenderer.on("update:event", (_, event) => callback(event));
  }
});
