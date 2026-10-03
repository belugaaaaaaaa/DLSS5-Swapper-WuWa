'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const workspace = path.resolve(__dirname, '..');
const appRoot = process.env.WUWA_TEST_APP_ROOT ? path.resolve(process.env.WUWA_TEST_APP_ROOT) : workspace;
fs.mkdirSync(path.join(workspace, 'test-runs'), { recursive: true });
test('actual legacy overlay bridge stays idle without a client and paints only while an old add-on is connected', async t => {
  const userData = fs.mkdtempSync(path.join(workspace, 'test-runs', 'overlay-'));
  t.after(() => { assert.ok(path.resolve(userData).startsWith(path.join(workspace, 'test-runs') + path.sep)); fs.rmSync(userData, { recursive: true, force: true }); });
  const painting = { active: false, starts: 0, stops: 0, paints: 0 };
  class FakeWindow extends EventEmitter {
    constructor() {
      super(); this.destroyed = false;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, { stopPainting: () => { painting.active = false; painting.stops++; },
        startPainting: () => { painting.active = true; painting.starts++; },
        setWindowOpenHandler() {}, setFrameRate() {}, send() {}, sendInputEvent() {}, enableDeviceEmulation() {},
        invalidate: () => { if (painting.active) painting.paints++; }, executeJavaScript: async () => 900 });
    }
    loadFile() { return Promise.resolve(); } setContentSize() {} isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  let connect;
  const server = new EventEmitter();
  Object.assign(server, { listen(_pipe, callback) { this.listening = true; callback(); }, close() { this.listening = false; } });
  const file = path.join(appRoot, 'src/overlay-bridge.js'), realRequire = createRequire(file), moduleFixture = { exports: {} };
  const stubs = { 'node:net': { createServer: callback => { connect = callback; return server; } },
    electron: { ipcMain: new EventEmitter() }, './overlay-preferences': { events: new EventEmitter(), read: () => ({ enabled: true }) } };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { require: name => stubs[name] || realRequire(name),
    module: moduleFixture, exports: moduleFixture.exports, __dirname: path.dirname(file), Buffer, console }, { filename: file });
  const bridge = await moduleFixture.exports({ BrowserWindow: FakeWindow, userData }); t.after(() => bridge.close());
  assert.equal(painting.starts, 0); assert.equal(painting.paints, 0); assert.equal(painting.active, false);
  const socket = new EventEmitter(); Object.assign(socket, { write() {}, destroy() { this.destroyed = true; this.emit('close'); } });
  connect(socket);
  assert.equal(painting.starts, 1); assert.equal(painting.active, true); assert.equal(painting.paints, 1);
  socket.destroy();
  assert.equal(painting.active, false); assert.equal(painting.stops, 2);
  bridge.window.webContents.invalidate(); assert.equal(painting.paints, 1);
});
