/**
 * End-to-end tests: boot the REAL app (Electron + built renderer) under
 * Playwright, against an isolated userData dir, and drive the actual UI
 * through the settings flow and the close path.
 * Runner: plain Node — `npm test` executes this after the production build.
 * Convention: fail fast with non-zero exit + named assertion.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hikasha-e2e-'));
let app = null;
let n = 0;
function t(name) {
  n += 1;
  console.log(`ok ${n} - ${name}`);
}

async function launch() {
  return electron.launch({
    args: [path.join(__dirname, '..')],
    env: { ...process.env, OVERLAY_USER_DATA: userData },
  });
}

/** The panel is the SECOND window (the splash opens first, is dismissible
 * by a 2.5s timer, and the panel is created hidden behind it) — poll for
 * the chat.html window. */
async function panelWindow(electronApp, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    for (const w of electronApp.windows()) {
      if (w.url().includes('chat.html')) return w;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('panel window never opened');
}

/** The panel appears after the splash period; give the UI a beat before
 * interacting (the window is created hidden behind the splash intro). */
async function panelReady(win) {
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#chat-panel', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 3000)); // splash dismissal (2.5s) + reveal
}

async function main() {
  // 1. first run: setup card with the gear-icon guidance
  app = await launch();
  const win = await panelWindow(app);
  await panelReady(win);
  await win.waitForSelector('#setup-card.show', { timeout: 10000 });
  assert.equal(await win.textContent('#setup-card .t'), 'No widget URL saved');
  t('first run shows the setup card pointing at the gear icon');

  // 2. gear opens the settings panel
  await win.click('#btn-settings');
  await win.waitForSelector('#settings-panel.show', { timeout: 5000 });
  t('gear button opens the settings panel');

  // 3. empty field + Enter → the exact first-run error
  await win.click('#btn-save-url');
  assert.match(await win.textContent('#settings-msg'), /Enter a BotRix widget URL first/);
  t('saving an empty field shows the exact error');

  // 4. invalid URL + Enter → per-code rejection
  await win.fill('#settings-url', 'http://botrix.live/?bid=X');
  await win.click('#btn-save-url');
  assert.match(await win.textContent('#settings-msg'), /not saved/i);
  t('invalid URL is rejected with its code message');

  // 5. valid URL + Enter → canonicalized + persisted to the settings db
  await win.fill('#settings-url', 'https://botrix.live/widgets/chat/?bid=E2EBID1&theme=default');
  await win.press('#settings-url', 'Enter');
  assert.match(await win.textContent('#settings-msg'), /Saved/);
  const cfgPath = path.join(userData, 'botrix-config.json');
  for (let i = 0; i < 30 && !fs.existsSync(cfgPath); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.equal(cfg.widgetUrl, 'https://botrix.live/widgets/chat/?bid=E2EBID1');
  t('valid URL is canonicalized and persisted to the settings db');

  // 6. Change loads the saved URL back into the field
  await win.fill('#settings-url', '');
  await win.click('#btn-change-url');
  assert.equal(await win.inputValue('#settings-url'), 'https://botrix.live/widgets/chat/?bid=E2EBID1');
  t('Change button loads the saved URL into the field');

  // 7. gear closes the panel
  await win.click('#btn-settings');
  for (let i = 0; i < 20 && (await win.isVisible('#settings-panel')); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(await win.isVisible('#settings-panel'), false);
  t('gear button closes the settings panel');

  await app.close();
  app = null;

  // 8. restart: the saved URL is loaded into the widget iframe
  app = await launch();
  const win2 = await panelWindow(app);
  await panelReady(win2);
  await win2.waitForSelector('#chat-frame', { timeout: 10000 });
  assert.equal(
    await win2.getAttribute('#chat-frame', 'src'),
    'https://botrix.live/widgets/chat/?bid=E2EBID1',
  );
  t('restart loads the saved URL into the widget iframe');

  // 9. the X button quits the ENTIRE app (no survivors)
  let exited = false;
  app.process().once('exit', () => {
    exited = true;
  });
  await win2.click('#btn-close');
  for (let i = 0; i < 60 && !exited; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(exited, 'X button terminates the whole process');
  t('X button terminates the app completely');
  app = null;

  fs.rmSync(userData, { recursive: true, force: true });
  console.log(`\n# e2e pass ${n}`);
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[e2e] FAILED:', err && (err.stack || err.message));
  if (app) await app.close().catch(() => {});
  process.exit(1);
});
