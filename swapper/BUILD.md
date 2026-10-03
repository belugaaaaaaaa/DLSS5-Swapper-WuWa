# Source build and local payload inputs

This developer workflow supports the community effort to reduce extra neural-rendering GPU work while keeping enjoyable image quality. For player-oriented use and feedback, start with the [player guide](../docs/PLAYERS.zh-CN.md); code contributions follow the [contribution guide](../CONTRIBUTING.md).

This is an experimental Windows/DX12 source fork. The public repository does not contain NVIDIA DLLs/models, an original Swapper executable, compiled add-ons, `node_modules`, game files, or personal deployment receipts. The MIT license covers the Swapper implementation; it does not relicense any locally imported third-party component. A successful source build or installer test does not establish in-game image quality, lower GPU load, or anti-cheat compatibility.

Use Node.js 22 or newer on Windows. Run `npm ci`, then `npm test`. The default suite needs no imported NVIDIA payload or game installation; a source-only run on Node 24.13.0 reported 293 tests, 291 passed, zero failed and two skipped because the optional sibling community-server source was absent. `npm run test:wuwa` runs the 13 focused checks. Electron 33.4.11 and electron-builder 25.1.8 are pinned in `package.json`; `@electron/asar` is pinned at 3.4.1. The focused tests execute the actual main IPC, backend manager, journal and installer against isolated temporary game fixtures. They cover selected-root recognition, target mismatch, default settings, old-manifest migration, rollback, original SR preservation, exact disabled-item handling and saved controls. Separate inherited `test:payload` and `test:optiscaler` commands require their corresponding external runtime inputs and are not part of the default suite.

## 1. Build the native add-on for the selected game

Follow the sibling native source package's `Build-Native.ps1` instructions. Pass your explicitly chosen full `Client-Win64-Shipping.exe` path as `-TargetExe`. The canonical layout under the root selected in Swapper is:

```text
<selected root>/Wuthering Waves Game/Client/Binaries/Win64/Client-Win64-Shipping.exe
```

The native builder must produce the enabled binary and a local `native-build.json` containing `targetExe`, `nativeSha256`, `controlAbi=1`, `stateBytes=376`, `commandBytes=24`, `experimentEnabled=true`, and `sourceSha256`. These local files can contain your installation path and must stay in a gitignored build directory. The installer compares the recorded target with the selected root again. A binary built for another installation is refused before game writes. Build the sibling production F8 overlay from source; use its normal production output, never its smoke/test variant.

## 2. Import the original components locally

Obtain the original official [Swapper v2.2.7 release](https://github.com/rakanki911/DLSS5-Swapper/releases/tag/v2.2.7) yourself and independently extract its portable package. Pass its `resources` directory explicitly. This repository neither downloads NVIDIA components nor grants permission to redistribute them.

```powershell
node scripts/import-official-payload.js --resources "<original extracted resources>" --out "build-local/imported-resources"
```

The importer verifies the original archive, loader, NR runtime, native add-on and old overlay against public SHA-256 pins. It copies only to a separate local build directory and retains the original license files. `scripts/collect-payload.js` is preserved as upstream source history, but is no longer the default `payload` or `prebuild` operation. The custom build requires the explicit local import.

## 3. Stage and package

```powershell
node scripts/stage-package.js --official-resources "build-local/imported-resources" --native "<your ON native binary>" --native-provenance "<your native-build.json>" --overlay "<your production F8 binary>" --revision "<release-id>" --out "build-local/staged-resources"
node scripts/build-portable.js --resources "build-local/staged-resources" --out "build-local/dist"
```

The default builder obtains the pinned Electron runtime through electron-builder. To reuse a trusted local Electron distribution without downloading it again, add `--electron-dist "<Electron distribution directory>"`; it must contain `electron.exe` and its normal runtime files. The builder executes that chosen runtime briefly with `ELECTRON_RUN_AS_NODE=1`, reads `process.versions.electron`, and refuses versions other than 33.4.11. An optional `--skip-executable-edit true` builds without updating Windows executable resources/signing; it does not change the application ID or ASAR source. This is useful for isolated packaging checks when the Windows signing/resource-edit tools are unavailable.

Staging requires a fresh empty output directory, checks ABI exports and native metadata, then creates only two dedicated add-ons and `payload/wuwa/manifest.json`. The manifest uses defaults `NRResolutionScale=0.85` and `WuWaCostMode=1`; all seven control defaults are applied only when missing. Existing NR-off, multipass, pre-SR and timer choices are preserved. The runtime is taken from the unchanged original local payload, never silently downloaded or upgraded during the WuWa install.

For a reviewed local update, `--previous-manifest <previous trusted staged manifest>` adds the previous component hashes to the upgrade allowlist. Do not use a manifest from a game directory as a trust source. Optional `--expected-native-sha256` and `--expected-overlay-sha256` enforce your own release pins. Imported DLLs/models and generated installers remain local; the default public release is source only.

The public fork uses `dlss5-swapper-wuwa`, product name `DLSS 5 Swapper WuWa`, app ID `io.github.belugaaaaaaaa.dlss5swapper.wuwa`, and portable extraction directory `DLSS5-Swapper-WuWa`. This isolates its user data and application identity from upstream Swapper. The builder includes only the explicitly staged payload/overlay resources; inherited source-tree payload/add-on folders are not automatic build inputs. The old general upstream overlay is retained only as a local imported component for existing source behavior; compatibility outside the dedicated WuWa F8 branch is not qualified here.

## 4. Verify the actual package

Independently extract the final portable with your own archive tool. Do not point this command at the staging directory as though it were an extracted release.

```powershell
node scripts/verify-package.js --unpacked-resources "<resources independently extracted from final portable>" --staged-resources "build-local/staged-resources" --portable "<final portable exe>" --out "build-local/verification"
```

Verification reads back the five changed application modules from the actual ASAR, compares the complete staged payload, validates the local two-add-on payload and target, and reruns the 13 actual IPC tests against the extracted application code. Its local report records test counts from the test runner output. It does not launch a game or claim live performance verification.

During normal WuWa installation, keep the game closed, select the same root used for the native build, and use Native DLSS / DirectX 12. Unsupported routes, unknown proxies/add-ons, mismatched build targets and a different single ReShade add-on/config directory refuse before writes. Existing game SR/SL libraries, executables, PAKs and game configuration stay outside the custom installer/restore write set. The custom “卸载鸣潮插件” action keeps historical SR backup records and current SR bytes, removes only managed known add-ons and seeded plugin configuration, and retains tuning for reinstall. The dedicated F8 panel renders inside the add-on and does not need Chromium texture streaming.
