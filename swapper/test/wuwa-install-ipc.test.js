'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const workspace = path.resolve(__dirname, '..');
const appRoot = process.env.WUWA_TEST_APP_ROOT ? path.resolve(process.env.WUWA_TEST_APP_ROOT) : workspace;
const mainFile = path.join(appRoot, 'main.js');
const coreRoot = path.join(appRoot, 'src/core');
const realWuwa = require(path.join(coreRoot, 'wuwa-install'));
const core = require(path.join(coreRoot, 'apply'));
const journal = require(path.join(coreRoot, 'file-journal'));
const ini = require(path.join(coreRoot, 'feeder-config'));
const hashBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hashFile = file => hashBytes(fs.readFileSync(file));
const defaults = { NeuralUplift: '1', NRFollowInputRes: '0', NRResolutionScale: '0.85', WuWaCostMode: '1', NRPasses: '1', NRPreUpscale: '0', NRGpuTimers: '1' };
function loadModule(file, source, stubs) {
  const module = { exports: {} }, realRequire = createRequire(file);
  const context = vm.createContext({ require: name => stubs[name] || realRequire(name), module, exports: module.exports,
    __dirname: path.dirname(file), process, Buffer, console });
  vm.runInContext(source, context, { filename: file });
  return module.exports;
}
function fixture(t) {
  fs.mkdirSync(path.join(workspace, 'test-runs'), { recursive: true });
  const root = fs.mkdtempSync(path.join(workspace, 'test-runs', 'case-'));
  t.after(() => { const resolved = path.resolve(root); assert.ok(resolved.startsWith(path.join(workspace, 'test-runs') + path.sep)); fs.rmSync(resolved, { recursive: true, force: true }); });
  const gameDir = path.join(root, 'Wuthering Waves');
  const exeDir = path.join(gameDir, 'Wuthering Waves Game/Client/Binaries/Win64');
  const exePath = path.join(exeDir, 'Client-Win64-Shipping.exe');
  const resources = path.join(root, 'resources');
  const userData = path.join(root, 'userData');
  const bundleDir = path.join(resources, 'payload/wuwa');
  fs.mkdirSync(exeDir, { recursive: true }); fs.mkdirSync(bundleDir, { recursive: true }); fs.mkdirSync(userData);
  const protectedFiles = {
    [exePath]: Buffer.from('GAME EXE sentinel'),
    [path.join(exeDir, 'nvngx_dlss.dll')]: Buffer.from('GAME SR sentinel'),
    [path.join(exeDir, 'sl.interposer.dll')]: Buffer.from('GAME SL sentinel'),
    [path.join(gameDir, 'Wuthering Waves Game/Engine/Plugins/Runtime/Nvidia/DLSS/Binaries/ThirdParty/Win64/nvngx_dlss.dll')]: Buffer.from('GAME nested SR sentinel'),
    [path.join(gameDir, 'Wuthering Waves Game/Client/Saved/Config/WindowsNoEditor/GameUserSettings.ini')]: Buffer.from('GAME setting sentinel'),
    [path.join(gameDir, 'Wuthering Waves Game/Client/Content/Paks/game.pak')]: Buffer.from('GAME PAK sentinel')
  };
  for (const [file, bytes] of Object.entries(protectedFiles)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
  const bytes = { native: Buffer.from('new native fixture ABI1'), overlay: Buffer.from('new native F8 fixture ABI1'),
    loader: Buffer.from('official loader fixture'), runtime: Buffer.from('official NR fixture'), oldNative: Buffer.from('known old native'), oldOverlay: Buffer.from('known old overlay') };
  const spec = { schema: 1, revision: 'fixture-abi1', controlAbi: 1, targetExe: exePath,
    native: { name: 'renodx-dlss5.addon64', sha256: hashBytes(bytes.native) },
    overlay: { name: 'dlss5-lab-overlay.addon64', sha256: hashBytes(bytes.overlay) }, defaults };
  fs.writeFileSync(path.join(bundleDir, spec.native.name), bytes.native);
  fs.writeFileSync(path.join(bundleDir, spec.overlay.name), bytes.overlay);
  for (const [key, relative] of [['loader', 'reshade-vulkan/ReShade64.dll'], ['runtime', 'streamline/nvngx_dlssnr.dll']]) {
    const file = path.join(resources, 'payload', relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes[key]);
  }
  const writeSpec = () => fs.writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify(spec)); writeSpec();
  // Only replace pinned fixture bytes. Explicit selected-root recognition and
  // installer, backend manager, transaction engine, and main IPC execute their
  // real patched code. All game paths are isolated temporary fixtures.
  let helperSource = fs.readFileSync(path.join(coreRoot, 'wuwa-install.js'), 'utf8');
  helperSource = helperSource.replace('0cee63f9c9f13f3ac909c5b4903f4dbb4b719a7ab3b4f13b0deaf83c814b94f7', hashBytes(bytes.loader))
    .replace('8270b350cd82de5ce89806872cdd6b6a9249b80836b91bbeb3573470744cc206', hashBytes(bytes.runtime))
    .replace('d5adf82eb44b065f4c590ac91fe824bab07afea0eb9f994bde936710c8593952', hashBytes(bytes.oldNative))
    .replace('ee44897f85b191a03a61900de586b497fd27d2d53a3d859f2c242c6c7993dba7', hashBytes(bytes.oldOverlay));
  const wuwa = loadModule(path.join(coreRoot, 'wuwa-install.js'), helperSource, {});
  const backends = loadModule(path.join(coreRoot, 'backend-manager.js'), fs.readFileSync(path.join(coreRoot, 'backend-manager.js'), 'utf8'), { './wuwa-install': wuwa });
  const target = { rel: path.relative(gameDir, exePath), path: exePath, bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12', size: 1000 };
  const scan = { chosen: target, exeCandidates: [target], dlssFiles: [], streamlineFiles: [], primaryDlss: { rel: 'native/nvngx_dlss.dll' }, reshade: { installed: false } };
  const handlers = new Map(), messages = [], calls = { guard: 0, generic: 0, downloads: 0 }, running = { value: false };
  const realRequire = createRequire(mainFile);
  const stubs = {
    electron: { app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => userData, getVersion: () => '2.2.7' },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, dialog: { showMessageBox: async () => ({ response: 1 }) } },
    './src/core/wuwa-install': wuwa, './src/core/backend-manager': backends,
    './src/core/scan.js': { scanGame: async () => scan },
    './src/core/install-guards': { assertGameClosed: async () => { calls.guard++; if (running.value) throw Object.assign(Error('game running'), { code: 'errGameRunning' }); }, gpuInfo: async () => [], driverNeuralFault: () => false },
    './src/core/runtime-components.js': { missingVCRuntime: () => [], ensureLumenite: async () => { calls.downloads++; throw Error('must not download'); }, ensureDgVoodoo: async () => { calls.downloads++; throw Error('must not download'); } }
  };
  const processFixture = { ...process, resourcesPath: resources };
  const context = vm.createContext({ require: name => stubs[name] || realRequire(name), __dirname: appRoot, process: processFixture, Buffer, console, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(mainFile, 'utf8'), context, { filename: mainFile });
  vm.runInContext("payload = () => ({ source: {} }); companionAddons = () => { throw Error('must not select generic companions'); }; historyStore = { list() {}, record() {} };", context);
  const event = { sender: { send: (...args) => messages.push(args) } };
  const invoke = (route = 'native', api = 'd3d12') => handlers.get('install')(event, gameDir, exePath, route, api);
  const verifyProtected = () => { for (const [file, bytes] of Object.entries(protectedFiles)) assert.deepEqual(fs.readFileSync(file), bytes, file); };
  return { root, gameDir, exeDir, exePath, resources, bundleDir, bytes, spec, writeSpec, invoke, wuwa, backends, handlers, event, calls, running, verifyProtected };
}
fs.mkdirSync(path.join(workspace, 'test-runs'), { recursive: true });
test('production recognition requires an explicitly selected root and the full canonical Client path', () => {
  const root = path.resolve('sample-game-root'), exe = realWuwa.targetFor(root);
  assert.equal(realWuwa.isTarget(exe, root), true);
  assert.equal(realWuwa.isTarget(exe.toLowerCase(), root), true);
  assert.equal(realWuwa.isTarget(exe), false);
  assert.equal(realWuwa.isTarget(exe, path.resolve('another-root')), false);
  assert.equal(realWuwa.isTarget(path.join(root, 'OtherGame/Client/Binaries/Win64/Client-Win64-Shipping.exe'), root), false);
  assert.equal(realWuwa.isTarget(path.join(root, 'Wuthering Waves Game/Client/Binaries/Win64/../Client-Win64-Shipping.exe'), root), false);
});
test('actual install IPC fresh install adds only managed components, seeds defaults, and keeps game originals', async t => {
  const f = fixture(t), result = await f.invoke();
  assert.equal(result.ok, true); assert.equal(f.calls.guard, 2); assert.equal(f.calls.downloads, 0);
  for (const key of ['native', 'overlay']) assert.equal(hashFile(path.join(f.exeDir, f.spec[key].name)), f.spec[key].sha256);
  const text = fs.readFileSync(path.join(f.exeDir, 'ReShade.ini'), 'utf8');
  for (const [key, value] of Object.entries(defaults)) assert.equal(ini.getIni(text, 'RenoDX.DLSS5', key), value);
  const manifest = f.backends.readManifest(f.gameDir); assert.equal(manifest.wuwaIntegration.nativeF8, true); assert.equal(manifest.added.length, 5);
  f.verifyProtected();
});
test('actual IPC upgrades legacy overlay and manifest without touching old SR record; reinstall preserves chosen controls', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.exeDir, 'dxgi.dll'), f.bytes.loader); fs.writeFileSync(path.join(f.exeDir, 'nvngx_dlssnr.dll'), f.bytes.runtime);
  fs.writeFileSync(path.join(f.exeDir, 'renodx-dlss5.addon64'), f.bytes.oldNative);
  const oldOverlay = path.join(f.exeDir, 'dlss5-lab-overlay-ee44897f85b191a03.addon64'); fs.writeFileSync(oldOverlay, f.bytes.oldOverlay);
  const cfg = path.join(f.exeDir, 'ReShade.ini'); fs.writeFileSync(cfg, '[GENERAL]\r\nUserKey=preserve\r\n[RenoDX.DLSS5]\r\nNeuralUplift=0\r\nNRResolutionScale=0.72\r\n');
  const srRel = 'Wuthering Waves Game/Engine/Plugins/Runtime/Nvidia/DLSS/Binaries/ThirdParty/Win64/nvngx_dlss.dll';
  const legacy = { version: 1, route: 'native', game: { dir: f.gameDir, exe: path.relative(f.gameDir, f.exePath), api: 'dxgi' },
    replaced: [{ rel: srRel, oldVersion: '310.5', newVersion: '310.8' }], added: ['dxgi.dll', 'nvngx_dlssnr.dll', 'renodx-dlss5.addon64', path.relative(f.gameDir, oldOverlay)], addedDirs: [],
    reshade: { installedByUs: true, file: 'dxgi.dll', filesAdded: [] }, labOverlay: { sha256: hashBytes(f.bytes.oldOverlay), rel: path.relative(f.gameDir, oldOverlay) } };
  fs.mkdirSync(core.backupRoot(f.gameDir), { recursive: true }); fs.writeFileSync(path.join(core.backupRoot(f.gameDir), 'manifest.json'), JSON.stringify(legacy));
  assert.equal((await f.invoke()).ok, true); assert.equal(fs.existsSync(oldOverlay), false);
  assert.equal(JSON.stringify(f.backends.readManifest(f.gameDir).replaced[0]), JSON.stringify(legacy.replaced[0]));
  let text = fs.readFileSync(cfg, 'utf8'); assert.equal(ini.getIni(text, 'RenoDX.DLSS5', 'NeuralUplift'), '0'); assert.equal(ini.getIni(text, 'RenoDX.DLSS5', 'NRResolutionScale'), '0.72');
  text = ini.setIni(text, 'RenoDX.DLSS5', 'WuWaCostMode', '0'); fs.writeFileSync(cfg, text); const before = fs.readFileSync(cfg);
  assert.equal((await f.invoke()).ok, true); assert.deepEqual(fs.readFileSync(cfg), before); assert.equal(hashFile(path.join(f.exeDir, f.spec.native.name)), f.spec.native.sha256);
  f.verifyProtected();
});
test('actual IPC stops on running game or unsupported route before writes', async t => {
  const f = fixture(t); f.running.value = true; assert.equal((await f.invoke()).code, 'errGameRunning'); assert.equal(fs.existsSync(core.backupRoot(f.gameDir)), false);
  f.running.value = false; assert.equal((await f.invoke('feeder')).ok, false); assert.equal((await f.invoke('native', 'vulkan')).ok, false); assert.equal(fs.existsSync(core.backupRoot(f.gameDir)), false); f.verifyProtected();
});
test('unknown proxy and unknown add-on refuse without writes', async t => {
  const f = fixture(t), proxy = path.join(f.exeDir, 'dxgi.dll'); fs.writeFileSync(proxy, 'unknown proxy');
  assert.equal((await f.invoke()).ok, false); assert.equal(fs.readFileSync(proxy, 'utf8'), 'unknown proxy'); assert.equal(fs.existsSync(core.backupRoot(f.gameDir)), false);
  fs.unlinkSync(proxy); const addon = path.join(f.exeDir, 'renodx-dlss5.addon64'); fs.writeFileSync(addon, 'unknown addon');
  assert.equal((await f.invoke()).ok, false); assert.equal(fs.readFileSync(addon, 'utf8'), 'unknown addon'); assert.equal(fs.existsSync(core.backupRoot(f.gameDir)), false); f.verifyProtected();
});
test('payload hash failure is caught before guard and game writes', async t => {
  const f = fixture(t); fs.appendFileSync(path.join(f.bundleDir, f.spec.native.name), 'tamper');
  assert.equal((await f.invoke()).ok, false); assert.equal(f.calls.guard, 0); assert.equal(fs.existsSync(core.backupRoot(f.gameDir)), false); f.verifyProtected();
  fs.writeFileSync(path.join(f.bundleDir, f.spec.native.name), f.bytes.native);
  f.spec.targetExe = path.join(f.root, 'another-root', f.wuwa.TARGET_RELATIVE); f.writeSpec();
  assert.equal((await f.invoke()).ok, false); assert.equal(f.calls.guard, 0); assert.equal(fs.existsSync(core.backupRoot(f.gameDir)), false); f.verifyProtected();
});
test('copy failure rolls back real transaction and keeps previous configuration and manifest', async t => {
  const f = fixture(t); assert.equal((await f.invoke()).ok, true);
  const manifestFile = path.join(core.backupRoot(f.gameDir), 'manifest.json'), cfg = path.join(f.exeDir, 'ReShade.ini');
  const before = new Map([manifestFile, cfg, path.join(f.exeDir, f.spec.native.name), path.join(f.exeDir, f.spec.overlay.name)].map(file => [file, fs.readFileSync(file)]));
  const originalCopy = core.copyTracked;
  core.copyTracked = async (...args) => { if (path.basename(args[3]) === f.spec.overlay.name) throw Error('injected overlay copy failure'); return originalCopy(...args); };
  try { assert.equal((await f.invoke()).ok, false); } finally { core.copyTracked = originalCopy; }
  for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(file), bytes, file);
  assert.equal(fs.existsSync(journal.pendingPath(f.gameDir)), false); f.verifyProtected();
});
test('normal local update check stays in adapted edition and performs no remote download', async t => {
  const f = fixture(t), result = await f.handlers.get('update-check')(); assert.equal(result.newer, false); assert.equal(result.localIntegration, 'wuwa-abi1'); f.verifyProtected();
});
test('actual fresh restore and reinstall retains all seven tuned controls including NR off, mode 0, multipass and disabled timers', async t => {
  const f = fixture(t); assert.equal((await f.invoke()).ok, true);
  const cfg = path.join(f.exeDir, 'ReShade.ini');
  let text = fs.readFileSync(cfg, 'utf8');
  const selected = { NeuralUplift: '0', NRFollowInputRes: '1', NRResolutionScale: '0.67', WuWaCostMode: '0', NRPasses: '2', NRPreUpscale: '1', NRGpuTimers: '0' };
  for (const [key, value] of Object.entries(selected)) text = ini.setIni(text, 'RenoDX.DLSS5', key, value); fs.writeFileSync(cfg, text);
  const restored = await f.handlers.get('restore')(f.event, f.gameDir); assert.equal(restored.ok, true);
  assert.equal(fs.existsSync(cfg), false); f.verifyProtected();
  assert.equal((await f.invoke()).ok, true);
  text = fs.readFileSync(cfg, 'utf8'); for (const [key, value] of Object.entries(selected)) assert.equal(ini.getIni(text, 'RenoDX.DLSS5', key), value); f.verifyProtected();
});
test('actual IPC only removes loader-matching owned DisabledAddons tokens and preserves other names and comma escaping', async t => {
  const f = fixture(t), cfg = path.join(f.exeDir, 'ReShade.ini');
  const retained = ['RenoDX', 'DLSS 5 Neural Rendering', 'DLSS5 Lab Overlay', 'Other,, with comma@other.addon64', 'DLSS 5 Swapper Overlay@other.addon64', '@renodx-dlss5-COPY.addon64', 'Other@RENODX-DLSS5.ADDON64'];
  const removed = ['DLSS 5 Neural Rendering - 鸣潮专用实验版', 'DLSS 5 Swapper Overlay', '@renodx-dlss5.addon64', 'DLSS 5 Swapper Overlay@dlss5-lab-overlay.addon64', 'Anything@renodx-dlss5.addon64'];
  fs.writeFileSync(cfg, '[ADDON]\nAddonPath=.\\\nDisabledAddons=' + [...retained, ...removed].join(',') + '\n[OtherAddon]\nKeep=77\n');
  assert.equal((await f.invoke()).ok, true);
  let text = fs.readFileSync(cfg, 'utf8'); assert.equal(ini.getIni(text, 'ADDON', 'DisabledAddons'), retained.join(',')); assert.equal(ini.getIni(text, 'OtherAddon', 'Keep'), '77');
  assert.equal((await f.handlers.get('restore')(f.event, f.gameDir)).pluginOnly, true);
  text = fs.readFileSync(cfg, 'utf8'); assert.equal(ini.getIni(text, 'ADDON', 'DisabledAddons'), [...retained, ...removed].join(',')); assert.equal(ini.getIni(text, 'OtherAddon', 'Keep'), '77'); f.verifyProtected();
});
test('actual IPC refuses a different single AddonPath or BasePath before any write and keeps unrelated add-ons', async t => {
  const f = fixture(t), cfg = path.join(f.exeDir, 'ReShade.ini'), otherDir = path.join(f.root, 'sharedAddons'); fs.mkdirSync(otherDir);
  const unrelated = path.join(otherDir, 'unrelated.addon64'); fs.writeFileSync(unrelated, 'other add-on sentinel');
  for (const content of ['[ADDON]\nAddonPath=' + otherDir + '\n', '[INSTALL]\nBasePath=' + otherDir + '\n[ADDON]\nAddonPath=.\\\n']) {
    fs.writeFileSync(cfg, content); assert.equal((await f.invoke()).ok, false); assert.equal(fs.readFileSync(cfg, 'utf8'), content);
    assert.equal(fs.existsSync(core.backupRoot(f.gameDir)), false); assert.equal(fs.readFileSync(unrelated, 'utf8'), 'other add-on sentinel'); f.verifyProtected();
  }
  fs.writeFileSync(cfg, '[ADDON]\nAddonPath=..\\Win64\n'); assert.equal((await f.invoke()).ok, true); f.verifyProtected();
});
test('actual custom Restore retains current game SR bytes and historical SR backup records, removes only managed plugins, and preserves retuning', async t => {
  const f = fixture(t); assert.equal((await f.invoke()).ok, true);
  const manifestFile = path.join(core.backupRoot(f.gameDir), 'manifest.json'), old = f.backends.readManifest(f.gameDir);
  const srRel = path.relative(f.gameDir, path.join(f.exeDir, 'nvngx_dlss.dll'));
  const originalBackup = core.originalPath(f.gameDir, old, srRel); fs.mkdirSync(path.dirname(originalBackup), { recursive: true }); fs.writeFileSync(originalBackup, 'older ORIGINAL SR must not be copied back');
  old.replaced.push({ rel: srRel, oldVersion: '310.5', newVersion: '310.8', kind: 'dlss' }); fs.writeFileSync(manifestFile, JSON.stringify(old));
  const cfg = path.join(f.exeDir, 'ReShade.ini'); let text = fs.readFileSync(cfg, 'utf8'); text = ini.setIni(text, 'RenoDX.DLSS5', 'NRResolutionScale', '0.67'); text = ini.setIni(text, 'OtherAddon', 'Keep', 'unchanged'); fs.writeFileSync(cfg, text);
  const result = await f.handlers.get('restore')(f.event, f.gameDir); assert.equal(result.ok, true); assert.equal(result.pluginOnly, true);
  assert.equal(JSON.stringify(f.backends.readManifest(f.gameDir).replaced), JSON.stringify(old.replaced));
  for (const item of [f.spec.native, f.spec.overlay]) assert.equal(fs.existsSync(path.join(f.exeDir, item.name)), false);
  for (const key of ['loader', 'runtime']) assert.equal(hashFile(path.join(f.exeDir, key === 'loader' ? 'dxgi.dll' : 'nvngx_dlssnr.dll')), hashBytes(f.bytes[key]));
  assert.equal(ini.getIni(fs.readFileSync(cfg, 'utf8'), 'OtherAddon', 'Keep'), 'unchanged'); f.verifyProtected();
  assert.equal((await f.handlers.get('restore')(f.event, f.gameDir)).ok, false);
  assert.equal((await f.invoke()).ok, true); assert.equal(ini.getIni(fs.readFileSync(cfg, 'utf8'), 'RenoDX.DLSS5', 'NRResolutionScale'), '0.67');
  assert.equal(JSON.stringify(f.backends.readManifest(f.gameDir).replaced), JSON.stringify(old.replaced)); f.verifyProtected();
});
