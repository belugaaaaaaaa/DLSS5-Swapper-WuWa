# Windows source build

These tools support the community goal of reducing neural-rendering GPU overhead while keeping image quality players enjoy. They let contributors rebuild, test and review changes under documented conditions. Ordinary players can participate through [the player guide](../docs/PLAYERS.zh-CN.md); this chapter is for developers preparing matching local builds. The current public release has no universal ready-to-run installer.

Use **PowerShell7 (`pwsh`)**, Python3.10+, Git, and Windows x64. Windows PowerShell5.1 is not supported: these scripts use `Path.GetRelativePath` and `Path.IsPathFullyQualified` from modern .NET. The shader compiler calls Windows' `d3dcompiler_47.dll`; all21 included shader entry points target SM5.0/5.1, so FXC/DXC executables are not required for this snapshot.

The validated toolchain is Zig0.14.1/Clang19 targeting **`x86_64-windows-msvc`**, official Microsoft VC14.44.35207 headers/static CRT/linker, and the official Windows SDK NuGet10.0.26100.9169 package (headers10.0.26100.0). `-fasync-exceptions` is required for the native `__try/__except` code. A GNU C++ target is used only for the plain-C control consumer test; it must not build the NGX virtual-interface addon. The overlay is compiled with MSVC `/MT` because its ReShade/ImGui C++ ABI must be Microsoft-compatible.

No SDK, compiler distribution, model, runtime DLL or built addon is committed. Package URLs and SHA256 pins are metadata in `toolchain-packages.json`. Separately obtained dependencies retain their own terms. The scripts never execute a toolchain installer or change the registry/global PATH; build-tool environment variables apply to the current `pwsh` process. Git caches, generated headers, binaries, logs and local target metadata belong under the ignored `artifacts/` directory.

## Obtain pinned dependencies

Run from the repository root in `pwsh`. The target game is not opened or modified by any build/test command below.

```powershell
$artifacts = Join-Path (Get-Location).Path 'artifacts'
python build/Get-Toolchain.py --destination "$artifacts/toolchain"
build/Fetch-Dependencies.ps1 `
  -NativeRoot "$artifacts/vendor/renodx" `
  -OverlayReShadeRoot "$artifacts/vendor/reshade-overlay"
build/Prepare-OverlaySdk.ps1 `
  -ReShadeRoot "$artifacts/vendor/reshade-overlay" `
  -ImguiRoot "$artifacts/vendor/renodx/external/reshade/deps/imgui" `
  -Destination "$artifacts/overlay-sdk"
```

`Fetch-Dependencies.ps1` checks out the fixed RenoDX commit and eight required dependency commits, plus the separate ReShade6.8 overlay SDK commit. It checks existing checkouts before changing a ref and verifies the final pin/clean state. It does not update global Git configuration. A real empty-directory fetch of every listed pin was tested. Other RenoDX submodules are not required by this standalone addon build.

The helper prepares flat ReShade API20/ImGui19250 overlay SDK headers from their exact source commits, with their own license files. Native builds retain the pinned API18/ImGui19250 RenoDX dependency. Real ReShade6.8 accepted both API versions in an isolated loader test; API version18 alone is not an incompatibility with loader API20.

An existing correctly pinned checkout and compatible installed Microsoft toolchain can be supplied instead. `VcRoot` must contain `include`, `lib/x64`, and `bin/Hostx64/x64`. `SdkRoot` must contain `Include/<SdkVersion>`. Standard Windows Kits libraries may live at `SdkRoot/Lib/<SdkVersion>/{ucrt,um}/x64`; the official split NuGet packages instead require `SdkLibRoot` containing `{ucrt,um}/x64`.

## Build the selected game target

```powershell
$common = @{
  NativeRoot = "$artifacts/vendor/renodx"
  VcRoot = "$artifacts/toolchain/msvc/VC/Tools/MSVC/14.44.35207"
  SdkRoot = "$artifacts/toolchain/sdk/microsoft.windows.sdk.cpp/c"
  SdkLibRoot = "$artifacts/toolchain/sdk/microsoft.windows.sdk.cpp.x64/c"
  SdkVersion = '10.0.26100.0'
  ZigRoot = "$artifacts/toolchain/zig/zig-x86_64-windows-0.14.1"
}
$target = Read-Host 'Full path of the selected actual Client-Win64-Shipping.exe'
build/Build-Native.ps1 @common `
  -BuildRoot "$artifacts/native" -TargetExe $target
build/Build-Native.ps1 @common `
  -BuildRoot "$artifacts/native-baseline" -MacroOff

$overlayTools = @{
  VcRoot = $common.VcRoot
  SdkRoot = $common.SdkRoot
  SdkLibRoot = $common.SdkLibRoot
  SdkVersion = $common.SdkVersion
}
build/Build-Overlay.ps1 @overlayTools `
  -OverlaySdkRoot "$artifacts/overlay-sdk" `
  -BuildRoot "$artifacts/overlay"
```

The ON build requires an existing absolute shipping executable path and generates `target-exe.hpp` containing `WUWA_TARGET_EXE_W`. Native controls/cache are allowed only when the running executable's full canonical path matches that compiled target. The common Unreal basename does not opt another game in. An empty/unconfigured or relative target is denied. Paths at or above260 characters retain the original conservative rejection. The public repository contains no private installation path.

The build stages this source under the explicit dependency checkout's untracked `src/addons/wuwa-public` directory to preserve RenoDX's relative include layout. It does not patch shared utilities, global CMake, or vendor sources. Detours objects/static library are built from the pinned unchanged sources into `BuildRoot/detours`, not into the vendor checkout. Every shader is compiled from the actual source and embedded as a byte array; `native-shaders.json` records both source and bytecode SHA256.

ON outputs `renodx-dlss5-wuwa.addon64` and **local** `native-build.json`. The latter records `targetExe`, `nativeSha256`, `controlAbi=1`, `stateBytes=376`, `commandBytes=24`, `experimentEnabled=true`, and `sourceSha256` for `native-sources.json`. The public Swapper package staging command requires that record, verifies the binary hash/API, and binds installation to the same selected canonical executable. A binary built for another installation is rejected clearly. OFF produces `renodx-dlss5-baseline.addon64` and no ON installation record.

These are source-reproducible builds, not a promise of bit-identical binaries. The inherited source contains `__DATE__`/`__TIME__`, and PE build metadata changes. Compare source/dependency/shader manifests and exported ABI as well as the local artifact hash.

## Run actual source tests

```powershell
build/Run-Tests.ps1 @common -BuildRoot "$artifacts/tests"
build/Run-CompatTest.ps1 @overlayTools `
  -NativeRoot $common.NativeRoot `
  -DetoursLib "$artifacts/native/detours/detours.lib" `
  -BuildRoot "$artifacts/compat-tests"
```

The tests execute the actual native history/control/policy headers and actual overlay client, not a mock GPU model. They cover69 history assertions,80 control/policy assertions including concurrent coherent snapshots, four real executable-path cases (configured exact path, same filename in a different directory, empty target, relative target),54 MSVC-provider/GNU-consumer C transport assertions, mixed MSVC/Zig virtual dispatch and a real handled access violation. The compatibility test checks canonical COM identity/ref balance, thread handles held through commit/abort, injected failure cleanup and retry. Every process is a disposable self-process test; none attaches to the game.

The original GPU numerical fixture source and results are documented separately under `validation/`. Cache bytecode rebuilt here must match the recorded two `.cso` hashes before reusing those results. CPU/ABI/shader results do not establish live game quality, performance, stability, GPU power or fan noise. NR API-success records and cache command recordings are also not completed-GPU measurements.

The included DX12 smoke-host source is optional diagnostic tooling, not an install payload. It needs a separately obtained ReShade loader and the addon binaries in its own temporary directory. Do not distribute the CPU fixture provider or a smoke-enabled overlay as the game's addon.

## Source and license provenance

Native: [PEQHUB Generic snapshot](https://github.com/PEQHUB/RenoDX-DLSS5-Generic/tree/1b7d6787817b806a61cece6b8aa38789304c4d25), with pinned RenoDX shared sources from [clshortfuse/renodx](https://github.com/clshortfuse/renodx/tree/40d764d88719ab06c8e46139b5454e7dafc8cbcc). The public adaptation preserves the final frozen algorithm and makes its full-path opt-in configurable; the private adapter baseline remains experimental. See `native/NOTICE.md` and `native/LICENSE`.

F8 overlay: [Swapper v2.2.9 overlay](https://github.com/rakanki911/DLSS5-Swapper/tree/v2.2.9/overlay), plus the independent public-ABI WuWa panel. Preserve both MIT notices in `overlay/`. ReShade/ImGui and separately obtained NVIDIA/Microsoft dependencies keep their own licenses and terms.
