# Dependencies and source notices

The three frozen HLSL fixtures retain their original
`Copyright (C) 2026; SPDX-License-Identifier: MIT` notices. The independently
written validation harness, Python oracle and scripts are project source;
the repository license applies. None of these files include DLSS model
weights, NVIDIA runtime binaries, game assets, SDK binaries or compiler tools.

Compilation uses external Microsoft Windows SDK headers/libraries, MSVC and
the system `d3dcompiler_47.dll`; those dependencies are not redistributed here
and remain subject to their own licenses. Python and NumPy are external runtime
dependencies, also not redistributed. NumPy uses a BSD license; retain its
original notices if redistributing NumPy itself.

The oracle follows the documented Direct3D narrowing conversion rule (float32
to float16 rounds toward zero):
[Microsoft data-conversion rules](https://learn.microsoft.com/en-us/windows/win32/direct3d10/d3d10-graphics-programming-guide-resources-data-conversion)
and [f32tof16 shader instruction](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/f32tof16--sm5---asm-).
