const { contextBridge, ipcRenderer } = require('electron');

// Preload scripts run in EVERY frame — and this panel embeds the remote
// BotRix widget in an iframe. Without this gate the full privileged
// bridge (quit the app, read the bid, overwrite the saved URL) would be
// exposed to that remote frame. Only the panel's TOP frame gets the
// bridge; widget frames return early.
if (window.top !== window) {
  return;
}

contextBridge.exposeInMainWorld('chatPanel', {
  /** Toggle always-on-top for this window. Returns the new state. */
  togglePin: () => ipcRenderer.invoke('chat:toggle-pin'),
  /** Toggle background transparency. Returns true when now OPAQUE. */
  toggleTransparent: () => ipcRenderer.invoke('chat:toggle-transparent'),
  /** Close the chat panel window. */
  close: () => ipcRenderer.send('chat:close'),

  /** The BotRix multistream widget URL to embed (from the settings db). */
  getWidgetUrl: () => ipcRenderer.invoke('chat:get-widget-url'),

  /** Machine-readable config diagnosis: { code, url, bid }. */
  getConfigStatus: () => ipcRenderer.invoke('chat:get-config-status'),

  /** Validate + persist a BotRix widget URL into the settings db.
   * Returns { ok, code, url?, bid? }. */
  saveUrl: (rawUrl) => ipcRenderer.invoke('chat:save-url', rawUrl),

  /** Viewer counts: { total, twitch, youtube, kick } pushed every ~30s. */
  onViewers: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('chat:viewers', listener);
    return () => ipcRenderer.removeListener('chat:viewers', listener);
  },

  /** Unexpected main-process errors: { where, message }. */
  onError: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('chat:error', listener);
    return () => ipcRenderer.removeListener('chat:error', listener);
  },

  /** Persistent-ish window state for the renderer to restore its UI from. */
  getState: () => ipcRenderer.invoke('chat:get-state'),
});
