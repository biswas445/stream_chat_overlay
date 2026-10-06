/**
 * Behavioral tests for the main-process settings-db feature (chat:save-url,
 * config diagnosis) — runs the REAL electron/main.js against a stubbed
 * Electron module and a real temp settings db on disk.
 * Runner: plain Node (no deps) — part of `npm test`.
 * Convention: fail fast with non-zero exit + named assertion.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
  console.log(`ok ${n} - ${name}`);
}

// --- Electron stub (must be in require.cache BEFORE main.js loads) ---

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikasha-test-'));
const ipcHandlers = new Map();
const ipcListeners = new Map();

const stubElectron = {
  app: {
    isPackaged: false,
    getPath: (name) => (name === 'userData' ? userDataDir : path.join(os.tmpdir(), 'hikasha-fake-' + name)),
    requestSingleInstanceLock: () => true,
    on: () => {},
    whenReady: () => Promise.resolve(),
    setAppUserModelId: () => {},
    quit: () => {},
    exit: () => {},
  },
  ipcMain: {
    handle: (ch, fn) => ipcHandlers.set(ch, fn),
    on: (ch, fn) => ipcListeners.set(ch, fn),
  },
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
  net: { fetch: () => Promise.reject(new Error('no network under test')) },
  Tray: class {
    setToolTip() {}
    setContextMenu() {}
    destroy() {}
  },
  Menu: { buildFromTemplate: () => ({}) },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }),
    createFromBitmap: () => ({}),
    createEmpty: () => ({}),
  },
};

class FakeWebContents {
  constructor() {
    this._handlers = {};
  }
  on(ev, fn) {
    this._handlers[ev] = fn;
  }
  once(ev, fn) {
    this._handlers[ev] = fn;
  }
  send() {}
  setWindowOpenHandler() {}
  get session() {
    return { setPermissionRequestHandler() {} };
  }
  get mainFrame() {
    return { frames: [] };
  }
  executeJavaScript() {
    return Promise.resolve(undefined);
  }
}

class FakeBrowserWindow {
  constructor(opts) {
    this.webContents = new FakeWebContents();
    this.opts = opts;
    this.destroyed = false;
  }
  on() {}
  once() {}
  setAlwaysOnTop() {}
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
  }
  close() {}
  show() {}
  focus() {}
  restore() {}
  isMinimized() {
    return false;
  }
  getPosition() {
    return [0, 0];
  }
  getSize() {
    return [340, 480];
  }
  loadFile() {
    return Promise.resolve(true);
  }
  loadURL() {
    return Promise.resolve(true);
  }
  setIgnoreMouseEvents() {}
  setSkipTaskbar() {}
}
stubElectron.BrowserWindow = FakeBrowserWindow;

const electronPath = require.resolve('electron');
const fakeModule = new Module('electron-stub', null);
fakeModule.filename = electronPath;
fakeModule.loaded = true;
fakeModule.exports = stubElectron;
require.cache[electronPath] = fakeModule;

// --- load the REAL main process ---

const mainPath = path.join(__dirname, '..', 'electron', 'main.js');
require(mainPath);

// Drain microtasks + a macrotask so whenReady().then (boot) has run and
// registerIpc() has registered the handlers.
async function settle(rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
    await new Promise((r) => setImmediate(r));
  }
}

const configFile = path.join(userDataDir, 'botrix-config.json');

async function main() {
  await settle();

  t('boot registers the settings-db IPC handlers', () => {
    assert.equal(typeof ipcHandlers.get('chat:get-config-status'), 'function');
    assert.equal(typeof ipcHandlers.get('chat:save-url'), 'function');
    assert.equal(typeof ipcHandlers.get('chat:get-widget-url'), 'function');
  });

  await (async () => {
    await settle();
    const status = await ipcHandlers.get('chat:get-config-status')();
    assert.equal(status.code, 'missing');
    assert.equal(status.url, null);
    assert.equal(await ipcHandlers.get('chat:get-widget-url')(), null);
  })();
  n += 1;
  console.log(`ok ${n} - empty db diagnoses as 'missing' (silent poller)`);

  await (async () => {
    const res = await ipcHandlers.get('chat:save-url')(
      'https://botrix.live/widgets/chat/?bid=TESTBID1&theme=default&messageSound=0',
    );
    assert.equal(res.ok, true);
    assert.equal(res.code, 'ok');
    assert.equal(res.bid, 'TESTBID1');
    assert.equal(res.url, 'https://botrix.live/widgets/chat/?bid=TESTBID1');
    // the db holds the CANONICAL url only (theme/sound dropped at save time)
    const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    assert.deepEqual(cfg, { widgetUrl: 'https://botrix.live/widgets/chat/?bid=TESTBID1' });
  })();
  n += 1;
  console.log(`ok ${n} - save validates, canonicalizes, and persists to the db`);

  await (async () => {
    const unchanged = await ipcHandlers.get('chat:save-url')('https://botrix.live/widgets/chat/?bid=TESTBID1');
    assert.equal(unchanged.ok, true);
    assert.equal(unchanged.code, 'unchanged');
    const status = await ipcHandlers.get('chat:get-config-status')();
    assert.equal(status.code, 'ok');
    assert.equal(status.bid, 'TESTBID1');
    assert.equal(await ipcHandlers.get('chat:get-widget-url')(), 'https://botrix.live/widgets/chat/?bid=TESTBID1');
  })();
  n += 1;
  console.log(`ok ${n} - re-saving the same URL is 'unchanged'; every-run read returns it`);

  await (async () => {
    const save = ipcHandlers.get('chat:save-url');
    const cases = [
      ['http://botrix.live/?bid=X', 'bad-protocol'],
      ['not a url', 'bad-protocol'],
      ['https://evil.com/?bid=X', 'bad-host'],
      ['https://botrix.live/widgets/chat/', 'no-bid'],
      ['https://botrix.live/?bid=%ZZ', 'bad-bid'],
      ['https://botrix.live/?bid=a b', 'bad-bid'],
      ['   ', 'empty'],
      [null, 'missing'],
      [undefined, 'missing'],
      [42, 'missing'],
    ];
    for (const [raw, want] of cases) {
      const res = await save(raw);
      assert.equal(res.ok, false, JSON.stringify(raw));
      assert.equal(res.code, want, JSON.stringify(raw));
    }
    // a rejected save never touches the db
    const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    assert.equal(cfg.widgetUrl, 'https://botrix.live/widgets/chat/?bid=TESTBID1');
  })();
  n += 1;
  console.log(`ok ${n} - every invalid input is rejected with its code; db untouched`);

  // corrupt db -> sanitize to "no URL saved", never a crash
  fs.writeFileSync(configFile, '{ broken json!!');
  delete require.cache[mainPath];
  await (async () => {
    require(mainPath);
    await settle();
    const status = await ipcHandlers.get('chat:get-config-status')();
    assert.equal(status.code, 'missing');
    assert.equal(await ipcHandlers.get('chat:get-widget-url')(), null);
  })();
  n += 1;
  console.log(`ok ${n} - corrupt db file falls back to 'missing' (boot never crashes)`);

  fs.rmSync(userDataDir, { recursive: true, force: true });
  console.log(`\n# pass ${n}`);
  process.exit(0); // stubbed boot timers would otherwise hold the event loop
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
