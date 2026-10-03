# Component validation and reproducibility

This source package includes an independent float32 CPU oracle, 19 CPU tests,
33 synthetic D3D12 GPU fixtures and a bounded GPU timestamp harness for the
full-edited-color cache. The recorded tests passed on a physical NVIDIA
GeForce RTX 5070. They did not run a game, DLSS/NGX, neural model inference,
or a fan/power benchmark. No percentage improvement is claimed.

The recorded results are [gpu_results.json](gpu_results.json) and
[gpu_timing_rgba16.json](gpu_timing_rgba16.json). Their original measurements,
per-fixture results, source/CSO hashes and runtime executable hashes have been
preserved. Compiled executables, CSOs, game/config/log data and previous
prototype evidence are not distributed. Recorded executable hashes identify
the original experimental binaries; they are not download links or a promise
that a new build will have the same PE timestamp or binary hash.

## What was tested

The 20-byte record contains full edited RGB and baseline-reference RGB as six
half values, followed by float depth and uint validity. The GPU root interface
has 80-byte constants, four SRVs, one typed color UAV and two byte-address
history UAVs. The oracle models D3D float32-to-half rounding toward zero.

The fixtures cover full NR edits without residual clipping; preservation of
fresh RGB with zero previous records, invalid depth/reference or uncacheable
HDR; source alpha; zero-motion edges; integer/fractional movement; lower-resolution
guide grids and offsets; raw-depth and equal-luma RGB rejection; invalid history;
NaN/Inf/offscreen motion; displacement limits; overflow and exactly 65504.
They specifically test a linear reference of 1024 with an edit near .001,
and a bright SDR reference with a dark edit, to expose cancellation errors.

Of 33 GPU fixtures, 25 use RGBA32F color for broad numerical coverage; eight
additionally use RGBA16_FLOAT linear or RGBA8_UNORM SDR. Motion/depth resources
are synthetic RG32F/R32F. Typed UAV load/store capability is checked for each
color format. Output comparison uses 3e-6 absolute/relative tolerance. Every
record's validity and depth matched exactly; all packed history words also
matched bit for bit in the recorded fixtures. The largest observed output
error was 2.9802322387695312e-8. Half-value comparison additionally permits
one-half-ULP scale differences as stated in the JSON, rather than assuming all
future GPU arithmetic will be bit-identical.

Each numerical process owns one D3D12 direct queue, uses explicit transitions
and UAV barriers, and waits on its own completion fence for at most 5000 ms
before readback or resource release. It explicitly selects a physical adapter
and never falls back to WARP. A zero previous-record fixture tests the shader's
independence from old records, not a host cache-allocation failure. Capture
preserves incoming fresh RGB even if that RGB is already nonfinite; it does
not repair an invalid neural result.

## Recorded kernel costs

At 2560x1440, the timing fixture used RGBA16F current/edited/output, linear
color, uniform synthetic baseline/edit, alpha 1, depth .5 and all-zero
full-resolution motion. Two 20-byte history buffers consume 140.625 MiB.
Capture writes A; reuse reads A and writes B; global UAV ordering follows each
dispatch. Each kernel has two warmups and ten measured samples.

| Isolated kernel | Median GPU ms | p95 GPU ms |
| --- | ---: | ---: |
| Full-edited capture | 0.215440 | 0.2241648 |
| Cached reprojection | 0.327296 | 0.4935616 |

These are D3D12 timestamp-query measurements at a reported frequency of
1,000,000,000 Hz, not CPU wall time. The interval includes Dispatch and its
following global UAV barrier; it excludes allocation, initialization/upload,
pipeline/root binding, query resolution and the CPU fence wait. All 24
warmup/measured intervals total 6.793216 ms. The reprojection samples include
one .615040 ms outlier; the stated p95 uses linear interpolation over just ten
samples. This is not a robust long-run tail estimate.

Zero motion reads one active history tap and uniform inputs favor locality.
Fractional motion may read four taps; SDR conversion, rejection, clocks and
concurrent workload can change cost. These are isolated component observations,
not a guaranteed minimum, a game-frame cost, or a measurement of the original
neural renderer. They cannot establish FPS, image quality, power, temperature
or fan-noise benefits.

## Reproduce

The recorded environment used Python 3.12.14, NumPy 2.3.5, MSVC compiler
19.44.35229.0, Windows SDK headers/libraries 10.0.26100.0 and system
`d3dcompiler_47.dll` version 10.0.26100.9457. Those tools are external dependencies
and are not bundled. The C++ harness builds with `/std:c++20 /EHsc /MT /O2
/DNOMINMAX` and links `d3d12`, `dxgi`, `d3dcompiler`, `kernel32`, `user32`, `uuid`.
The HLSL compiler uses entry `main`, target `cs_5_1`, strictness and optimization
level 3, without embedding debug paths.

From the repository root, use Python with the pinned NumPy requirement:

```powershell
python -m pip install -r validation/requirements.txt
python -m unittest discover -s validation -p test_shader_reference.py -v
```

From Visual Studio Developer PowerShell with MSVC and Windows SDK configured:

```powershell
./tests/gpu/Build-QA.ps1
python ./tests/gpu/run_gpu_tests.py
./tests/gpu/Run-Timing.ps1
```

The numerical runner defaults to the physical adapter name containing
`RTX 5070`; `--adapter "name substring"` can select another physical adapter
for a new experiment. The timing harness is intentionally restricted to the
RTX 5070 recorded here. Unsupported adapters/features fail explicitly.
Generated binaries, inputs, readbacks and new reports stay under ignored
`tests/gpu/build/`; they do not overwrite the published recorded results.
The packaging copy changes runner paths, build output location and adapter
selection only. Historical source hashes in recorded reports remain unchanged;
[publication_manifest.json](publication_manifest.json) records packaged file
hashes separately. Exact frozen HLSL/CPU oracle and C++ harness source are
preserved. Independent re-execution of the packaged CPU/GPU commands passed.

## Remaining qualification

These tests do not establish game integration, versioned NGX feature eligibility,
real motion conventions or guide formats, command-list reuse, multiple queues,
cache retirement, the configured inference cadence, visual stability under
camera/combat/particles/exposure changes, or end-user performance. Fresh-RGB
preservation does not mean a rejected reuse frame retains the neural look.
Same-scene live validation must measure accepted base evaluations, inference/
reuse/rejection counts, GPU stage times, visual continuity and power/fan behavior
at fixed settings and frame-rate budget. Generated display frames must not
advance base-evaluation cadence. These component fixtures contain no game,
model-inference, FPS or fan benchmark. Subsequent user acceptance and NR
execution logs from the installed local build are documented separately in
[the user validation record](../docs/USER_VALIDATION.zh-CN.md).

The frozen HLSL snapshots retain their MIT notices. See
[dependency notices](../tests/gpu/NOTICE.md) for external SDK/compiler/Python/
NumPy dependencies and the Direct3D precision references.
