'use strict';

// A pinned, game-specific installation. This deliberately does not call the
// generic DLSS swapper: the game's own SR/SL libraries and settings stay outside
// this component's write set. All mutations use the existing backup journal.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('./apply');
const journal = require('./file-journal');
const ini = require('./feeder-config');
// Recognition always requires the root explicitly selected for this operation.
// A matching executable basename in another UE game is never enough.
const TARGET_RELATIVE = path.join('Wuthering Waves Game', 'Client', 'Binaries', 'Win64', 'Client-Win64-Shipping.exe');
const NATIVE_NAME = 'renodx-dlss5.addon64';
const OVERLAY_NAME = 'dlss5-lab-overlay.addon64';
const ADDON_NAMES = ['DLSS 5 Neural Rendering - 鸣潮专用实验版', 'DLSS 5 Swapper Overlay'];
const OLD_OVERLAYS = new Set([
  'ee44897f85b191a03a61900de586b497fd27d2d53a3d859f2c242c6c7993dba7',
  'f657d581ffec5e97e3ca90fa4195d41404ff00ddc71f323bc258dbf67f64ac37'
]);
const OLD_NATIVE = new Set([
  'd5adf82eb44b065f4c590ac91fe824bab07afea0eb9f994bde936710c8593952',
  '342341f669f1d64e0c70c8593a07a2fab5075e073dfae97c331c9a6776260a0a',
  'b33911e257f93023a9c0156dbbe3274f54db3566254b812beb2fbc3622a85433'
]);
const COMPONENTS = {
  loader: { name: 'dxgi.dll', source: 'reshade-vulkan/ReShade64.dll', hash: '0cee63f9c9f13f3ac909c5b4903f4dbb4b719a7ab3b4f13b0deaf83c814b94f7' },
  runtime: { name: 'nvngx_dlssnr.dll', source: 'streamline/nvngx_dlssnr.dll', hash: '8270b350cd82de5ce89806872cdd6b6a9249b80836b91bbeb3573470744cc206' }
};
const canonical = file => path.win32.normalize(String(file || '')).toLowerCase();
const targetFor = root => typeof root === 'string' && path.isAbsolute(root) ? path.join(path.resolve(root), TARGET_RELATIVE) : null;
const isTarget = (file, selectedRoot) => Boolean(targetFor(selectedRoot) && canonical(file) === canonical(targetFor(selectedRoot)));
const isRoot = root => Boolean(targetFor(root) && fs.existsSync(targetFor(root)));
const fail = (message, code = 'errWuWaIntegration') => Object.assign(new Error(message), { code });
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function pinned(file, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash || '') || !fs.existsSync(file) || sha256(file) !== hash) {
    throw fail('鸣潮本地组件校验失败，请使用完整的鸣潮优化版 Swapper。');
  }
  return file;
}
function plan(resourcesRoot, exePath, selectedRoot) {
  if (!isTarget(exePath, selectedRoot)) return null;
  const payloadRoot = path.join(resourcesRoot, 'payload');
  const bundleRoot = path.join(payloadRoot, 'wuwa');
  const spec = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'manifest.json'), 'utf8'));
  if (spec.schema !== 1 || spec.native?.name !== NATIVE_NAME || spec.overlay?.name !== OVERLAY_NAME ||
      !Number.isInteger(spec.controlAbi) || spec.controlAbi !== 1 ||
      typeof spec.revision !== 'string' || spec.revision.length > 100) throw fail('鸣潮本地组件清单不兼容。');
  if (!isTarget(spec.targetExe, selectedRoot) || canonical(spec.targetExe) !== canonical(exePath)) throw fail('鸣潮本地插件的构建目标与当前选择的游戏目录不同；请按当前程序路径构建并打包插件，本次未安装。');
  const result = {
    revision: spec.revision, controlAbi: spec.controlAbi, targetExe: spec.targetExe,
    native: { name: NATIVE_NAME, hash: spec.native.sha256, source: pinned(path.join(bundleRoot, NATIVE_NAME), spec.native.sha256) },
    overlay: { name: OVERLAY_NAME, hash: spec.overlay.sha256, source: pinned(path.join(bundleRoot, OVERLAY_NAME), spec.overlay.sha256) },
    defaults: spec.defaults || {},
    previousNative: spec.previousNativeSha256 || [],
    previousOverlay: spec.previousOverlaySha256 || []
  };
  for (const hashes of [result.previousNative, result.previousOverlay]) {
    if (!Array.isArray(hashes) || hashes.length > 32 || hashes.some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw fail('鸣潮组件升级清单无效。');
  }
  for (const [key, item] of Object.entries(COMPONENTS)) {
    result[key] = { ...item, source: pinned(path.join(payloadRoot, item.source), item.hash) };
  }
  // Config writes are restricted to the plugin's own section and simple numeric
  // values. Never let a resource manifest name a file or an unrelated INI key.
  for (const [key, value] of Object.entries(result.defaults)) {
    if (!['NeuralUplift', 'NRFollowInputRes', 'NRResolutionScale', 'WuWaCostMode', 'NRPasses', 'NRPreUpscale', 'NRGpuTimers'].includes(key) || !/^-?\d+(\.\d+)?$/.test(String(value))) {
      throw fail('鸣潮本地组件的配置清单无效。');
    }
  }
  return result;
}
function validateInstall(config, bundle, old) {
  if (!isTarget(config.exePath, config.gameDir) || !isRoot(config.gameDir) || config.route !== 'native' || config.api !== 'dxgi' || config.apiLabel !== 'DirectX 12' || config.bitness !== 64) {
    throw fail('当前鸣潮优化版仅支持已配置的鸣潮 Native DLSS / DirectX 12 路线。');
  }
  if (!bundle || bundle.controlAbi !== 1 || canonical(bundle.targetExe) !== canonical(config.exePath)) throw fail('鸣潮本地组件缺失或构建目标不匹配。');
  if (old && (old.route !== 'native' || canonical(journal.safePath(config.gameDir, old.game.exe)) !== canonical(config.exePath))) {
    throw fail('现有鸣潮安装路线不同；为保留原文件，本次未进行自动路线切换。');
  }
  const exeDir = path.dirname(config.exePath);
  validateSearchPath(exeDir, ini.readText(path.join(exeDir, 'ReShade.ini')));
  // Preflight every existing file before starting the journal or copying any
  // components. Unknown loader/runtime/add-ons are never silently overwritten.
  for (const key of ['loader', 'runtime']) {
    const item = bundle[key], dest = path.join(exeDir, item.name);
    if (fs.existsSync(dest) && sha256(dest) !== item.hash) throw fail(`鸣潮已有 ${item.name} 与本地组件不同，本次未覆盖。`);
  }
  const acceptedNative = new Set([...OLD_NATIVE, bundle.native.hash, ...(bundle.previousNative || [])]);
  const acceptedOverlay = new Set([...OLD_OVERLAYS, bundle.overlay.hash, ...(bundle.previousOverlay || [])]);
  const managedPaths = new Set([...(old?.added || []), ...(old?.replaced || []).map(item => item.rel), old?.labOverlay?.rel]
    .filter(item => typeof item === 'string').map(item => canonical(item)));
  for (const name of fs.readdirSync(exeDir)) {
    if (!/^renodx-dlss.*\.addon64$/i.test(name) && !/^dlss5-lab-overlay.*\.addon64$/i.test(name)) continue;
    const file = path.join(exeDir, name), hash = sha256(file);
    const accepted = /^renodx-dlss/i.test(name) ? acceptedNative : acceptedOverlay;
    if (!accepted.has(hash)) throw fail(`鸣潮已有未知插件 ${name}，本次未覆盖或删除。`);
    if (![NATIVE_NAME, OVERLAY_NAME].includes(name.toLowerCase()) && !managedPaths.has(canonical(path.relative(config.gameDir, file)))) {
      throw fail(`鸣潮已有未受此安装管理的插件副本 ${name}，本次未覆盖或删除。`);
    }
  }
}
function validateSearchPath(exeDir, text) {
  const addonPath = ini.getIni(text, 'ADDON', 'AddonPath');
  const basePath = ini.getIni(text, 'INSTALL', 'BasePath');
  const environmentBase = process.env.RESHADE_BASE_PATH_OVERRIDE;
  // ReShade 6.8 uses exactly one search directory. Moving it to the executable
  // would strand unrelated add-ons, so refuse before any journal/game writes.
  for (const override of [basePath, environmentBase, addonPath]) {
    if (override && canonical(path.resolve(exeDir, override)) !== canonical(exeDir)) {
      throw fail('ReShade 当前从其他目录读取配置或插件；为保留其他插件，本次未修改路径或安装。鸣潮优化插件需要当前游戏程序旁的插件目录。');
    }
  }
}
function listItems(value) {
  if (!value) return [];
  const result = []; let raw = '', decoded = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === ',' && value[i + 1] === ',') { raw += ',,'; decoded += ','; i++; }
    else if (value[i] === ',') { result.push({ raw, value: decoded }); raw = decoded = ''; }
    else { raw += value[i]; decoded += value[i]; }
  }
  result.push({ raw, value: decoded }); return result;
}
function blocksOwnedAddon(value) {
  const at = value.indexOf('@');
  // ReShade's pre-load filename check applies even if the name before @ does
  // not match NAME. Bare tokens are compared with the actual exported NAME.
  return at === -1 ? ADDON_NAMES.includes(value) : [NATIVE_NAME, OVERLAY_NAME].includes(value.slice(at + 1));
}
function configured(text, defaults, saved = '') {
  let out = String(text || '');
  // Keep all choices the player already made, including NR on/off and custom
  // appearance. Only seed missing keys in our versioned optimization controls.
  for (const [key, value] of Object.entries(defaults)) {
    if (ini.getIni(out, 'RenoDX.DLSS5', key) === null) {
      const previous = ini.getIni(saved, 'RenoDX.DLSS5', key);
      out = ini.setIni(out, 'RenoDX.DLSS5', key, previous !== null && /^-?\d+(\.\d+)?$/.test(previous) ? previous : String(value));
    }
  }
  const disabled = ini.getIni(out, 'ADDON', 'DisabledAddons');
  if (disabled !== null) {
    const items = listItems(disabled), kept = items.filter(item => !blocksOwnedAddon(item.value));
    if (kept.length !== items.length) out = ini.setIni(out, 'ADDON', 'DisabledAddons', kept.map(item => item.raw).join(','));
  }
  return out;
}
async function install(config, bundle, old, log = () => {}) {
  validateInstall(config, bundle, old);
  const exeDir = path.dirname(config.exePath);
  return journal.transaction(config.gameDir, async () => {
    const manifest = core.beginManifest(config.gameDir, config.exePath, config.api);
    manifest.route = 'native';
    // Keep old backupPrefix, replaced, added, and every original library record.
    manifest.game.bitness = 64;
    manifest.game.apiLabel = config.apiLabel;
    for (const name of fs.readdirSync(exeDir)) {
      if ((!/^renodx-dlss.*\.addon64$/i.test(name) || name.toLowerCase() === NATIVE_NAME) &&
          (!/^dlss5-lab-overlay.*\.addon64$/i.test(name) || name.toLowerCase() === OVERLAY_NAME)) continue;
      const file = path.join(exeDir, name);
      await core.trackBeforeWrite(manifest, config.gameDir, file, { kind: 'addon' });
      await core.saveActiveManifest(config.gameDir, manifest);
      await fs.promises.unlink(file);
    }
    for (const key of ['loader', 'runtime']) {
      const item = bundle[key], dest = path.join(exeDir, item.name);
      if (!fs.existsSync(dest)) {
        await core.copyTracked(manifest, config.gameDir, item.source, dest, { kind: key === 'loader' ? 'reshade' : 'runtime' });
        if (key === 'loader') { manifest.reshade.installedByUs = true; manifest.reshade.file = 'dxgi.dll'; }
      }
    }
    for (const item of [bundle.native, bundle.overlay]) {
      await core.copyTracked(manifest, config.gameDir, item.source, path.join(exeDir, item.name), { kind: 'addon' });
      log({ code: 'addonInstalled', params: { name: item.name === NATIVE_NAME ? '鸣潮优化版 DLSS 5' : '鸣潮 F8 优化面板' } });
    }
    const cfg = path.join(exeDir, 'ReShade.ini');
    const cfgExisted = fs.existsSync(cfg);
    const originalText = ini.readText(cfg);
    const saved = (config.wuwaProfile || {})[path.relative(config.gameDir, cfg)] || '';
    let text = configured(originalText, bundle.defaults, saved);
    if (!fs.existsSync(cfg)) text = ini.setIni(text, 'ADDON', 'AddonPath', '.\\');
    if (text !== originalText) await core.writeTracked(manifest, config.gameDir, cfg, text, { kind: 'config' });
    const prior = old?.wuwaIntegration && !old.wuwaIntegration.restored ? old.wuwaIntegration : null;
    manifest.wuwaIntegration = {
      revision: bundle.revision, controlAbi: bundle.controlAbi,
      nativeSha256: bundle.native.hash, overlaySha256: bundle.overlay.hash,
      localPayload: true, nativeF8: true, restored: false,
      configSeededKeys: prior?.configSeededKeys || Object.keys(bundle.defaults).filter(key => ini.getIni(originalText, 'RenoDX.DLSS5', key) === null),
      configWasAbsent: prior?.configWasAbsent ?? !cfgExisted,
      configSeededAddonPath: prior?.configSeededAddonPath ?? !cfgExisted,
      disabledRemoved: Array.from(new Set([...(prior?.disabledRemoved || []), ...listItems(ini.getIni(originalText, 'ADDON', 'DisabledAddons')).filter(item => blocksOwnedAddon(item.value)).map(item => item.raw)]))
    };
    const overlayRel = path.relative(config.gameDir, path.join(exeDir, OVERLAY_NAME));
    manifest.labOverlay = { ...(manifest.labOverlay || {}), rel: overlayRel, sha256: bundle.overlay.hash, nativeF8: true };
    await core.saveActiveManifest(config.gameDir, manifest);
    return manifest;
  });
}
function removeIniKey(text, section, key) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'; let current = '';
  return text.split(/\r?\n/).filter(line => {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/); if (header) current = header[1].toLowerCase();
    const entry = line.match(/^\s*([^;#][^=]*?)\s*=/);
    return !(current === section.toLowerCase() && entry && entry[1].trim().toLowerCase() === key.toLowerCase());
  }).join(newline);
}
async function restore(gameDir, bundle, old, log = () => {}, saveProfile = async () => {}) {
  const exePath = journal.safePath(gameDir, old.game.exe), exeDir = path.dirname(exePath);
  if (!isTarget(exePath, gameDir) || old.route !== 'native' || !bundle || canonical(bundle.targetExe) !== canonical(exePath)) throw fail('鸣潮插件备份或本地组件不兼容，本次未还原。');
  const known = new Set([...OLD_NATIVE, ...OLD_OVERLAYS, bundle.native.hash, bundle.overlay.hash, ...(bundle.previousNative || []), ...(bundle.previousOverlay || [])]);
  const managed = new Set([...(old.added || []), ...(old.replaced || []).map(item => item.rel), old.labOverlay?.rel].filter(rel => typeof rel === 'string').map(canonical));
  const addons = fs.readdirSync(exeDir).filter(name => /^(?:renodx-dlss|dlss5-lab-overlay).*\.addon64$/i.test(name)).map(name => path.join(exeDir, name))
    .filter(file => managed.has(canonical(path.relative(gameDir, file))));
  for (const file of addons) if (!known.has(sha256(file))) throw fail('鸣潮插件已被其他程序修改，本次未删除或还原。');
  return journal.transaction(gameDir, async () => {
    await saveProfile();
    for (const file of addons) { await journal.capture(gameDir, file); await fs.promises.unlink(file); log({ code: 'deleted', params: { rel: path.relative(gameDir, file) } }); }
    const state = old.wuwaIntegration || {}, cfg = path.join(exeDir, 'ReShade.ini');
    const before = ini.readText(cfg); let text = before;
    for (const key of state.configSeededKeys || []) if (['NeuralUplift', 'NRFollowInputRes', 'NRResolutionScale', 'WuWaCostMode', 'NRPasses', 'NRPreUpscale', 'NRGpuTimers'].includes(key)) text = removeIniKey(text, 'RenoDX.DLSS5', key);
    if (state.configSeededAddonPath && ini.getIni(text, 'ADDON', 'AddonPath') === '.\\') text = removeIniKey(text, 'ADDON', 'AddonPath');
    const current = listItems(ini.getIni(text, 'ADDON', 'DisabledAddons')), values = new Set(current.map(item => item.value));
    const restoreTokens = (state.disabledRemoved || []).filter(raw => typeof raw === 'string' && listItems(raw).length === 1 && blocksOwnedAddon(listItems(raw)[0].value) && !values.has(listItems(raw)[0].value));
    if (restoreTokens.length) text = ini.setIni(text, 'ADDON', 'DisabledAddons', [...current.map(item => item.raw), ...restoreTokens].join(','));
    if (text !== before) {
      await journal.capture(gameDir, cfg);
      if (state.configWasAbsent && !text.replace(/^\s*\[[^\]]+\]\s*$/gm, '').trim()) await fs.promises.unlink(cfg);
      else { await fs.promises.chmod(cfg, 0o666); await fs.promises.writeFile(cfg, text, 'utf8'); }
    }
    // Keep every historical replacement/backup record, including the game's
    // original SR DLL. This custom restore never calls generic restoreFiles.
    old.wuwaIntegration = { ...state, restored: true, nativeF8: false };
    await core.saveActiveManifest(gameDir, old);
    log({ code: 'restoreDone', params: { date: old.date, route: old.route, game: old.game, replaced: 0, added: addons.length, pluginOnly: true } });
    return true;
  });
}
module.exports = { TARGET_RELATIVE, targetFor, isTarget, isRoot, plan, validateInstall, configured, install, restore };
