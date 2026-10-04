// SPDX-License-Identifier: MIT
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const official = require('../../swapper/scripts/wuwa-build-common');
const realWuWa = require('../../swapper/src/core/wuwa-install');
const journal = require('../../swapper/src/core/file-journal');
const compatibility = require('../../swapper/src/core/compatibility');
const pe = require('../../swapper/src/core/pe');

const NATIVE_TEMPLATE = 'renodx-dlss5-wuwa-template.addon64';
const NATIVE_NAME = 'renodx-dlss5.addon64';
const OVERLAY_NAME = 'dlss5-lab-overlay.addon64';
const DEFAULTS = Object.freeze({ NeuralUplift: '1', NRFollowInputRes: '0', NRResolutionScale: '0.85', WuWaCostMode: '1', NRPasses: '1', NRPreUpscale: '0', NRGpuTimers: '1' });
const COMPONENTS = Object.freeze({
  loader: { relative: 'payload/reshade-vulkan/ReShade64.dll', hash: official.officialPins['payload/reshade-vulkan/ReShade64.dll'] },
  runtime: { relative: 'payload/streamline/nvngx_dlssnr.dll', hash: official.officialPins['payload/streamline/nvngx_dlssnr.dll'] }
});
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const canonical = value => path.resolve(value).toLowerCase();
const inside = (parent, child) => {
  const relative = path.relative(canonical(parent), canonical(child));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
};
const overlaps = (left, right) => inside(left, right) || inside(right, left);
const failure = (code, message) => Object.assign(new Error(message), { code });

function absolute(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/.test(value) || value.length >= 260) throw failure('errUnsafePath', `${label}必须是有效的完整路径，且短于 260 个字符。`);
  const result = path.resolve(value);
  if (canonical(result) === canonical(path.parse(result).root)) throw failure('errUnsafePath', `${label}不能是磁盘根目录。`);
  return result;
}

// Check every existing ancestor, including ancestors above the selected root.
// Windows junctions are reported as symbolic links by Node; the production
// worker additionally checks FILE_ATTRIBUTE_REPARSE_POINT through PowerShell.
function assertNoLinks(value) {
  let current = path.resolve(value);
  for (;;) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw failure('errReparsePoint', '目录或文件包含符号链接/重解析点，请选择普通本地目录。'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function readJson(file) {
  assertNoLinks(file);
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > 1024 * 1024) throw failure('errManifestInvalid', '组件清单不是有效的小型文件。');
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function pinned(file, hash) {
  assertNoLinks(file);
  if (!/^[a-f0-9]{64}$/i.test(hash || '') || !fs.statSync(file).isFile() || digest(file) !== hash.toLowerCase()) throw failure('errComponentHash', '本地组件与发布清单不符，请重新取得完整部署助手。');
  return file;
}

function releaseSpec(spec, directory) {
  if (!spec || !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,99}$/.test(spec.release || '') || !/^[a-f0-9]{40}$/i.test(spec.sourceCommit || '') ||
      spec.nativeTemplate?.file !== NATIVE_TEMPLATE || spec.nativeTemplate?.metadata !== 'native-build-template.json' || spec.overlay?.file !== OVERLAY_NAME) throw failure('errBundleInvalid', '部署助手发布清单不兼容。');
  const template = pinned(path.join(directory, NATIVE_TEMPLATE), spec.nativeTemplate.sha256);
  const metadataPath = pinned(path.join(directory, 'native-build-template.json'), spec.nativeTemplate.metadataSha256);
  const overlayPath = pinned(path.join(directory, OVERLAY_NAME), spec.overlay.sha256);
  const metadata = readJson(metadataPath);
  if (metadata.nativeFile !== NATIVE_TEMPLATE || String(metadata.nativeSha256).toLowerCase() !== digest(template) || String(metadata.templateSha256).toLowerCase() !== digest(template) ||
      metadata.controlAbi !== 1 || metadata.stateBytes !== 376 || metadata.commandBytes !== 24 || metadata.experimentEnabled !== true || !/^[a-f0-9]{64}$/i.test(metadata.sourceSha256 || '')) throw failure('errBundleInvalid', '原生模板的 ABI、来源或哈希不匹配。');
  return { ...spec, directory, metadata, overlayPath };
}

function trustedReleases(templateRoot) {
  const bundle = readJson(path.join(templateRoot, 'bundle.json'));
  if (bundle.schema !== 1 || !Array.isArray(bundle.previousReleases || []) || (bundle.previousReleases || []).length > 32) throw failure('errBundleInvalid', '部署助手发布清单不兼容。');
  const releases = [releaseSpec(bundle, templateRoot)];
  for (const previous of bundle.previousReleases || []) {
    if (typeof previous.directory !== 'string' || path.isAbsolute(previous.directory) || previous.directory.includes(':')) throw failure('errBundleInvalid', '旧版本模板目录无效。');
    const directory = path.resolve(templateRoot, previous.directory);
    if (canonical(directory) === canonical(templateRoot) || !inside(templateRoot, directory)) throw failure('errBundleInvalid', '旧版本模板目录越界。');
    assertNoLinks(directory);
    releases.push(releaseSpec(previous, directory));
  }
  if (new Set(releases.map(item => item.release)).size !== releases.length) throw failure('errBundleInvalid', '发布清单包含重复版本。');
  return releases;
}

function writable(directory) {
  let existing = directory;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  try { fs.accessSync(existing, fs.constants.W_OK); }
  catch { throw failure('errNoWriteAccess', '当前目录没有写入权限，请关闭助手后用适当权限重新运行。'); }
}

function acquireLock(cacheRoot, key) {
  const file = path.join(cacheRoot, `.deploy-${key}.lock`);
  assertNoLinks(file);
  const token = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx');
      try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); } finally { fs.closeSync(fd); }
      return () => { try { if (readJson(file).token === token) fs.unlinkSync(file); } catch {} };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const lock = readJson(file);
      if (!Number.isInteger(lock.pid) || lock.pid <= 0) throw failure('errJobBusy', '部署锁无效，请关闭其他助手后检查本地缓存。');
      let alive = true;
      try { process.kill(lock.pid, 0); } catch (cause) { if (cause.code === 'ESRCH') alive = false; }
      if (alive || attempt !== 0) throw failure('errJobBusy', '同一目录已有部署任务，请等待当前任务结束。');
      fs.unlinkSync(file);
    }
  }
  throw failure('errJobBusy', '部署任务无法取得本地锁。');
}

function assertCached(resources, targetExe, release, expected, previous, wuwa) {
  for (const relative of ['payload/wuwa/manifest.json', `payload/wuwa/${NATIVE_NAME}`, `payload/wuwa/${OVERLAY_NAME}`, COMPONENTS.loader.relative, COMPONENTS.runtime.relative]) assertNoLinks(path.join(resources, relative));
  const spec = readJson(path.join(resources, 'payload/wuwa/manifest.json'));
  if (spec.revision !== release.release || canonical(spec.targetExe || '') !== canonical(targetExe) || spec.native?.sha256 !== expected.nativeSha256.toLowerCase() ||
      spec.overlay?.sha256 !== release.overlay.sha256.toLowerCase() || JSON.stringify(spec.defaults) !== JSON.stringify(DEFAULTS) ||
      JSON.stringify(spec.previousNativeSha256) !== JSON.stringify(previous.native) || JSON.stringify(spec.previousOverlaySha256) !== JSON.stringify(previous.overlay)) throw failure('errCachedPackage', '目标缓存与可信发布模板不符，本次未修改游戏。');
  const selectedRoot = targetExe.slice(0, targetExe.length - wuwa.TARGET_RELATIVE.length - 1);
  return wuwa.plan(resources, targetExe, selectedRoot);
}

function createDeployer(dependencies = {}) {
  // Injection belongs to in-process source tests. The worker accepts only the
  // documented request fields and never reads dependency hooks from JSON/env.
  const wuwa = dependencies.wuwa || realWuWa;
  const backendModule = () => require('../../swapper/src/core/backend-manager');
  const backends = dependencies.backends || {
    readManifest: (...args) => backendModule().readManifest(...args),
    install: (...args) => backendModule().install(...args),
    restore: (...args) => backendModule().restore(...args)
  };
  const validateOfficial = dependencies.validateOfficial || official.validateOfficial;
  const binder = () => dependencies.binder || require('./bind-native');
  const processClosed = dependencies.assertGameClosed || ((gameRoot, targetExe) => require('../worker').assertGameClosed(gameRoot, targetExe));
  const reparseCheck = dependencies.assertNoReparsePoints || (paths => require('../worker').assertNoReparsePoints(paths));
  const bitness = dependencies.getBitness || pe.getBitness;
  const prepareResources = dependencies.prepareResources || ((options, progress) => require('./resources').prepareResources(options, progress));

  return async function runDeployment(request, progress = () => {}) {
    if (!request || !['prepare', 'install', 'restore'].includes(request.action)) throw failure('errAction', '请选择准备、安装或卸载。');
    const action = request.action;
    const gameRoot = absolute(request.gameRoot, '鸣潮根目录');
    const cacheRoot = absolute(request.cacheRoot, '本地缓存目录');
    const templateRoot = absolute(request.templateRoot, '部署助手模板目录');
    const targetExe = path.join(gameRoot, wuwa.TARGET_RELATIVE);
    for (const value of [gameRoot, targetExe, cacheRoot, templateRoot, path.join(gameRoot, '_DLSS5_Backup')]) assertNoLinks(value);
    if (overlaps(gameRoot, cacheRoot) || overlaps(gameRoot, templateRoot) || overlaps(cacheRoot, templateRoot)) throw failure('errCacheIsolation', '缓存、部署助手与游戏目录必须互相独立。');
    if (!fs.statSync(gameRoot).isDirectory() || !fs.statSync(targetExe).isFile() || !wuwa.isTarget(targetExe, gameRoot) || bitness(targetExe) !== 64) throw failure('errWuWaTarget', '请选择包含真实 64 位鸣潮主程序的根目录。');
    if (fs.existsSync(journal.pendingPath(gameRoot))) throw failure('errBackendRecovery', '存在未完成的安装记录；为保护游戏原文件，本助手不会自动恢复或删除旧记录。请保留备份并先处理该记录。');
    compatibility.assertSafeTarget(gameRoot, targetExe);
    if (action === 'install') compatibility.assertAntiCheatConsent(gameRoot, targetExe, request.antiCheatAcknowledged);
    progress({ phase: 'checking', percent: 5, message: '正在检查目标目录与游戏进程。' });
    await reparseCheck([gameRoot, targetExe, cacheRoot, templateRoot, path.join(gameRoot, '_DLSS5_Backup')]);
    await processClosed(gameRoot, targetExe);
    writable(cacheRoot);
    if (action !== 'prepare') { writable(gameRoot); writable(path.dirname(targetExe)); }
    const releases = trustedReleases(templateRoot);
    const current = releases[0];
    const key = crypto.createHash('sha256').update(canonical(targetExe)).digest('hex').slice(0, 32);
    fs.mkdirSync(cacheRoot, { recursive: true });
    const unlock = acquireLock(cacheRoot, key);
    try {
      const bound = [];
      for (const release of releases) {
        const result = await binder().deriveBoundHash({ templateRoot: release.directory, targetExe });
        if (canonical(result.targetExe) !== canonical(targetExe) || !/^[a-f0-9]{64}$/i.test(result.nativeSha256 || '') || result.templateSha256.toLowerCase() !== release.nativeTemplate.sha256.toLowerCase() || result.sourceSha256.toLowerCase() !== release.metadata.sourceSha256.toLowerCase()) throw failure('errTargetBinding', '原生模板目标绑定验证失败。');
        bound.push(result);
      }
      const previous = { native: [...new Set(bound.slice(1).map(item => item.nativeSha256.toLowerCase()))], overlay: [...new Set(releases.slice(1).map(item => item.overlay.sha256.toLowerCase()))] };
      const targetCache = path.join(cacheRoot, 'targets', key);
      const cacheFor = release => path.join(targetCache, release.release, 'resources');
      let resources, bundle;
      if (action === 'restore') {
        progress({ phase: 'cache', percent: 30, message: '正在读取已校验的本机目标缓存，无需下载资源。' });
        const old = backends.readManifest(gameRoot);
        if (!old || old.wuwaIntegration?.restored) throw failure('errNoBackup', '没有需要卸载的鸣潮插件记录。');
        // A game manifest selects a candidate only; it contributes no hashes.
        const index = releases.findIndex(item => item.release === old.wuwaIntegration?.revision);
        if (index < 0 || !fs.existsSync(cacheFor(releases[index]))) throw failure('errRestoreCache', '此安装所需的可信目标缓存缺失；请保留备份，用对应部署助手版本恢复。卸载不会联网取得运行库。');
        resources = cacheFor(releases[index]);
        const older = { native: [...new Set(bound.slice(index + 1).map(item => item.nativeSha256.toLowerCase()))], overlay: [...new Set(releases.slice(index + 1).map(item => item.overlay.sha256.toLowerCase()))] };
        bundle = assertCached(resources, targetExe, releases[index], bound[index], older, wuwa);
      } else {
        resources = cacheFor(current);
        assertNoLinks(resources);
        if (fs.existsSync(resources)) {
          bundle = assertCached(resources, targetExe, current, bound[0], previous, wuwa);
          progress({ phase: 'cache', percent: 70, message: '已复验本机目标缓存。' });
        } else {
          progress({ phase: 'resources', percent: 15, message: '正在准备并校验原版本地资源。' });
          let source = request.officialResources;
          if (!source) source = await prepareResources({ cacheRoot, officialPortable: request.officialPortable }, progress);
          source = absolute(source, '原版资源目录');
          assertNoLinks(source);
          if (overlaps(source, gameRoot) || overlaps(source, templateRoot) || overlaps(source, path.join(targetCache, current.release))) throw failure('errCacheIsolation', '原版输入必须与游戏、模板和目标输出分开。');
          for (const relative of Object.keys(official.officialPins)) assertNoLinks(path.join(source, relative));
          await reparseCheck([source, ...Object.keys(official.officialPins).map(relative => path.join(source, relative))]);
          validateOfficial(source);
          const candidate = path.join(targetCache, `.preparing-${crypto.randomUUID()}`);
          assertNoLinks(candidate);
          fs.mkdirSync(candidate, { recursive: true });
          const staged = path.join(candidate, 'resources');
          const bundleDirectory = path.join(staged, 'payload/wuwa');
          fs.mkdirSync(bundleDirectory, { recursive: true });
          progress({ phase: 'binding', percent: 50, message: '正在为所选鸣潮完整路径绑定原生插件。' });
          const native = await binder().bindNative({ templateRoot, targetExe, outputRoot: path.join(candidate, 'bound') });
          if (canonical(native.targetExe) !== canonical(targetExe) || native.nativeSha256.toLowerCase() !== bound[0].nativeSha256.toLowerCase()) throw failure('errTargetBinding', '绑定产物与可信模板不符。');
          pinned(native.nativePath, native.nativeSha256);
          fs.copyFileSync(native.nativePath, path.join(bundleDirectory, NATIVE_NAME));
          fs.copyFileSync(current.overlayPath, path.join(bundleDirectory, OVERLAY_NAME));
          for (const item of Object.values(COMPONENTS)) {
            const destination = path.join(staged, item.relative);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(path.join(source, item.relative), destination);
          }
          const spec = { schema: 1, revision: current.release, controlAbi: 1, targetExe,
            native: { name: NATIVE_NAME, sha256: bound[0].nativeSha256.toLowerCase() }, overlay: { name: OVERLAY_NAME, sha256: current.overlay.sha256.toLowerCase() },
            previousNativeSha256: previous.native, previousOverlaySha256: previous.overlay, defaults: DEFAULTS };
          fs.writeFileSync(path.join(bundleDirectory, 'manifest.json'), JSON.stringify(spec, null, 2) + '\n');
          assertCached(staged, targetExe, current, bound[0], previous, wuwa);
          const destination = path.dirname(resources);
          assertNoLinks(destination);
          fs.mkdirSync(targetCache, { recursive: true });
          if (fs.existsSync(destination)) throw failure('errCachedPackage', '目标缓存目录已有不完整内容，本次未覆盖。');
          fs.renameSync(candidate, destination);
          bundle = assertCached(resources, targetExe, current, bound[0], previous, wuwa);
        }
      }
      if (action === 'prepare') return { ok: true, action, release: current.release, prepared: true, gameFilesChanged: false };
      await reparseCheck([gameRoot, targetExe, resources, path.join(gameRoot, '_DLSS5_Backup')]);
      await processClosed(gameRoot, targetExe);
      if (fs.existsSync(journal.pendingPath(gameRoot))) throw failure('errBackendRecovery', '准备期间出现未完成的安装记录，本次未修改游戏。');
      const config = { gameDir: gameRoot, exePath: targetExe, api: 'dxgi', apiLabel: 'DirectX 12', bitness: 64, route: 'native', antiCheatAcknowledged: request.antiCheatAcknowledged === true, wuwaBundle: bundle };
      progress({ phase: action, percent: 85, message: action === 'install' ? '正在安装已校验的鸣潮插件并保存备份。' : '正在卸载受管理的鸣潮插件并保留游戏原文件。' });
      const log = event => progress({ phase: action, percent: 90, message: event.code === 'addonInstalled' ? '已写入鸣潮增强插件。' : event.code === 'deleted' ? '已移除受管理的插件。' : '正在更新插件安装记录。' });
      if (action === 'install') {
        const old = backends.readManifest(gameRoot);
        wuwa.validateInstall(config, bundle, old);
        const manifest = await backends.install(config, log);
        return { ok: true, action, release: current.release, added: manifest.added.length, replaced: manifest.replaced.length, pluginOnly: true, gameRuntimeVerified: false };
      }
      if (!await backends.restore(gameRoot, log, { wuwaBundle: bundle })) throw failure('errNoBackup', '没有需要卸载的鸣潮插件记录。');
      return { ok: true, action, pluginOnly: true, loaderAndRuntimeRetained: true };
    } catch (error) {
      if (['EACCES', 'EPERM'].includes(error.code)) throw failure('errNoWriteAccess', '目录写入被拒绝；安装事务会保留可恢复记录。请确认权限或文件占用后重试。');
      throw error;
    } finally { unlock(); }
  };
}

module.exports = { runDeployment: createDeployer(), createDeployer, assertNoLinks, absolute, inside, overlaps, DEFAULTS, COMPONENTS };
