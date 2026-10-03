# Third-party source and external components

The root MIT license covers original contributions in this repository. Preserve the licenses and copyright notices below when distributing derived source.

- `swapper/`: DLSS5-Swapper, MIT, copyright (c) 2026 Rakan Alkhaldi. Its upstream third-party notices are retained in that directory.
- `overlay/`: derived from the Swapper native overlay, under the upstream MIT terms. The F8 implementation and tests add original contributions.
- `native/`: derived from RenoDX and RenoDX-DLSS5-Generic. Generic's MIT notice, copyright (c) 2025 Carlos Lopez Jr., and RenoDX notices are retained with the source. See the directory notices for individual files.
- `tests/gpu/`: includes the corresponding native shader source and its MIT notices; see `tests/gpu/NOTICE.md`.
- Build dependencies include ReShade/ImGui, NVIDIA DLSS SDK headers, Detours, Streamline, frozen, gtl and nlohmann/json. They are fetched separately at documented pins and retain their own licenses. This repository's MIT license does not relicense them.

The repository does not distribute NVIDIA NR runtime DLLs or model files, game files, OptiScaler binaries, dgVoodoo binaries, third-party portable payloads, Electron executables or compiler/SDK installations. Any optional external download or locally provided payload remains subject to its publisher's license. Optional OptiScaler use is subject to its GPL license as described in the preserved upstream notice; it is not part of the included native cache implementation.

Names and trademarks identify compatibility and source lineage. The project is an independent experimental adaptation, with no claim of official NVIDIA, Kuro Games or upstream endorsement.
