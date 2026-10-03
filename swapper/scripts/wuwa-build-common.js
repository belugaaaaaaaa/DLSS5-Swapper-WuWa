'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const canonical = file => path.win32.normalize(String(file || '')).toLowerCase();
function options(argv = process.argv.slice(2)) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!/^--[a-z0-9-]+$/.test(argv[i] || '') || !argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('Arguments use --name <value>.');
    result[argv[i].slice(2)] = argv[i + 1];
  }
  return result;
}
function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function outputDirectory(value, inputRoots = [], targetExe = null) {
  const output = path.resolve(value);
  const targetRoot = targetExe ? path.resolve(path.dirname(targetExe), '../../../..') : null;
  if (output === path.parse(output).root || inside(output, root) || inputRoots.some(input => inside(input, output) || inside(output, input)) || (targetRoot && (inside(output, targetRoot) || inside(targetRoot, output)))) {
    throw Error('Build output must be separate from source/import inputs and the selected game installation.');
  }
  return output;
}
function exportsOf(file) {
  const bytes = fs.readFileSync(file), nt = bytes.readUInt32LE(0x3c);
  if (bytes.toString('ascii', nt, nt + 4) !== 'PE\0\0' || bytes.readUInt16LE(nt + 4) !== 0x8664) throw Error('Expected x64 PE: ' + file);
  const sections = bytes.readUInt16LE(nt + 6), optionalSize = bytes.readUInt16LE(nt + 20), optional = nt + 24;
  if (bytes.readUInt16LE(optional) !== 0x20b) throw Error('Expected PE32+: ' + file);
  const sectionBase = optional + optionalSize;
  const offset = rva => {
    if (rva < bytes.readUInt32LE(optional + 60)) return rva;
    for (let i = 0; i < sections; i++) {
      const section = sectionBase + 40 * i, start = bytes.readUInt32LE(section + 12);
      const size = Math.max(bytes.readUInt32LE(section + 8), bytes.readUInt32LE(section + 16));
      if (rva >= start && rva < start + size) return bytes.readUInt32LE(section + 20) + rva - start;
    }
    throw Error('PE RVA outside sections: ' + file);
  };
  const table = offset(bytes.readUInt32LE(optional + 112)), count = bytes.readUInt32LE(table + 24), names = offset(bytes.readUInt32LE(table + 32));
  return Array.from({ length: count }, (_, i) => {
    const start = offset(bytes.readUInt32LE(names + i * 4)), end = bytes.indexOf(0, start);
    if (end < start) throw Error('Invalid PE export string.');
    return bytes.toString('ascii', start, end);
  });
}
const officialPins = {
  'app.asar': '62cd88467f3b83e8fb049c3b520ae545ee7eeaf25de1ab43f7dc129603bba156',
  'payload/reshade-vulkan/ReShade64.dll': '0cee63f9c9f13f3ac909c5b4903f4dbb4b719a7ab3b4f13b0deaf83c814b94f7',
  'payload/streamline/nvngx_dlssnr.dll': '8270b350cd82de5ce89806872cdd6b6a9249b80836b91bbeb3573470744cc206',
  'payload/renodx-dlss5.addon64': 'd5adf82eb44b065f4c590ac91fe824bab07afea0eb9f994bde936710c8593952',
  'overlay/dlss5-lab-overlay.addon64': 'ee44897f85b191a03a61900de586b497fd27d2d53a3d859f2c242c6c7993dba7'
};
function validateOfficial(resources) {
  for (const [relative, expected] of Object.entries(officialPins)) if (sha256(path.join(resources, relative)) !== expected) throw Error('Original v2.2.7 resource mismatch: ' + relative);
}
function files(directory, relative = '') {
  return fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).flatMap(entry => {
    const name = path.join(relative, entry.name); return entry.isDirectory() ? files(directory, name) : [name];
  });
}
module.exports = { fs, path, root, sha256, canonical, options, inside, outputDirectory, exportsOf, officialPins, validateOfficial, files };
