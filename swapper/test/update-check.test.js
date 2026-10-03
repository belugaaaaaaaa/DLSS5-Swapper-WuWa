'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

// Execute the real main IPC. The fork must not suggest replacing its local
// integration with an upstream generic release or perform an update request.
function load(t, { version = '2.2.1', fetchImpl } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const main = path.resolve(__dirname, '../main.js');
  const realRequire = createRequire(main);
  const handlers = new Map();
  const calls = { count: 0 };
  const stubs = {
    electron: {
      app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => root, getVersion: () => version },
      BrowserWindow: { fromWebContents: () => null },
      Menu: { buildFromTemplate: () => ({ popup() {} }) },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      dialog: { showMessageBox: async () => ({ response: 1 }) },
      clipboard: { writeText() {} }
    },
    './src/core/scan.js': { scanGame: async () => ({ chosen: null, exeCandidates: [] }), scanSource: () => ({ ok: false }) }
  };
  const context = vm.createContext({
    require: name => stubs[name] || realRequire(name),
    __dirname: path.dirname(main), process, Buffer, console, setTimeout, clearTimeout,
    AbortSignal,
    fetch: async (...args) => { calls.count++; return fetchImpl(...args); }
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
  return { handlers, calls };
}

const release = (tag) => ({ ok: true, json: async () => ({ tag_name: tag }) });

test('upstream generic releases are not offered by the WuWa fork', async (t) => {
  for (const tag of ['v2.2.2', 'v2.3.0', 'v3.0.0', 'v2.2.1', 'v2.2.0', 'v2.10.0']) {
    const { handlers, calls } = load(t, { fetchImpl: async () => release(tag) });
    const answer = await handlers.get('update-check')();
    assert.equal(answer.newer, false);
    assert.equal(answer.current, '2.2.1');
    assert.equal(answer.latest, null);
    assert.equal(answer.localIntegration, 'wuwa-abi1');
    assert.equal(calls.count, 0);
  }
});

test('repeated update IPC calls do not make a remote request', async (t) => {
  const { handlers, calls } = load(t, { fetchImpl: async () => release('v9.0.0') });
  const first = await handlers.get('update-check')();
  const second = await handlers.get('update-check')();
  assert.equal(first.newer, false);
  assert.deepEqual(second, first);
  assert.equal(calls.count, 0);
});

test('being offline, rate-limited or blocked says nothing at all', async (t) => {
  for (const fetchImpl of [
    async () => { throw new Error('getaddrinfo ENOTFOUND'); },
    async () => ({ ok: false, status: 403 }),
    async () => ({ ok: true, json: async () => ({}) })
  ]) {
    const { handlers } = load(t, { fetchImpl });
    const answer = await handlers.get('update-check')();
    assert.equal(answer.newer, false, 'no notice is shown');
    assert.equal(answer.current, '2.2.1', 'and the running version is still reported');
  }
});

test('the real renderer keeps the intentional local update policy quiet', async () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf8');
  const start = renderer.indexOf('async function showUpdateNotice()');
  const end = renderer.indexOf('\nfunction jobLog(', start);
  assert.ok(start >= 0 && end > start);
  for (const [answer, expectedVisible, expectedText] of [
    [{ latest: null, newer: false, localIntegration: 'wuwa-abi1' }, false, ''],
    [{ latest: null, newer: false }, true, 'updateCheckFailed'],
    [{ latest: '2.2.3', newer: false }, false, ''],
    [{ latest: '2.2.3', newer: true }, true, 'updateAvailable:2.2.3']
  ]) {
    const classes = new Set(['hidden']);
    const link = { textContent: '', classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
    const context = vm.createContext({
      $: () => link, window: { lab: { checkUpdate: async () => answer } },
      t: (key, value) => value ? `${key}:${value}` : key
    });
    vm.runInContext(renderer.slice(start, end), context);
    await context.showUpdateNotice();
    assert.equal(!classes.has('hidden'), expectedVisible);
    assert.equal(link.textContent, expectedText);
  }
});
