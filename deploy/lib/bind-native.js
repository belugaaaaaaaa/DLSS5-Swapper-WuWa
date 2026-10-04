/* Copyright (C) 2026; SPDX-License-Identifier: MIT */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EXPORT_NAME = 'RenoDX_WuWa_TargetExe';
const CHARACTERS = 260;
const SLOT_BYTES = CHARACTERS * 2;
const MARKER = 'WUWA_UNBOUND_V1';
const TARGET_SUFFIX = '\\Wuthering Waves Game\\Client\\Binaries\\Win64\\Client-Win64-Shipping.exe';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};

// This parser never loads a DLL. All RVAs must resolve to raw bytes in exactly
// one section, and the full target buffer must be initialized, readable data.
function locateTargetSlot(bytes) {
  const range = (offset, length) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) throw Error('Truncated or invalid PE range.');
  };
  const u16 = offset => { range(offset, 2); return bytes.readUInt16LE(offset); };
  const u32 = offset => { range(offset, 4); return bytes.readUInt32LE(offset); };
  range(0, 64);
  if (u16(0) !== 0x5a4d) throw Error('Expected DOS MZ header.');
  const nt = u32(0x3c);
  if (nt < 64 || u32(nt) !== 0x00004550 || u16(nt + 4) !== 0x8664 || !(u16(nt + 22) & 0x2000)) throw Error('Expected x64 PE DLL template.');
  const count = u16(nt + 6), optionalSize = u16(nt + 20), optional = nt + 24;
  if (count < 1 || count > 96 || optionalSize < 240 || u16(optional) !== 0x20b) throw Error('Invalid PE32+ headers.');
  range(optional, optionalSize);
  if (u32(optional + 108) < 1) throw Error('Missing PE export directory.');
  if (u32(optional + 108) >= 5 && (u32(optional + 144) || u32(optional + 148))) throw Error('Target binding requires an unsigned self-owned template.');
  const headerSize = u32(optional + 60), sectionBase = optional + optionalSize;
  range(sectionBase, count * 40);
  if (headerSize < sectionBase + count * 40 || headerSize > bytes.length) throw Error('Invalid PE header size.');
  const sections = [];
  for (let index = 0; index < count; ++index) {
    const section = sectionBase + index * 40;
    const virtualSize = u32(section + 8), rva = u32(section + 12), rawSize = u32(section + 16), raw = u32(section + 20), flags = u32(section + 36);
    if (rva < headerSize || rva + Math.max(virtualSize, rawSize) > 0x100000000 || (rawSize && raw < headerSize)) throw Error('Invalid PE section range.');
    range(raw, rawSize);
    const current = { rva, virtualSize, rawSize, raw, flags };
    for (const previous of sections) {
      if (rva < previous.rva + Math.max(previous.virtualSize, previous.rawSize) && previous.rva < rva + Math.max(virtualSize, rawSize)) throw Error('Overlapping PE virtual sections.');
      if (rawSize && previous.rawSize && raw < previous.raw + previous.rawSize && previous.raw < raw + rawSize) throw Error('Overlapping PE raw sections.');
    }
    sections.push(current);
  }
  const map = (rva, length) => {
    if (!rva || !Number.isSafeInteger(length) || length < 1 || rva + length > 0x100000000) throw Error('Invalid PE RVA.');
    const matches = sections.filter(section => rva >= section.rva && rva + length <= section.rva + Math.max(section.virtualSize, section.rawSize));
    if (matches.length !== 1) throw Error('PE RVA outside a unique section.');
    const section = matches[0], delta = rva - section.rva;
    if (delta + length > section.rawSize) throw Error('PE RVA has no complete raw-data backing.');
    range(section.raw + delta, length);
    return { offset: section.raw + delta, section };
  };
  const string = rva => {
    const mapped = map(rva, 1);
    const remaining = mapped.section.raw + mapped.section.rawSize - mapped.offset;
    const end = bytes.indexOf(0, mapped.offset);
    if (end < mapped.offset || end >= mapped.offset + Math.min(remaining, 4096)) throw Error('Invalid PE export name.');
    return bytes.toString('ascii', mapped.offset, end);
  };
  const exportRva = u32(optional + 112), exportSize = u32(optional + 116);
  if (exportSize < 40 || exportRva + exportSize > 0x100000000) throw Error('Invalid export directory.');
  const table = map(exportRva, exportSize).offset;
  const functions = u32(table + 20), names = u32(table + 24);
  if (functions < 1 || functions > 65536 || names < 1 || names > functions) throw Error('Invalid export counts.');
  const functionTable = map(u32(table + 28), functions * 4).offset;
  const nameTable = map(u32(table + 32), names * 4).offset;
  const ordinalTable = map(u32(table + 36), names * 2).offset;
  let slotRva = null;
  for (let index = 0; index < names; ++index) {
    const ordinal = u16(ordinalTable + index * 2);
    if (ordinal >= functions) throw Error('Invalid export ordinal.');
    if (string(u32(nameTable + index * 4)) !== EXPORT_NAME) continue;
    if (slotRva !== null) throw Error('Duplicate target export.');
    slotRva = u32(functionTable + ordinal * 4);
  }
  if (slotRva === null) throw Error('Missing fixed target data export.');
  if (slotRva < exportRva + exportSize && slotRva + SLOT_BYTES > exportRva) throw Error('Target export is a forwarder or overlaps export metadata.');
  if (slotRva % 2) throw Error('Unaligned wchar_t target slot.');
  const mapped = map(slotRva, SLOT_BYTES);
  if (!(mapped.section.flags & 0x40000000) || !(mapped.section.flags & 0x40) || (mapped.section.flags & (0x20000000 | 0x20))) throw Error('Target slot must be readable initialized data, not code.');
  return { offset: mapped.offset, rva: slotRva, bytes: SLOT_BYTES };
}

function canonicalTarget(targetExe) {
  if (typeof targetExe !== 'string' || targetExe.includes('\0') || /[\u0001-\u001f]/.test(targetExe) || /^\\\\[?.]\\/.test(targetExe)) throw Error('Invalid target executable path.');
  const fullyQualified = /^[A-Za-z]:[\\/]/.test(targetExe) || /^\\\\[^\\/]+[\\/][^\\/]+[\\/]/.test(targetExe);
  if (!fullyQualified) throw Error('Target executable must have a fully qualified Windows path.');
  const canonical = path.win32.normalize(targetExe);
  if (canonical.length >= CHARACTERS) throw Error('Target executable is too long for the fixed slot.');
  if (!canonical.toLowerCase().endsWith(TARGET_SUFFIX.toLowerCase())) throw Error('Target is not the selected canonical WuWa Client layout.');
  let selectedRoot = path.win32.dirname(canonical);
  for (let index = 0; index < 4; ++index) selectedRoot = path.win32.dirname(selectedRoot);
  if (!selectedRoot || !path.win32.isAbsolute(selectedRoot)) throw Error('Missing selected WuWa root.');
  const stat = fs.lstatSync(canonical);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Target must be the actual existing Client executable.');
  return { targetExe: canonical, selectedRoot: path.resolve(selectedRoot) };
}

function prepareBinding({ templateRoot, targetExe }) {
  if (typeof templateRoot !== 'string' || !path.isAbsolute(templateRoot)) throw Error('Template directory must be absolute.');
  const directory = path.resolve(templateRoot);
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'native-build-template.json'), 'utf8').replace(/^\uFEFF/, ''));
  const binding = metadata.targetBinding;
  if (metadata.controlAbi !== 1 || metadata.stateBytes !== 376 || metadata.commandBytes !== 24 || metadata.experimentEnabled !== true ||
      !/^[a-f0-9]{64}$/i.test(metadata.sourceSha256 || '') || !/^[a-f0-9]{64}$/i.test(metadata.templateSha256 || '') ||
      String(metadata.nativeSha256).toLowerCase() !== String(metadata.templateSha256).toLowerCase() || metadata.targetExe !== undefined ||
      !binding || binding.version !== 1 || binding.export !== EXPORT_NAME || binding.characters !== CHARACTERS || binding.marker !== MARKER ||
      typeof metadata.nativeFile !== 'string' || path.basename(metadata.nativeFile) !== metadata.nativeFile || /[\\/]/.test(metadata.nativeFile)) throw Error('Invalid unbound native template metadata.');
  const templatePath = path.join(directory, metadata.nativeFile);
  if (fs.lstatSync(templatePath).isSymbolicLink() || !fs.lstatSync(templatePath).isFile()) throw Error('Template must be a regular file.');
  const bytes = fs.readFileSync(templatePath);
  const templateSha256 = digest(bytes);
  if (templateSha256 !== metadata.templateSha256.toLowerCase()) throw Error('Complete template SHA256 mismatch.');
  const slot = locateTargetSlot(bytes);
  const unbound = Buffer.alloc(SLOT_BYTES);
  unbound.write(MARKER, 0, 'utf16le');
  if (!bytes.subarray(slot.offset, slot.offset + SLOT_BYTES).equals(unbound)) throw Error('Target slot is not the original unbound marker; rebinding is refused.');
  const target = canonicalTarget(targetExe);
  const output = Buffer.from(bytes);
  output.fill(0, slot.offset, slot.offset + SLOT_BYTES);
  output.write(target.targetExe, slot.offset, SLOT_BYTES - 2, 'utf16le');
  // The only allowed difference is the exported 520-byte target buffer.
  if (!output.subarray(0, slot.offset).equals(bytes.subarray(0, slot.offset)) || !output.subarray(slot.offset + SLOT_BYTES).equals(bytes.subarray(slot.offset + SLOT_BYTES))) throw Error('Unexpected change outside the target slot.');
  const nativeSha256 = digest(output);
  return { bytes: output, directory, selectedRoot: target.selectedRoot, targetExe: target.targetExe, templateSha256, nativeSha256,
    sourceSha256: metadata.sourceSha256.toLowerCase(), slot, metadata };
}

function deriveBoundHash(options) {
  const prepared = prepareBinding(options);
  return { targetExe: prepared.targetExe, nativeSha256: prepared.nativeSha256, templateSha256: prepared.templateSha256, sourceSha256: prepared.sourceSha256 };
}

async function bindNative(options) {
  const prepared = prepareBinding(options);
  if (typeof options.outputRoot !== 'string' || !path.isAbsolute(options.outputRoot)) throw Error('Binding output directory must be absolute.');
  const outputRoot = path.resolve(options.outputRoot);
  const repository = path.resolve(__dirname, '../..');
  if (outputRoot === path.parse(outputRoot).root || inside(outputRoot, repository) ||
      [prepared.directory, prepared.selectedRoot].some(input => inside(input, outputRoot) || inside(outputRoot, input))) throw Error('Binding output must be independent of the template, source root and game installation.');
  // Reject junction/symlink destinations even when the final directory is absent.
  for (let ancestor = outputRoot; ; ancestor = path.dirname(ancestor)) {
    if (fs.existsSync(ancestor) && fs.lstatSync(ancestor).isSymbolicLink()) throw Error('Binding output cannot traverse a symlink or junction.');
    if (ancestor === path.dirname(ancestor)) break;
  }
  if (fs.existsSync(outputRoot) && (!fs.lstatSync(outputRoot).isDirectory() || fs.readdirSync(outputRoot).length)) throw Error('Binding output must be a new or empty directory.');
  fs.mkdirSync(outputRoot, { recursive: true });
  const nativeFile = 'renodx-dlss5-wuwa.addon64';
  const nativePath = path.join(outputRoot, nativeFile), nativeBuildPath = path.join(outputRoot, 'native-build.json');
  const record = { targetExe: prepared.targetExe, nativeFile, nativeSha256: prepared.nativeSha256, controlAbi: 1, stateBytes: 376,
    commandBytes: 24, experimentEnabled: true, sourceSha256: prepared.sourceSha256, templateSha256: prepared.templateSha256,
    targetBinding: { version: 1, export: EXPORT_NAME, characters: CHARACTERS, slotRva: prepared.slot.rva, slotOffset: prepared.slot.offset } };
  let wroteNative = false, wroteRecord = false;
  try {
    fs.writeFileSync(nativePath, prepared.bytes, { flag: 'wx' });
    wroteNative = true;
    fs.writeFileSync(nativeBuildPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    wroteRecord = true;
  } catch (error) {
    if (wroteRecord) fs.unlinkSync(nativeBuildPath);
    if (wroteNative) fs.unlinkSync(nativePath);
    throw error;
  }
  return { nativePath, nativeBuildPath, nativeSha256: prepared.nativeSha256, sourceSha256: prepared.sourceSha256,
    targetExe: prepared.targetExe, templateSha256: prepared.templateSha256 };
}

module.exports = { bindNative, deriveBoundHash, locateTargetSlot, canonicalTarget, EXPORT_NAME, CHARACTERS, MARKER };
