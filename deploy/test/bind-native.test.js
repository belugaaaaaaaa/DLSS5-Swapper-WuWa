/* Copyright (C) 2026; SPDX-License-Identifier: MIT */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { bindNative, deriveBoundHash, locateTargetSlot, canonicalTarget, EXPORT_NAME, MARKER } = require('../lib/bind-native');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// A disk-only PE fixture exercises malformed table bounds without running code.
// Its initialized target data has the same export contract as the real build.
function peFixture() {
  const bytes = Buffer.alloc(0xa00);
  bytes.writeUInt16LE(0x5a4d, 0); bytes.writeUInt32LE(0x80, 0x3c);
  bytes.writeUInt32LE(0x4550, 0x80); bytes.writeUInt16LE(0x8664, 0x84);
  bytes.writeUInt16LE(2, 0x86); bytes.writeUInt16LE(240, 0x94); bytes.writeUInt16LE(0x2022, 0x96);
  const optional = 0x98;
  bytes.writeUInt16LE(0x20b, optional); bytes.writeUInt32LE(0x200, optional + 60);
  bytes.writeUInt32LE(16, optional + 108); bytes.writeUInt32LE(0x1000, optional + 112); bytes.writeUInt32LE(0x180, optional + 116);
  for (const [index, rva, raw, name, flags] of [[0, 0x1000, 0x200, '.edata', 0x40000040], [1, 0x2000, 0x600, '.data', 0xc0000040]]) {
    const section = 0x188 + index * 40;
    bytes.write(name, section, 'ascii'); bytes.writeUInt32LE(0x400, section + 8);
    bytes.writeUInt32LE(rva, section + 12); bytes.writeUInt32LE(0x400, section + 16);
    bytes.writeUInt32LE(raw, section + 20); bytes.writeUInt32LE(flags, section + 36);
  }
  bytes.writeUInt32LE(1, 0x214); bytes.writeUInt32LE(1, 0x218);
  bytes.writeUInt32LE(0x1040, 0x21c); bytes.writeUInt32LE(0x1044, 0x220); bytes.writeUInt32LE(0x1048, 0x224);
  bytes.writeUInt32LE(0x2000, 0x240); bytes.writeUInt32LE(0x1080, 0x244); bytes.writeUInt16LE(0, 0x248);
  bytes.write(EXPORT_NAME, 0x280, 'ascii'); bytes.write(MARKER, 0x600, 'utf16le');
  return bytes;
}

function setup(t, bytes = peFixture(), overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wuwa-bind-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const templateRoot = path.join(root, 'template'); fs.mkdirSync(templateRoot);
  const targetExe = path.join(root, '鸣潮 游戏', 'Wuthering Waves Game', 'Client', 'Binaries', 'Win64', 'Client-Win64-Shipping.exe');
  fs.mkdirSync(path.dirname(targetExe), { recursive: true }); fs.writeFileSync(targetExe, 'original game fixture');
  const metadata = { nativeFile: 'template.addon64', nativeSha256: hash(bytes), templateSha256: hash(bytes), sourceSha256: 'a'.repeat(64),
    controlAbi: 1, stateBytes: 376, commandBytes: 24, experimentEnabled: true,
    targetBinding: { version: 1, export: EXPORT_NAME, characters: 260, marker: MARKER }, ...overrides };
  fs.writeFileSync(path.join(templateRoot, metadata.nativeFile), bytes);
  fs.writeFileSync(path.join(templateRoot, 'native-build-template.json'), JSON.stringify(metadata));
  return { root, templateRoot, targetExe, outputRoot: path.join(root, 'bound'), bytes, metadata };
}

test('binds only the slot, preserves template/game files and emits stage metadata', async t => {
  const fixture = setup(t), originalGame = fs.readFileSync(fixture.targetExe);
  const result = await bindNative(fixture), bound = fs.readFileSync(result.nativePath), slot = locateTargetSlot(bound);
  assert.equal(slot.offset, 0x600); assert.equal(slot.bytes, 520);
  assert.deepEqual(bound.subarray(0, slot.offset), fixture.bytes.subarray(0, slot.offset));
  assert.deepEqual(bound.subarray(slot.offset + slot.bytes), fixture.bytes.subarray(slot.offset + slot.bytes));
  assert.equal(bound.subarray(slot.offset, slot.offset + slot.bytes).toString('utf16le').split('\0')[0], fixture.targetExe);
  assert.equal(bound.readUInt16LE(slot.offset + fixture.targetExe.length * 2), 0);
  assert.equal(result.nativeSha256, hash(bound)); assert.equal(result.templateSha256, hash(fixture.bytes));
  assert.deepEqual(fs.readFileSync(fixture.targetExe), originalGame);
  assert.deepEqual(fs.readFileSync(path.join(fixture.templateRoot, 'template.addon64')), fixture.bytes);
  const metadata = JSON.parse(fs.readFileSync(result.nativeBuildPath));
  assert.equal(metadata.targetExe, fixture.targetExe); assert.equal(metadata.controlAbi, 1);
  assert.equal(metadata.stateBytes, 376); assert.equal(metadata.commandBytes, 24); assert.equal(metadata.experimentEnabled, true);
  assert.equal(metadata.nativeSha256, result.nativeSha256); assert.equal(metadata.sourceSha256, 'a'.repeat(64));
  assert.equal(deriveBoundHash(fixture).nativeSha256, result.nativeSha256);
});

test('same template binds two distinct full paths with different predictable hashes', async t => {
  const fixture = setup(t), secondExe = fixture.targetExe.replace('鸣潮 游戏', 'second-install');
  fs.mkdirSync(path.dirname(secondExe), { recursive: true }); fs.writeFileSync(secondExe, 'second game fixture');
  const first = await bindNative(fixture);
  const second = await bindNative({ ...fixture, targetExe: secondExe, outputRoot: path.join(fixture.root, 'bound-b') });
  assert.notEqual(first.nativeSha256, second.nativeSha256);
  assert.equal(second.nativeSha256, deriveBoundHash({ ...fixture, targetExe: secondExe }).nativeSha256);
});

test('refuses already-bound input even when its metadata hash is updated', async t => {
  const fixture = setup(t), result = await bindNative(fixture), bound = fs.readFileSync(result.nativePath);
  fs.writeFileSync(path.join(fixture.templateRoot, 'template.addon64'), bound);
  fs.writeFileSync(path.join(fixture.templateRoot, 'native-build-template.json'), JSON.stringify({ ...fixture.metadata, nativeSha256: hash(bound), templateSha256: hash(bound) }));
  await assert.rejects(bindNative({ ...fixture, outputRoot: path.join(fixture.root, 'rebind') }), /rebinding/);
});

test('complete SHA mismatch denies an otherwise valid altered template', async t => {
  const fixture = setup(t), changed = Buffer.from(fixture.bytes); changed[0x900] = 1;
  fs.writeFileSync(path.join(fixture.templateRoot, 'template.addon64'), changed);
  await assert.rejects(bindNative(fixture), /SHA256 mismatch/);
  assert.equal(fs.existsSync(fixture.outputRoot), false);
});

const malformed = [
  ['DOS signature', bytes => bytes.writeUInt16LE(0, 0), /MZ/],
  ['out of file NT header', bytes => bytes.writeUInt32LE(0xffffff00, 0x3c), /range/],
  ['wrong architecture', bytes => bytes.writeUInt16LE(0x14c, 0x84), /x64/],
  ['non DLL image', bytes => bytes.writeUInt16LE(0x22, 0x96), /DLL/],
  ['wrong optional header', bytes => bytes.writeUInt16LE(0x10b, 0x98), /PE32/],
  ['forwarded target', bytes => bytes.writeUInt32LE(0x1090, 0x240), /forwarder/],
  ['slot crosses section', bytes => bytes.writeUInt32LE(0x2300, 0x240), /section/],
  ['slot raw backing too short', bytes => bytes.writeUInt32LE(0x100, 0x1c0), /raw-data/],
  ['invalid export ordinal', bytes => bytes.writeUInt16LE(1, 0x248), /ordinal/],
  ['export names outside section', bytes => bytes.writeUInt32LE(0x9000, 0x244), /section/],
  ['overlapping sections', bytes => bytes.writeUInt32LE(0x1100, 0x1bc), /Overlapping/],
  ['code slot', bytes => bytes.writeUInt32LE(0xe0000060, 0x1d4), /not code/],
  ['missing export', bytes => bytes.write('Other_Name', 0x280, 'ascii'), /Missing/],
  ['unaligned slot', bytes => bytes.writeUInt32LE(0x2001, 0x240), /Unaligned/],
  ['signed template', bytes => bytes.writeUInt32LE(8, 0x98 + 148), /unsigned/],
  ['altered marker', bytes => bytes.writeUInt16LE(88, 0x600), /marker/],
  ['nonzero unused slot tail', bytes => bytes.writeUInt16LE(88, 0x600 + 518), /marker/],
];
for (const [name, mutate, expected] of malformed) {
  test('rejects ' + name + ' before output', async t => {
    const bytes = peFixture(); mutate(bytes); const fixture = setup(t, bytes);
    await assert.rejects(bindNative(fixture), expected); assert.equal(fs.existsSync(fixture.outputRoot), false);
  });
}

test('rejects truncated PE without native execution', () => {
  for (const length of [0, 63, 130, 400, 1536]) assert.throws(() => locateTargetSlot(peFixture().subarray(0, length)));
});

test('rejects bad metadata ABI, capacity, version and source pin', async t => {
  const fixture = setup(t);
  for (const replacement of [{ controlAbi: 2 }, { stateBytes: 375 }, { experimentEnabled: false }, { sourceSha256: 'x' },
    { targetExe: fixture.targetExe }, { nativeFile: '../template.addon64' },
    { targetBinding: { ...fixture.metadata.targetBinding, characters: 259 } }, { targetBinding: { ...fixture.metadata.targetBinding, version: 2 } }]) {
    fs.writeFileSync(path.join(fixture.templateRoot, 'native-build-template.json'), JSON.stringify({ ...fixture.metadata, ...replacement }));
    await assert.rejects(bindNative(fixture), /metadata/);
  }
});

test('rejects relative, root-relative, device, different-game, too-long and missing paths', async t => {
  const fixture = setup(t);
  for (const targetExe of ['.\\Client-Win64-Shipping.exe', '\\Client-Win64-Shipping.exe', '\\\\?\\C:\\game\\Client-Win64-Shipping.exe',
    fixture.targetExe.replace('Wuthering Waves Game', 'Other Unreal Game'), fixture.targetExe.replace('鸣潮 游戏', 'x'.repeat(260)),
    fixture.targetExe.replace('鸣潮 游戏', 'missing-install'), fixture.targetExe + '\0']) {
    await assert.rejects(bindNative({ ...fixture, targetExe }));
  }
  assert.equal(fs.existsSync(fixture.outputRoot), false);
});

test('normalizes case-independent separators without basename-wide acceptance', t => {
  const fixture = setup(t);
  assert.equal(canonicalTarget(fixture.targetExe.replaceAll('\\', '/')).targetExe, fixture.targetExe);
  assert.throws(() => canonicalTarget(path.join(fixture.root, 'Client-Win64-Shipping.exe')), /layout/);
});

test('rejects overlapping template/game/source outputs and nonempty reuse', async t => {
  const fixture = setup(t);
  for (const outputRoot of [fixture.templateRoot, path.join(fixture.templateRoot, 'output'), fixture.root, path.dirname(fixture.targetExe), path.parse(fixture.root).root]) {
    await assert.rejects(bindNative({ ...fixture, outputRoot }), /independent/);
  }
  fs.mkdirSync(fixture.outputRoot); fs.writeFileSync(path.join(fixture.outputRoot, 'unrelated.txt'), 'keep');
  await assert.rejects(bindNative(fixture), /empty directory/);
  assert.equal(fs.readFileSync(path.join(fixture.outputRoot, 'unrelated.txt'), 'utf8'), 'keep');
});

test('rejects a junction output without writing through it', async t => {
  const fixture = setup(t), destination = path.join(fixture.root, 'junction-destination'), junction = path.join(fixture.root, 'junction');
  fs.mkdirSync(destination); fs.symlinkSync(destination, junction, 'junction');
  await assert.rejects(bindNative({ ...fixture, outputRoot: path.join(junction, 'output') }), /symlink or junction/);
  assert.deepEqual(fs.readdirSync(destination), []);
});
