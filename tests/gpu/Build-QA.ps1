param([string]$Compiler='cl.exe')
$ErrorActionPreference='Stop'
if (-not (Get-Command $Compiler -ErrorAction SilentlyContinue)) {
 throw 'MSVC compiler unavailable. Run from Visual Studio Developer PowerShell with the Windows SDK selected.'
}
$buildRoot=Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
& $Compiler /nologo /std:c++20 /EHsc /MT /O2 /DNOMINMAX ('/Fo:'+(Join-Path $buildRoot 'shader_qa.obj')) ('/Fe:'+(Join-Path $buildRoot 'shader_qa.exe')) (Join-Path $PSScriptRoot 'shader_qa.cpp') /link d3d12.lib dxgi.lib d3dcompiler.lib kernel32.lib user32.lib uuid.lib
if($LASTEXITCODE -ne 0){throw 'Standalone numerical harness compilation failed'}
foreach($kernel in @('refresh','reproject')) {
 & (Join-Path $PSScriptRoot 'Compile-Shader.ps1') -Source (Join-Path $PSScriptRoot ('wuwa_cache_'+$kernel+'.cs_5_1.hlsl')) -Output (Join-Path $buildRoot ('wuwa_cache_'+$kernel+'.cso'))
}
