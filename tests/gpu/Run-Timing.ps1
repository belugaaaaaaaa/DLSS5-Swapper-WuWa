param([ValidateSet('rgba16','rgba32')][string]$ColorFormat='rgba16',[string]$Compiler='cl.exe')
$ErrorActionPreference='Stop'
if (-not (Get-Command $Compiler -ErrorAction SilentlyContinue)) {
 throw 'MSVC compiler unavailable. Run from Visual Studio Developer PowerShell with the Windows SDK selected.'
}
$buildRoot=Join-Path $PSScriptRoot 'build'
if (-not (Test-Path -LiteralPath (Join-Path $buildRoot 'wuwa_cache_refresh.cso')) -or -not (Test-Path -LiteralPath (Join-Path $buildRoot 'wuwa_cache_reproject.cso'))) {
 & (Join-Path $PSScriptRoot 'Build-QA.ps1') -Compiler $Compiler
}
& $Compiler /nologo /std:c++20 /EHsc /MT /O2 /DNOMINMAX ('/Fo:'+(Join-Path $buildRoot 'shader_timing.obj')) ('/Fe:'+(Join-Path $buildRoot 'shader_timing.exe')) (Join-Path $PSScriptRoot 'shader_timing.cpp') /link d3d12.lib dxgi.lib d3dcompiler.lib kernel32.lib user32.lib uuid.lib
if($LASTEXITCODE -ne 0){throw 'Standalone timing harness compilation failed'}
$result=& (Join-Path $buildRoot 'shader_timing.exe') (Join-Path $buildRoot 'wuwa_cache_refresh.cso') (Join-Path $buildRoot 'wuwa_cache_reproject.cso') $ColorFormat
if($LASTEXITCODE -ne 0){throw 'Isolated timing fixture failed'}
$result | ConvertFrom-Json | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $buildRoot ('gpu_timing_'+$ColorFormat+'.json')) -Encoding utf8
$result
