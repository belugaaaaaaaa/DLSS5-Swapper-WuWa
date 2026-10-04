// SPDX-License-Identifier: MIT
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { createDeployer } = require('../lib/deploy-core');
const worker = require('../worker');
const coreRoot = path.resolve(__dirname, '../../swapper/src/core');
const pins = require('../../swapper/scripts/wuwa-build-common').officialPins;
const ini = require('../../swapper/src/core/feeder-config');
const journal = require('../../swapper/src/core/file-journal');
const runs = path.join(__dirname, '../test-runs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hashFile = file => hash(fs.readFileSync(file));
const canonical = value => path.resolve(value).toLowerCase();

function moduleFrom(file, source, replacements) {
  const module = { exports: {} };
  const requireReal = createRequire(file);
  vm.runInNewContext(source, { require: name => Object.hasOwn(replacements, name) ? replacements[name] : requireReal(name), module, exports: module.exports, process, Buffer, console, __dirname: path.dirname(file) }, { filename: file });
  return module.exports;
}

function files(root, relative = '') {
  if (!fs.existsSync(root)) return {};
  const result = {};
  for (const item of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, item.name);
    if (item.isDirectory()) Object.assign(result, files(root, name));
    else result[name] = hashFile(path.join(root, name));
  }
  return result;
}

function fixture(t, extra = {}) {
  fs.mkdirSync(runs, { recursive: true });
  const base = fs.mkdtempSync(path.join(runs, 'deploy-'));
  t.after(() => { assert.ok(base.startsWith(path.resolve(runs) + path.sep)); fs.rmSync(base, { recursive: true, force: true }); });
  const gameRoot = path.join(base, 'game');
  const templateRoot = path.join(base, 'templates');
  const cacheRoot = path.join(base, 'cache');
  const officialResources = path.join(base, 'original');
  const targetExe = path.join(gameRoot, 'Wuthering Waves Game/Client/Binaries/Win64/Client-Win64-Shipping.exe');
  const exeDir = path.dirname(targetExe);
  fs.mkdirSync(exeDir, { recursive: true }); fs.mkdirSync(templateRoot);
  const exe = Buffer.alloc(512); exe.writeUInt16LE(0x5a4d, 0); exe.writeUInt32LE(0x80, 0x3c); exe.writeUInt32LE(0x4550, 0x80); exe.writeUInt16LE(0x8664, 0x84); exe.writeUInt16LE(240, 0x94); exe.writeUInt16LE(0x20b, 0x98);
  fs.writeFileSync(targetExe, exe);
  const protectedFiles = { [targetExe]: exe, [path.join(exeDir, 'nvngx_dlss.dll')]: Buffer.from('original SR'), [path.join(exeDir, 'sl.interposer.dll')]: Buffer.from('original Streamline'),
    [path.join(gameRoot, 'Wuthering Waves Game/Client/Content/Paks/game.pak')]: Buffer.from('original game'),
    [path.join(gameRoot, 'Wuthering Waves Game/Client/Saved/Config/WindowsNoEditor/GameUserSettings.ini')]: Buffer.from('original game settings') };
  for (const [file, bytes] of Object.entries(protectedFiles)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
  const fixturePins = {};
  for (const relative of Object.keys(pins)) {
    const content = Buffer.from('official fixture: ' + relative);
    const file = path.join(officialResources, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); fixturePins[relative] = hash(content);
  }
  function release(directory, name) {
    fs.mkdirSync(directory, { recursive: true });
    const nativeFile = 'renodx-dlss5-wuwa-template.addon64';
    const bytes = Buffer.from('native template fixture ' + name), overlay = Buffer.from('native F8 fixture ' + name);
    fs.writeFileSync(path.join(directory, nativeFile), bytes); fs.writeFileSync(path.join(directory, 'dlss5-lab-overlay.addon64'), overlay);
    const metadata = { nativeFile, nativeSha256: hash(bytes), templateSha256: hash(bytes), sourceSha256: hash(Buffer.from('source ' + name)), controlAbi: 1, stateBytes: 376, commandBytes: 24, experimentEnabled: true };
    fs.writeFileSync(path.join(directory, 'native-build-template.json'), JSON.stringify(metadata));
    return { release: name, sourceCommit: 'a'.repeat(40), nativeTemplate: { file: nativeFile, metadata: 'native-build-template.json', sha256: hash(bytes), metadataSha256: hashFile(path.join(directory, 'native-build-template.json')) }, overlay: { file: 'dlss5-lab-overlay.addon64', sha256: hash(overlay) } };
  }
  const bundle = { schema: 1, ...release(templateRoot, 'test-v2'), previousReleases: [] };
  const saveBundle = () => fs.writeFileSync(path.join(templateRoot, 'bundle.json'), JSON.stringify(bundle)); saveBundle();
  let wuwaSource = fs.readFileSync(path.join(coreRoot, 'wuwa-install.js'), 'utf8');
  for (const [relative, pin] of Object.entries(pins)) wuwaSource = wuwaSource.split(pin).join(fixturePins[relative]);
  const wuwa = moduleFrom(path.join(coreRoot, 'wuwa-install.js'), wuwaSource, {});
  const backends = moduleFrom(path.join(coreRoot, 'backend-manager.js'), fs.readFileSync(path.join(coreRoot, 'backend-manager.js'), 'utf8'), {
    './wuwa-install': wuwa,
    // Unreachable generic branch dependency only. WuWa's actual backend,
    // transaction, profile and installer code all execute unchanged.
    './optiscaler': { install() { throw Error('generic route must not run'); } }
  });
  const boundFor = ({ templateRoot: directory, targetExe: target }) => {
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'native-build-template.json')));
    const bytes = Buffer.concat([fs.readFileSync(path.join(directory, metadata.nativeFile)), Buffer.from('\0' + canonical(target))]);
    return { bytes, nativeSha256: hash(bytes), templateSha256: metadata.templateSha256, sourceSha256: metadata.sourceSha256, targetExe: target };
  };
  const calls = { process: 0, prepare: 0, bind: 0, reparse: 0 };
  const deps = { wuwa, backends,
    validateOfficial(directory) { for (const [relative, pin] of Object.entries(fixturePins)) assert.equal(hashFile(path.join(directory, relative)), pin); },
    binder: { deriveBoundHash: boundFor, async bindNative(options) {
      calls.bind++; const result = boundFor(options); fs.mkdirSync(options.outputRoot, { recursive: true });
      const nativePath = path.join(options.outputRoot, 'renodx-dlss5-wuwa.addon64'); fs.writeFileSync(nativePath, result.bytes);
      const nativeBuildPath = path.join(options.outputRoot, 'native-build.json'); fs.writeFileSync(nativeBuildPath, JSON.stringify({ ...result, bytes: undefined }));
      return { ...result, bytes: undefined, nativePath, nativeBuildPath };
    } },
    async assertGameClosed() { calls.process++; }, async assertNoReparsePoints() { calls.reparse++; },
    async prepareResources() { calls.prepare++; return officialResources; }, ...extra };
  const request = { action: 'install', gameRoot, cacheRoot, officialResources, templateRoot, antiCheatAcknowledged: true };
  const verifyProtected = () => { for (const [file, content] of Object.entries(protectedFiles)) assert.deepEqual(fs.readFileSync(file), content); };
  return { base, request, deps, run: createDeployer(deps), targetExe, exeDir, gameRoot, cacheRoot, templateRoot, officialResources, protectedFiles, verifyProtected, calls, bundle, saveBundle, release, boundFor, backends, wuwa };
}

test('prepare uses actual minimum installer resources and makes zero game file changes', async t => {
  const f = fixture(t), before = files(f.gameRoot), events = [];
  const result = await f.run({ ...f.request, action: 'prepare' }, event => events.push(event));
  assert.equal(result.gameFilesChanged, false); assert.equal(result.prepared, true); assert.deepEqual(files(f.gameRoot), before);
  const resources = path.join(f.cacheRoot, 'targets', fs.readdirSync(path.join(f.cacheRoot, 'targets'))[0], f.bundle.release, 'resources');
  assert.deepEqual(Object.keys(files(resources)).sort(), ['payload/reshade-vulkan/ReShade64.dll', 'payload/streamline/nvngx_dlssnr.dll', 'payload/wuwa/dlss5-lab-overlay.addon64', 'payload/wuwa/manifest.json', 'payload/wuwa/renodx-dlss5.addon64'].map(name => name.split('/').join(path.sep)).sort());
  assert.equal(f.calls.bind, 1); assert.equal(f.calls.process, 1); assert.ok(events.some(event => event.phase === 'binding')); f.verifyProtected();
});

test('actual backend install, retuning, reinstall and offline restore preserve game originals', async t => {
  const f = fixture(t); assert.equal((await f.run(f.request)).ok, true);
  const config = path.join(f.exeDir, 'ReShade.ini'); let text = fs.readFileSync(config, 'utf8');
  text = ini.setIni(text, 'RenoDX.DLSS5', 'NRResolutionScale', '0.67'); text = ini.setIni(text, 'OtherAddon', 'Keep', 'yes'); fs.writeFileSync(config, text);
  assert.equal((await f.run(f.request)).ok, true); assert.equal(ini.getIni(fs.readFileSync(config, 'utf8'), 'RenoDX.DLSS5', 'NRResolutionScale'), '0.67');
  fs.rmSync(f.officialResources, { recursive: true });
  const restored = await f.run({ ...f.request, action: 'restore', officialResources: undefined });
  assert.equal(restored.ok, true); assert.equal(restored.loaderAndRuntimeRetained, true);
  for (const name of ['renodx-dlss5.addon64', 'dlss5-lab-overlay.addon64']) assert.equal(fs.existsSync(path.join(f.exeDir, name)), false);
  assert.equal(ini.getIni(fs.readFileSync(config, 'utf8'), 'OtherAddon', 'Keep'), 'yes'); assert.equal(f.calls.prepare, 0); f.verifyProtected();
  assert.equal((await f.run({ ...f.request, officialResources: undefined })).ok, true);
  assert.equal(ini.getIni(fs.readFileSync(config, 'utf8'), 'RenoDX.DLSS5', 'NRResolutionScale'), '0.67'); f.verifyProtected();
});

test('missing explicit resource directory invokes the resource module once before game writes', async t => {
  const f = fixture(t); const result = await f.run({ ...f.request, action: 'prepare', officialResources: undefined, officialPortable: 'local-original.exe' });
  assert.equal(result.prepared, true); assert.equal(f.calls.prepare, 1); f.verifyProtected();
});

test('resource hash and template metadata failures refuse before game writes', async t => {
  const f = fixture(t), before = files(f.gameRoot);
  fs.writeFileSync(path.join(f.officialResources, 'app.asar'), 'wrong'); await assert.rejects(f.run(f.request)); assert.deepEqual(files(f.gameRoot), before);
  fs.writeFileSync(path.join(f.templateRoot, 'native-build-template.json'), '{}'); await assert.rejects(f.run(f.request), { code: 'errComponentHash' }); assert.deepEqual(files(f.gameRoot), before);
});

test('unknown installed loader is preserved and blocks actual installation', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.exeDir, 'dxgi.dll'), 'unknown proxy'); const before = files(f.gameRoot);
  await assert.rejects(f.run(f.request)); assert.deepEqual(files(f.gameRoot), before); assert.equal(fs.existsSync(journal.pendingPath(f.gameRoot)), false); f.verifyProtected();
});

test('unknown installed addon is never accepted by adding its hash to game manifest', async t => {
  const f = fixture(t); await f.run(f.request);
  const changed = path.join(f.exeDir, 'renodx-dlss5.addon64'); fs.writeFileSync(changed, 'unknown addon');
  const manifestFile = path.join(f.gameRoot, '_DLSS5_Backup/manifest.json'); const manifest = JSON.parse(fs.readFileSync(manifestFile));
  manifest.wuwaIntegration.nativeSha256 = hashFile(changed); manifest.previousNativeSha256 = [hashFile(changed)]; fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const before = files(f.gameRoot); await assert.rejects(f.run(f.request)); assert.deepEqual(files(f.gameRoot), before);
});

test('cached output tampering is refused even when game manifest names that hash', async t => {
  const f = fixture(t); await f.run({ ...f.request, action: 'prepare' });
  const targets = path.join(f.cacheRoot, 'targets'), resources = path.join(targets, fs.readdirSync(targets)[0], f.bundle.release, 'resources');
  const manifestFile = path.join(resources, 'payload/wuwa/manifest.json'), spec = JSON.parse(fs.readFileSync(manifestFile)); spec.native.sha256 = 'b'.repeat(64); fs.writeFileSync(manifestFile, JSON.stringify(spec));
  const before = files(f.gameRoot); await assert.rejects(f.run(f.request), { code: 'errCachedPackage' }); assert.deepEqual(files(f.gameRoot), before);
});

test('running game refuses before resource preparation', async t => {
  const f = fixture(t, { assertGameClosed: async () => { throw Object.assign(Error('game is running'), { code: 'errGameRunning' }); } });
  await assert.rejects(f.run({ ...f.request, officialResources: undefined }), { code: 'errGameRunning' }); assert.equal(f.calls.prepare, 0); assert.equal(fs.existsSync(f.cacheRoot), false); f.verifyProtected();
});

test('game started during preparation refuses before actual backend write', async t => {
  const f = fixture(t); let checks = 0;
  f.deps.assertGameClosed = async () => { if (++checks === 2) throw Object.assign(Error('started while preparing'), { code: 'errGameRunning' }); };
  const before = files(f.gameRoot); await assert.rejects(createDeployer(f.deps)(f.request), { code: 'errGameRunning' }); assert.deepEqual(files(f.gameRoot), before);
});

test('pending journal is preserved and never automatically recovered', async t => {
  const f = fixture(t); fs.mkdirSync(path.dirname(journal.pendingPath(f.gameRoot)), { recursive: true }); fs.writeFileSync(journal.pendingPath(f.gameRoot), 'historical pending sentinel');
  const before = files(f.gameRoot); await assert.rejects(f.run(f.request), { code: 'errBackendRecovery' }); assert.deepEqual(files(f.gameRoot), before); assert.equal(fs.existsSync(f.cacheRoot), false);
});

test('cache/game overlap and relative roots refuse before any preparation', async t => {
  const f = fixture(t), before = files(f.gameRoot);
  await assert.rejects(f.run({ ...f.request, cacheRoot: path.join(f.gameRoot, 'cache') }), { code: 'errCacheIsolation' });
  await assert.rejects(f.run({ ...f.request, gameRoot: '.' }), { code: 'errUnsafePath' }); assert.deepEqual(files(f.gameRoot), before);
});

test('junction input is refused before game writes', async t => {
  const f = fixture(t); const linked = path.join(f.base, 'linked-game'); fs.symlinkSync(f.gameRoot, linked, 'junction');
  await assert.rejects(f.run({ ...f.request, gameRoot: linked }), { code: 'errReparsePoint' }); f.verifyProtected();
});

test('copy failure executes the actual journal rollback and preserves prior tuning', async t => {
  const f = fixture(t); await f.run(f.request); const before = files(f.gameRoot); const copyFile = fs.promises.copyFile;
  fs.promises.copyFile = async (source, destination, ...args) => {
    if (path.basename(destination) === 'dlss5-lab-overlay.addon64' && source.includes('resources')) throw Error('injected copy failure');
    return copyFile(source, destination, ...args);
  };
  try { await assert.rejects(f.run(f.request), /injected copy failure/); } finally { fs.promises.copyFile = copyFile; }
  assert.deepEqual(files(f.gameRoot), before); assert.equal(fs.existsSync(journal.pendingPath(f.gameRoot)), false); f.verifyProtected();
});

test('trusted previous template derives target-specific upgrade hashes', async t => {
  const f = fixture(t); const current = { ...f.bundle }; const older = f.release(path.join(f.templateRoot, 'previous/v1'), 'test-v1');
  f.bundle.previousReleases = [{ ...older, directory: 'previous/v1' }]; f.saveBundle();
  const oldNative = f.boundFor({ templateRoot: path.join(f.templateRoot, 'previous/v1'), targetExe: f.targetExe });
  fs.writeFileSync(path.join(f.exeDir, 'renodx-dlss5.addon64'), oldNative.bytes);
  fs.writeFileSync(path.join(f.exeDir, 'dlss5-lab-overlay.addon64'), fs.readFileSync(path.join(f.templateRoot, 'previous/v1/dlss5-lab-overlay.addon64')));
  assert.equal((await f.run(f.request)).ok, true); assert.notEqual(hashFile(path.join(f.exeDir, 'renodx-dlss5.addon64')), oldNative.nativeSha256);
  assert.equal(f.bundle.release, current.release); f.verifyProtected();
});

test('restore missing trusted target cache never fetches resources', async t => {
  const f = fixture(t); await f.run(f.request); const targetFolder = path.join(f.cacheRoot, 'targets'); fs.renameSync(targetFolder, targetFolder + '.absent');
  const before = files(f.gameRoot); await assert.rejects(f.run({ ...f.request, action: 'restore', officialResources: undefined }), { code: 'errRestoreCache' }); assert.equal(f.calls.prepare, 0); assert.deepEqual(files(f.gameRoot), before);
});

test('worker accepts Windows PowerShell UTF8 BOM and publishes atomic progress/readback', async t => {
  const f = fixture(t); const request = path.join(f.base, 'request.json'), status = path.join(f.base, 'status.json'); fs.writeFileSync(request, '\uFEFF' + JSON.stringify({ ...f.request, action: 'prepare' }));
  await worker.main(['--request', request, '--status', status], { runDeployment: f.run }); const state = JSON.parse(fs.readFileSync(status));
  assert.equal(state.status, 'completed'); assert.equal(state.result.gameFilesChanged, false); assert.equal(state.percent, 100); assert.ok(state.sequence > 1); f.verifyProtected();
});

test('worker publishes structured failure and rejects injected request hooks', async t => {
  const f = fixture(t); const request = path.join(f.base, 'request.json'), status = path.join(f.base, 'status.json'); fs.writeFileSync(request, JSON.stringify(f.request));
  await assert.rejects(worker.main(['--request', request, '--status', status], { runDeployment: async () => { throw Object.assign(Error('fixture failure'), { code: 'errFixture' }); } }));
  assert.equal(JSON.parse(fs.readFileSync(status)).error.code, 'errFixture');
  fs.writeFileSync(request, JSON.stringify({ ...f.request, dependencies: {} })); await assert.rejects(worker.main(['--request', request, '--status', status]), { code: 'errArguments' }); f.verifyProtected();
});

test('worker cannot place its status file in the game or trusted bundle', async t => {
  const f = fixture(t); const request = path.join(f.base, 'request.json'); fs.writeFileSync(request, JSON.stringify(f.request));
  for (const status of [f.targetExe, path.join(f.templateRoot, 'bundle.json')]) await assert.rejects(worker.main(['--request', request, '--status', status]), { code: 'errUnsafePath' }); f.verifyProtected();
});

test('production process inspection fails closed when CIM fails', async t => {
  const f = fixture(t); const runner = (_file, _args, _options, callback) => callback(Error('CIM failed'));
  await assert.rejects(worker.assertGameClosed(f.gameRoot, f.targetExe, runner), { code: 'errProcessInspection' }); f.verifyProtected();
});

test('production process matcher uses full paths and rejects protected same-name process', async t => {
  const f = fixture(t); const runner = rows => (_file, _args, _options, callback) => callback(null, JSON.stringify([{ ProcessId: process.pid, Name: 'node.exe', ExecutablePath: process.execPath }, ...rows]));
  await worker.assertGameClosed(f.gameRoot, f.targetExe, runner([{ ProcessId: 900001, Name: 'Client-Win64-Shipping.exe', ExecutablePath: path.join(f.base, 'other-game/Client-Win64-Shipping.exe') }]));
  await assert.rejects(worker.assertGameClosed(f.gameRoot, f.targetExe, runner([{ ProcessId: 900001, Name: 'Client-Win64-Shipping.exe', ExecutablePath: null }])), { code: 'errGameRunning' });
  await assert.rejects(worker.assertGameClosed(f.gameRoot, f.targetExe, runner([{ ProcessId: 900001, Name: 'Client-Win64-Shipping.exe', ExecutablePath: f.targetExe }])), { code: 'errGameRunning' }); f.verifyProtected();
  await assert.rejects(worker.assertGameClosed(f.gameRoot, f.targetExe, runner([{ ProcessId: 900001, Name: 'Client-Win64-Shipping.exe', ExecutablePath: '\\\\?\\' + f.targetExe }])), { code: 'errGameRunning' });
});

test('default production reparse inspection runs on isolated fixture paths', async t => {
  const f = fixture(t); await worker.assertNoReparsePoints([f.gameRoot, f.targetExe, f.cacheRoot]);
  const linked = path.join(f.base, 'linked-cache'); fs.symlinkSync(f.templateRoot, linked, 'junction'); await assert.rejects(worker.assertNoReparsePoints([linked])); f.verifyProtected();
});

test('malformed CIM paths fail closed instead of being interpreted as relative paths', async t => {
  const f = fixture(t); const runner = (_file, _args, _options, callback) => callback(null, JSON.stringify([{ ProcessId: 900001, Name: 'game.exe', ExecutablePath: 'relative/game.exe' }]));
  await assert.rejects(worker.assertGameClosed(f.gameRoot, f.targetExe, runner), { code: 'errProcessInspection' }); f.verifyProtected();
});

test('actual worker CLI records template failure without stdout or game changes', async t => {
  const f = fixture(t), before = files(f.gameRoot), request = path.join(f.base, 'request.json'), status = path.join(f.base, 'status.json');
  // This synthetic byte template deliberately fails the real PE binder. The
  // production worker still exercises BOM decoding and real process/reparse
  // inspection, without a test hook entering through the request file.
  fs.writeFileSync(request, '\uFEFF' + JSON.stringify({ ...f.request, action: 'prepare' }));
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../worker.js'), '--request', request, '--status', status], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  assert.equal(JSON.parse(fs.readFileSync(status)).status, 'failed'); assert.deepEqual(files(f.gameRoot), before);
});

test('restore keeps historical SR backup records and never copies old SR into the game', async t => {
  const f = fixture(t); await f.run(f.request); const file = path.join(f.gameRoot, '_DLSS5_Backup/manifest.json'); const manifest = JSON.parse(fs.readFileSync(file));
  const relative = path.relative(f.gameRoot, path.join(f.exeDir, 'nvngx_dlss.dll'));
  manifest.replaced.push({ rel: relative, kind: 'dlss', oldVersion: 'old', newVersion: 'new' });
  const backup = path.join(f.gameRoot, '_DLSS5_Backup', manifest.backupPrefix, relative); fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.writeFileSync(backup, 'historical old SR must stay in backup');
  fs.writeFileSync(file, JSON.stringify(manifest)); await f.run({ ...f.request, action: 'restore' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).replaced, manifest.replaced); assert.equal(fs.readFileSync(backup, 'utf8'), 'historical old SR must stay in backup'); f.verifyProtected();
});

test('empty or incomplete process snapshots fail closed', async t => {
  const f = fixture(t); const runner = (_file, _args, _options, callback) => callback(null, '[]');
  await assert.rejects(worker.assertGameClosed(f.gameRoot, f.targetExe, runner), { code: 'errProcessInspection' }); f.verifyProtected();
});

test('existing anti-cheat acknowledgement policy is preserved before resource preparation', async t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.gameRoot, 'EasyAntiCheat')); const before = files(f.gameRoot);
  await assert.rejects(f.run({ ...f.request, officialResources: undefined, antiCheatAcknowledged: false }), { code: 'errAntiCheatConsent' }); assert.equal(f.calls.prepare, 0); assert.deepEqual(files(f.gameRoot), before);
});
