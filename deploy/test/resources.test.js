/* SPDX-License-Identifier: MIT */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { downloadPinned, extractSevenZipPackage, prepareResources, safeCache, writeVerifiedCacheFile } = require('../lib/resources');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const parent = path.resolve(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'wuwa-resource-test-'));
  t.after(() => { assert.equal(path.dirname(root), parent); assert.match(path.basename(root), /^wuwa-resource-test-/); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
function tar(entries) {
  const blocks = [];
  for (const [name, type, data = Buffer.alloc(0)] of entries) {
    const header = Buffer.alloc(512); header.write(name, 0, 100);
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12); header.write(type, 156, 1);
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024)); return zlib.gzipSync(Buffer.concat(blocks));
}
test('verified download and cache reuse do not fetch twice', async t => {
  const root = fixture(t), bytes = Buffer.from('known file'), file = path.join(root, 'a.bin');
  const pin = { url: 'https://example.invalid/a.bin', filename: 'a.bin', sha256: digest(bytes), bytes: bytes.length };
  let calls = 0; const fetcher = async () => { calls++; return new Response(bytes); };
  await downloadPinned(pin, file, () => {}, fetcher); await downloadPinned(pin, file, () => {}, fetcher);
  assert.equal(calls, 1); assert.deepEqual(fs.readFileSync(file), bytes);
});
test('incorrect download never enables the final cache file', async t => {
  const root = fixture(t), file = path.join(root, 'a.bin');
  await assert.rejects(downloadPinned({url:'https://example.invalid/a.bin',filename:'a.bin',sha256:digest(Buffer.from('correct'))}, file, () => {}, async () => new Response('wrong')), /校验失败/);
  assert.equal(fs.existsSync(file), false); assert.deepEqual(fs.readdirSync(root), []);
});
test('offline failure clears only its partial file', async t => {
  const root=fixture(t), file=path.join(root,'a.bin'); fs.writeFileSync(path.join(root,'keep'),'sentinel');
  await assert.rejects(downloadPinned({url:'https://example.invalid/a.bin',filename:'a.bin',sha256:digest(Buffer.from('ok'))},file,()=>{},async()=>{throw Error('offline');}),/offline/);
  assert.deepEqual(fs.readdirSync(root), ['keep']);
});
test('download pins must use HTTPS and a complete SHA256', async t => {
  const file=path.join(fixture(t),'x');
  await assert.rejects(downloadPinned({url:'http://example.invalid',sha256:'a'.repeat(64)},file),/来源/);
  await assert.rejects(downloadPinned({url:'https://example.invalid',sha256:'bad'},file),/来源/);
});
test('tar traversal, symlinks, truncation, duplicates and missing licenses are rejected', t => {
  const root=fixture(t), exe='package/win/x64/7za.exe';
  assert.throws(()=>extractSevenZipPackage(tar([['../outside','0',Buffer.from('x')]]),root),/越界/);
  assert.throws(()=>extractSevenZipPackage(tar([[exe,'2']]),root),/链接/);
  assert.throws(()=>extractSevenZipPackage(tar([[exe,'0'],[exe,'0']]),root),/重复/);
  assert.throws(()=>extractSevenZipPackage(tar([[exe,'0']]),root),/许可缺失/);
  const header=Buffer.alloc(512); header.write('package/file'); header.write('00000001000\0',124,12); header[156]=48;
  assert.throws(()=>extractSevenZipPackage(zlib.gzipSync(header),root),/不完整/);
  assert.deepEqual(fs.readdirSync(root),[]);
});
test('wrong archive tool bytes are rejected before execution or extraction', t => {
  const root=fixture(t);
  assert.throws(()=>extractSevenZipPackage(tar([['package/win/x64/7za.exe','0',Buffer.from('fake exe')],['package/LICENSE.txt','0',Buffer.from('notice')]]),root),/工具校验/);
  assert.deepEqual(fs.readdirSync(root),[]);
});
test('wrong local original package is rejected without downloading', async t => {
  const root=fixture(t), original=path.join(root,'custom.exe'); fs.writeFileSync(original,'modified');
  await assert.rejects(prepareResources({cacheRoot:path.join(root,'cache'),officialPortable:original}),/未经修改/);
  assert.equal(fs.readFileSync(original,'utf8'),'modified');
});
test('cache root and directory junctions are refused', t => {
  const root=fixture(t);
  assert.throws(()=>safeCache('relative-cache'),/完整路径/);
  assert.throws(()=>safeCache(path.parse(root).root),/整个磁盘/);
  const outside=path.join(root,'outside'), link=path.join(root,'link'); fs.mkdirSync(outside);
  fs.symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>safeCache(path.join(link,'cache')), /链接|联接/);
  assert.deepEqual(fs.readdirSync(outside),[]);
});
test('cached tool leaves cannot overwrite a linked external file', t => {
  const root=fixture(t), original=path.join(root,'original'), linked=path.join(root,'tool.exe');
  fs.writeFileSync(original,'sentinel'); fs.linkSync(original,linked);
  assert.throws(()=>writeVerifiedCacheFile(linked,Buffer.from('new')),/链接|普通文件/);
  assert.equal(fs.readFileSync(original,'utf8'),'sentinel');
  const plain=path.join(root,'plain'); writeVerifiedCacheFile(plain,Buffer.from('known')); writeVerifiedCacheFile(plain,Buffer.from('known'));
  assert.throws(()=>writeVerifiedCacheFile(plain,Buffer.from('changed')),/已被修改/);
  assert.equal(fs.readFileSync(plain,'utf8'),'known');
});
