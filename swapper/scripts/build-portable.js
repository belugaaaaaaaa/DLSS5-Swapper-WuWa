'use strict';
const { fs, path, root, options, outputDirectory } = require('./wuwa-build-common');
const { execFileSync } = require('node:child_process');
async function main() {
  const args = options(); if (!args.resources) throw Error('Use --resources <staged resources> [--out <build output>].');
  const resources = path.resolve(args.resources);
  const spec = JSON.parse(fs.readFileSync(path.join(resources, 'payload/wuwa/manifest.json'), 'utf8'));
  const suffix = require('../src/core/wuwa-install').TARGET_RELATIVE;
  require('../src/core/wuwa-install').plan(resources, spec.targetExe, spec.targetExe.slice(0, spec.targetExe.length - suffix.length - 1));
  const electronDist = args['electron-dist'] ? path.resolve(args['electron-dist']) : null;
  if (electronDist) {
    const version = execFileSync(path.join(electronDist, 'electron.exe'), ['-p', 'process.versions.electron'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 15000, encoding: 'utf8'
    }).trim();
    if (version !== '33.4.11') throw Error('Explicit Electron runtime must be 33.4.11; found ' + version);
  }
  if (args['skip-executable-edit'] && !['true', 'false'].includes(args['skip-executable-edit'])) throw Error('--skip-executable-edit requires true or false.');
  const output = outputDirectory(args.out || path.join(root, 'build-local/dist'), [resources, ...(electronDist ? [electronDist] : [])], spec.targetExe);
  const { build, Platform } = require('electron-builder');
  process.env.ELECTRON_BUILDER_CACHE ||= path.join(root, 'build-local/electron-builder-cache');
  process.env.ELECTRON_CACHE ||= path.join(root, 'build-local/electron-cache');
  console.log(JSON.stringify(await build({ projectDir: root, targets: Platform.WINDOWS.createTarget('portable'), config: {
    electronVersion: '33.4.11', directories: { output },
    ...(electronDist ? { electronDist } : {}),
    files: ['main.js', 'preload.js', 'overlay-preload.js', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'src/**/*', 'assets/**/*', 'package.json'],
    extraResources: [{ from: path.join(resources, 'payload'), to: 'payload', filter: ['**/*'] }, { from: path.join(resources, 'overlay'), to: 'overlay', filter: ['**/*'] }],
    win: { target: ['portable'], icon: path.join(root, 'app_iocn.png'), ...(args['skip-executable-edit'] === 'true' ? { signAndEditExecutable: false } : {}) },
    portable: { artifactName: 'DLSS5-Swapper-${version}-wuwa-${arch}.${ext}', unpackDirName: 'DLSS5-Swapper-WuWa' }
  } })));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
