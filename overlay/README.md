`src/` is the final production F8 overlay source that produced the local `BCADBA5A...` candidate. Its runtime source files are unchanged in this public package. Test include paths were adjusted to this directory layout.

When `RenoDX_WuWa_GetState` and `RenoDX_WuWa_SetControl` are present, F8 opens the in-process Chinese WuWa panel. Swapper/Electron can be closed after installation. Controls offer NR on/off, every-frame enhancement versus cache reuse, and enhancement working-resolution presets. The 85% default is supplied by the installer configuration; the reader accepts existing values33–100% and the setter offers50/67/75/85/100%.

Commands show queued state until a matching acknowledgement and readback arrive. A failed or unconfirmed command is not reported as applied. The status distinguishes successful model calls, cache reprojection recordings and completed total GPU samples. Cache refresh alone cannot report reuse. A checkbox being on cannot report NR as running.

The current process must be the native binary's explicitly configured full-path target. An API provider loaded into another executable reports the controls as disabled. Default F8 works without an AppData preference file; saved Swapper hotkey preferences remain supported.

Build with `../build/Build-Overlay.ps1` using the pinned ReShade6.8/API20 and Dear ImGui19250 SDK. The Microsoft compiler/static CRT avoids relying on a GNU C++ virtual ABI for ReShade's ImGui interface. The public transport itself is a C POD interface and is tested across an MSVC provider and GNU consumer.

`tests/control-provider.cpp` is a CPU fixture, not a neural runtime. `src/smoke-host-dx12.cpp` is a disposable hidden DX12 host for a separately obtained ReShade loader; it neither attaches to nor launches a game. Neither smoke binaries nor fixture DLLs are installation payloads.
