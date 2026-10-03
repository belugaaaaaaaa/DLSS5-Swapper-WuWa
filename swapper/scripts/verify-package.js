'use strict';
const { fs, path, root, sha256, options, files, outputDirectory } = require('./wuwa-build-common');
const { execFileSync } = require('node:child_process');
function main() {
  const args = options(); if (!args['unpacked-resources']) throw Error('Use --unpacked-resources <resources independently extracted from final portable> --staged-resources <staged resources> [--portable <exe>] [--out <local report directory>].');
  if (!args['staged-resources']) throw Error('Missing --staged-resources.');
  const resources = path.resolve(args['unpacked-resources']), staged = path.resolve(args['staged-resources']);
  const output = outputDirectory(args.out || path.join(root, 'build-local/verification'), [resources, staged]); fs.mkdirSync(output, { recursive: true });
  const archive = path.join(resources, 'app.asar'), asar = require('@electron/asar');
  const source = path.join(output, 'archive-source'); if (fs.existsSync(source)) throw Error('Use a fresh verification output directory.'); asar.extractAll(archive, source);
  const patched = ['main.js', 'src/core/backend-manager.js', 'src/core/wuwa-install.js', 'src/renderer/renderer.js', 'src/overlay-bridge.js'];
  for (const relative of patched) if (!asar.extractFile(archive, relative.split('/').join(path.sep)).equals(fs.readFileSync(path.join(root, relative)))) throw Error('Actual archived source differs: ' + relative);
  const packageSource = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packageArchived = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  if (packageArchived.name !== packageSource.name || packageArchived.version !== packageSource.version ||
      (packageArchived.productName && packageArchived.productName !== packageSource.build.productName)) throw Error('Archived fork package identity mismatch.');
  const spec = JSON.parse(fs.readFileSync(path.join(resources, 'payload/wuwa/manifest.json'), 'utf8'));
  const helper = require(path.join(source, 'src/core/wuwa-install')), suffix = helper.TARGET_RELATIVE;
  const plan = helper.plan(resources, spec.targetExe, spec.targetExe.slice(0, spec.targetExe.length - suffix.length - 1));
  const only = files(path.join(resources, 'payload/wuwa')).sort();
  if (JSON.stringify(only) !== JSON.stringify(['dlss5-lab-overlay.addon64', 'manifest.json', 'renodx-dlss5.addon64'])) throw Error('Unexpected dedicated payload file.');
  for (const directory of ['payload', 'overlay']) {
    const expectedFiles = files(path.join(staged, directory)).sort(), actualFiles = files(path.join(resources, directory)).sort();
    if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) throw Error('Archived resource inventory differs: ' + directory);
    for (const relative of expectedFiles) if (sha256(path.join(staged, directory, relative)) !== sha256(path.join(resources, directory, relative))) throw Error('Archived resource differs from staging: ' + directory + '/' + relative);
  }
  const testOutput = execFileSync(process.execPath, ['--test', '--test-concurrency=1', path.join(root, 'test/wuwa-install-ipc.test.js'), path.join(root, 'test/overlay-idle.test.js')], { env: { ...process.env, WUWA_TEST_APP_ROOT: source }, encoding: 'utf8', windowsHide: true });
  const summary = {}; for (const key of ['tests', 'pass', 'fail']) { const match = testOutput.match(new RegExp('(?:^|\\n)(?:#|ℹ) ' + key + ' (\\d+)(?:\\r?\\n|$)')); if (!match) throw Error('Unreadable actual test summary.'); summary[key] = Number(match[1]); }
  const report = { revision: spec.revision, targetExe: spec.targetExe, archiveSha256: sha256(archive), nativeSha256: plan.native.hash, overlaySha256: plan.overlay.hash,
    portableSha256: args.portable ? sha256(path.resolve(args.portable)) : null,
    packageIdentity: { name: packageArchived.name, version: packageArchived.version, productName: packageSource.build.productName, appId: packageSource.build.appId },
    archiveSourcesChecked: patched, dedicatedPayloadFiles: only, actualArchivedIpcTests: summary, testOutput, actualGameExecutionVerified: false };
  fs.writeFileSync(path.join(output, 'verification.local.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
}
try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
