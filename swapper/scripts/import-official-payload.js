'use strict';
const common = require('./wuwa-build-common');
const { fs, path, root, options, outputDirectory, validateOfficial, officialPins, files } = common;
function importResources(resources, output) {
  resources = path.resolve(resources); validateOfficial(resources);
  output = outputDirectory(output, [resources]);
  if (fs.existsSync(output) && files(output).length) throw Error('Use a fresh/empty import output directory.');
  fs.mkdirSync(output, { recursive: true });
  for (const directory of ['payload', 'overlay']) fs.cpSync(path.join(resources, directory), path.join(output, directory), { recursive: true });
  // Retain the original archive only for local origin checks; it is excluded
  // from source publication and never copied into the adapted payload.
  fs.copyFileSync(path.join(resources, 'app.asar'), path.join(output, 'app.asar'));
  fs.writeFileSync(path.join(output, 'import.local.json'), JSON.stringify({ sourceVersion: '2.2.7', sourceResources: resources, pins: officialPins, licenseNotice: 'Local third-party components retain their own licenses; no redistribution permission is granted by this script.' }, null, 2) + '\n');
  return output;
}
if (require.main === module) {
  try {
    const args = options(); if (!args.resources) throw Error('Use --resources <locally extracted official v2.2.7 resources> [--out <local import directory>].');
    console.log(importResources(args.resources, args.out || path.join(root, 'build-local/imported-resources')));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { importResources };
