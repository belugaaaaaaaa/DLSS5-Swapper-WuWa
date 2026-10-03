# Standalone D3D12 fixtures

These tests help community contributors check the numerical behavior and
isolated GPU cost of changes aimed at lowering player GPU overhead. Real-game
quality and benefit still need player feedback; see the
[contribution guide](../../CONTRIBUTING.md).

These files reproduce the component tests documented in
[validation/README_VALIDATION.md](../../validation/README_VALIDATION.md).
They do not run or write to a game, install a plugin or invoke NGX/model inference.

Use Visual Studio Developer PowerShell, then run `Build-QA.ps1`; it builds the
numerical harness and compiles the frozen HLSL snapshots with the system D3D
compiler. Run `python run_gpu_tests.py` with the NumPy version pinned in
`../../validation/requirements.txt`. The runner generates 33 synthetic fixtures
and compares GPU readback against the independent CPU oracle. Its default
physical-adapter filter is `RTX 5070`; `--adapter` can select another physical
adapter for a separate experiment, without WARP fallback.

`Run-Timing.ps1` builds and runs the bounded 1440p RGBA16F timestamp fixture on
RTX 5070: two warmups and ten measured samples for each isolated kernel. No
neural renderer runs. `-ColorFormat rgba32` is available for a separate wider
format experiment; it is not the published RGBA16F measurement.

Every generated executable, object, CSO, binary fixture/readback and new JSON
report stays under ignored `build/`. Published historical result files in
`../../validation/` are immutable inputs to the source package.
