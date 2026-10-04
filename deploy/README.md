# Deployment helper

This directory provides a Windows PowerShell 5 / Node deployment helper for the WuWa Native DLSS / DX12 route. Players use the release ZIP's root **`Start-Setup.cmd`**; see [中文使用说明](../docs/DEPLOYMENT.zh-CN.md). The source checkout has no bundled addons, and its GUI reports that a complete release package is required.

The helper obtains pinned Node.js, the official Swapper v2.2.7 portable archive, and the pinned 7zip-bin extraction tool in a local cache. A player may provide the exact official portable instead of downloading it. The archive is extracted, never executed. Third-party runtime/model files stay outside the public release ZIP. The helper binds the native template to the explicitly selected canonical WuWa EXE, verifies the result, and calls the same protected installation backend used by the source Swapper. F8 is native; no Swapper/Electron process is required while playing.

## Build the lightweight release

The release contains **all tracked source at an exact commit**, our unbound native template and native F8 addon, the pure production `extract-zip` dependency closure, and complete applicable licenses. It contains no NVIDIA runtime/models, original portable EXE, compiler, Node executable or 7-Zip executable. Read [component terms](THIRD_PARTY.md) before redistributing.

1. Prepare the fixed dependencies in [build/dependencies.json](../build/dependencies.json), following [build/README.md](../build/README.md). Build the native **unbound release template** and production overlay; do not use a path-bound addon or smoke-enabled overlay.
2. Prepare a separate production dependency directory from the Swapper lockfile using `npm ci --omit=dev --ignore-scripts`. `Build-Release.ps1` copies only `extract-zip` and its resolved dependencies/installed optional dependencies, not the other packages or development dependencies.
3. Obtain the **complete applicable** Microsoft toolchain/runtime and Windows SDK license texts for the build. A web page embedding a license document is not the document. Supply the actual complete text, RTF, DOCX or full HTML; keep original notices. This packaging check does not establish the builder's licensing eligibility.
4. Commit the release source. Supply its full 40-character Git commit ID, the input paths, and a **new or empty output directory outside all inputs/source**:

```powershell
.\deploy\Build-Release.ps1 `
  -TemplateDir <absolute-native-template-directory> `
  -OverlayFile <absolute-production-overlay-addon64> `
  -NativeRoot <absolute-pinned-renodx-root> `
  -OverlayReShadeRoot <absolute-pinned-reshade-root-or-prepared-sdk> `
  -ProductionNodeModules <absolute-production-node_modules> `
  -MicrosoftLicenseFiles <absolute-complete-toolchain-license>,<absolute-complete-sdk-license> `
  -OutRoot <absolute-empty-release-output> `
  -SourceCommit <40-character-commit> `
  -Release <safe-release-id>
```

The script performs no downloads and deletes no previous outputs. `git archive` supplies the exact committed source; links, submodules, generated binaries, receipts and personal paths are refused. Dependency HEADs must match the source's pins. The prepared overlay SDK option supplies its full ReShade license; its preparation and actual overlay build are validated separately. Microsoft's license inputs are deliberately explicit rather than copying an unrelated C++/WinRT license.

Generated layout:

```text
DLSS5-Swapper-WuWa-<release>.zip
  Start-Setup.cmd
  <full tracked source tree>
  node_modules/                    # production extract-zip closure only
  deploy/release-files.json        # relative file names, sizes and SHA256
  deploy/bundle/
    renodx-dlss5-wuwa-template.addon64
    native-build-template.json
    dlss5-lab-overlay.addon64
    bundle.json
    licenses/                     # full texts, notices and inventory
```

The output directory also contains the unpacked staging tree, a source snapshot archive, and `build-release.json` with the final ZIP hash. Publish only the named final ZIP after independent verification. No input path, game path, download cache or private build receipt belongs in the public package.

`bundle.json` schema 1 pins native template/metadata/overlay SHA256, release ID, and source commit. Native metadata requires ABI1, 376-byte state, 24-byte command, enabled experiment, source SHA, and a single versioned unbound target export. Initial packages have `previousReleases: []`; a future upgrade must add trusted old templates/overlays under the documented `previous/<id>` structure and revalidate them. A game manifest alone does not authorize an unknown old binary.

## Checks before publishing

Run the existing deployment tests, then independently extract the **newly created ZIP** and compare every `deploy/release-files.json` entry and `bundle.json` hash. Confirm there are only the two owned addon binaries and no third-party executable/runtime/model/compiler payload. Inspect the full license inventory and the actual unpacked PowerShell 5 GUI entry. Exercise the unpacked production worker in an isolated file-deployment target through prepare/install/reinstall/restore/reinstall; preserve original-file hashes and the NR-off/custom-scale settings. These tests do not replace real game/GPU/visual acceptance.

```powershell
node --test deploy/test/*.test.js
```

The deployment core accepts in-process hooks only in source tests. The production worker has an explicit JSON field allowlist and uses real process/reparse-point checks; it cannot accept dependency hooks from requests or environment variables. Full source backend coverage remains in [swapper/BUILD.md](../swapper/BUILD.md).

Current preview validation and remaining ZIP/GUI checks are stated in [DEPLOYMENT.zh-CN.md](../docs/DEPLOYMENT.zh-CN.md). Do not turn a packaging or PE-fixture success into a claim that NR/cache ran in the game.
