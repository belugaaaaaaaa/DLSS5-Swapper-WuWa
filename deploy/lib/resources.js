/* SPDX-License-Identifier: MIT */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const pins = require('../download-pins.json');
const { validateOfficial } = require('../../swapper/scripts/wuwa-build-common');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hashFile = async file => {
  const digest = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
};
function contained(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
}
function safeCache(root) {
  if (!root || !path.isAbsolute(root)) throw Error('缓存目录需要完整路径。');
  root = path.resolve(root);
  if (root === path.parse(root).root) throw Error('不能把整个磁盘作为缓存目录。');
  for (let dir = root; ; dir = path.dirname(dir)) {
    if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw Error('缓存目录不能经过链接或目录联接。');
    if (path.dirname(dir) === dir) break;
  }
  fs.mkdirSync(root, { recursive: true });
  return root;
}
async function downloadPinned(item, destination, progress = () => {}, fetcher = fetch) {
  if (!/^https:\/\//.test(item.url) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw Error('下载来源校验信息无效。');
  if (fs.existsSync(destination)) {
    if (fs.lstatSync(destination).isSymbolicLink()) throw Error('缓存文件不能是链接。');
    if (await hashFile(destination) === item.sha256) return destination;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = destination + '.' + crypto.randomUUID() + '.part';
  progress({ phase: 'download', message: '正在下载 ' + item.filename });
  try {
    const response = await fetcher(item.url, { signal: AbortSignal.timeout(600000), redirect: 'follow' });
    if (!response.ok || !response.body) throw Error('下载失败，可稍后重试或选择已有原版包。');
    let received = 0, last = 0;
    const stream = Readable.fromWeb(response.body);
    stream.on('data', bytes => {
      received += bytes.length;
      if (Date.now() - last > 1000) {
        last = Date.now();
        progress({ phase: 'download', message: '正在下载 ' + item.filename + '（' + Math.round(received / 1048576) + ' MB）' });
      }
    });
    await pipeline(stream, fs.createWriteStream(temporary, { flags: 'wx' }));
    if (await hashFile(temporary) !== item.sha256 || (item.bytes && received !== item.bytes)) throw Error('下载文件校验失败，本次没有安装。');
    fs.renameSync(temporary, destination);
    return destination;
  } catch (error) {
    // Only the exact newly created partial file belongs to this attempt.
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}
function extractSevenZipPackage(compressed, destination) {
  const tar = zlib.gunzipSync(compressed, { maxOutputLength: 32 * 1024 * 1024 });
  const wanted = new Set(['package/win/x64/7za.exe', 'package/LICENSE.txt', 'package/README.md']);
  const found = new Map();
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const rawName = field(0, 100), prefix = field(345, 155);
    const name = (prefix ? prefix + '/' : '') + rawName;
    const sizeText = field(124, 12).trim();
    if (!/^[0-7]+$/.test(sizeText)) throw Error('归档大小字段无效。');
    const size = parseInt(sizeText, 8), start = at + 512, end = start + size;
    if (!Number.isSafeInteger(size) || end > tar.length) throw Error('归档内容不完整。');
    if (name.startsWith('/') || name.includes('\\') || name.split('/').some(part => part === '..')) throw Error('归档路径越界。');
    const type = field(156, 1);
    if (type !== '0' && type !== '' && type !== '5') throw Error('归档包含不支持的链接或条目。');
    if (wanted.has(name)) {
      if (found.has(name) || type === '5') throw Error('归档条目重复或类型错误。');
      found.set(name, tar.subarray(start, end));
    }
    at = start + Math.ceil(size / 512) * 512;
  }
  if (!found.has('package/win/x64/7za.exe') || !found.has('package/LICENSE.txt')) throw Error('归档工具或许可缺失。');
  if (hash(found.get('package/win/x64/7za.exe')) !== pins.sevenZip.executableSha256) throw Error('归档工具校验失败。');
  fs.mkdirSync(destination, { recursive: true });
  for (const [name, bytes] of found) writeVerifiedCacheFile(path.join(destination, path.basename(name)), bytes);
  return path.join(destination, '7za.exe');
}
function writeVerifiedCacheFile(file, bytes) {
  safeCache(path.dirname(file));
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('缓存工具文件不能是链接或非普通文件。');
    if (hash(fs.readFileSync(file)) !== hash(bytes)) throw Error('缓存工具文件已被修改，请更换缓存目录后重试。');
    return;
  }
  fs.writeFileSync(file, bytes, { flag: 'wx' });
}
function findResources(root, depth = 0) {
  if (depth > 4) return null;
  try { validateOfficial(root); return root; } catch {}
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error('原版组件目录含链接，本次未使用。');
    if (entry.isDirectory()) { const result = findResources(path.join(root, entry.name), depth + 1); if (result) return result; }
  }
  return null;
}
async function prepareResources({ cacheRoot, officialPortable }, progress = () => {}) {
  const root = safeCache(cacheRoot), components = path.join(root, 'components', 'official-' + pins.officialSwapper.sha256);
  if (fs.existsSync(components)) {
    safeCache(components);
    const cached = findResources(components);
    if (cached) { progress({ phase: 'resources', message: '已验证本机缓存组件。' }); return cached; }
    throw Error('组件缓存已被修改。请更换缓存目录后重试；本次未写入游戏。');
  }
  safeCache(path.join(root, 'downloads'));
  safeCache(path.join(root, 'components'));
  let archive;
  if (officialPortable) {
    archive = path.resolve(officialPortable);
    if (!fs.existsSync(archive) || !fs.statSync(archive).isFile() || await hashFile(archive) !== pins.officialSwapper.sha256) throw Error('请选择未经修改的官方 Swapper v2.2.7 portable；已有鸣潮改版不能作为原版包。');
  } else archive = await downloadPinned(pins.officialSwapper, path.join(root, 'downloads', pins.officialSwapper.filename), progress);
  const toolPackage = await downloadPinned(pins.sevenZip, path.join(root, 'downloads', pins.sevenZip.filename), progress);
  const toolRoot = safeCache(path.join(root, 'tools', pins.sevenZip.sha256));
  const sevenZip = extractSevenZipPackage(fs.readFileSync(toolPackage), toolRoot);
  const attempt = path.join(root, 'components', '.prepare-' + crypto.randomUUID());
  fs.mkdirSync(attempt, { recursive: true });
  progress({ phase: 'resources', message: '正在提取并校验原版组件，不会运行原版程序。' });
  const extract = (source, output) => execFile(sevenZip, ['x', source, '-o' + output, '-y', '-bd', '-bb0'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 300000 });
  await extract(archive, attempt);
  let resources = findResources(attempt);
  if (!resources) {
    const embedded = [];
    function search(directory, depth = 0) {
      if (depth > 4) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw Error('原版归档含链接。');
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) search(file, depth + 1);
        else if (entry.name === 'app-64.7z') embedded.push(file);
      }
    }
    search(attempt);
    if (embedded.length !== 1) throw Error('未找到原版组件归档，本次没有安装。');
    await extract(embedded[0], path.join(attempt, 'application'));
    resources = findResources(attempt);
  }
  if (!resources || !contained(attempt, resources)) throw Error('原版组件完整校验失败，本次没有安装。');
  const relative = path.relative(attempt, resources);
  fs.renameSync(attempt, components);
  return path.join(components, relative);
}
module.exports = { prepareResources, downloadPinned, extractSevenZipPackage, findResources, safeCache, hashFile, writeVerifiedCacheFile };
