# SPDX-License-Identifier: MIT
param(
    [Parameter(Mandatory=$true)][string]$VcRoot,
    [Parameter(Mandatory=$true)][string]$SdkRoot,
    [string]$SdkLibRoot,
    [string]$SdkVersion = '10.0.26100.0',
    [Parameter(Mandatory=$true)][string]$OverlaySdkRoot,
    [Parameter(Mandatory=$true)][string]$BuildRoot
)
. (Join-Path $PSScriptRoot 'Common.ps1')
Use-BuildTools -VcRoot $VcRoot -SdkRoot $SdkRoot -SdkLibRoot $SdkLibRoot -SdkVersion $SdkVersion -BuildRoot $BuildRoot
if ((Get-Content -LiteralPath (Join-Path $OverlaySdkRoot 'reshade.hpp') -Raw) -notmatch '#define RESHADE_API_VERSION 20' -or
    (Get-Content -LiteralPath (Join-Path $OverlaySdkRoot 'imgui.h') -Raw) -notmatch '#define IMGUI_VERSION_NUM\s+19250') { throw 'Overlay requires ReShade API20 / ImGui19250 SDK headers.' }
$taskSource = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\overlay\src'))
$taskDefines = @('/DWIN32_LEAN_AND_MEAN','/DNOMINMAX','/DNDEBUG','/DLAB_OVERLAY_PROFILE=dlss5-swapper')
$taskObjects = @()
foreach ($taskName in @('overlay','imgui-abi')) {
    $taskObject = Join-Path $BuildRoot ($taskName + '.obj')
    & cl.exe /nologo /std:c++17 /EHsc /MT /O2 /utf-8 @taskDefines ('/I' + $OverlaySdkRoot) /c (Join-Path $taskSource ($taskName + '.cpp')) ('/Fo' + $taskObject) 2>&1 | Tee-Object -FilePath (Join-Path $BuildRoot ($taskName + '-compile.log'))
    if ($LASTEXITCODE -ne 0) { throw "Overlay compile failed: $taskName" }
    $taskObjects += $taskObject
}
$taskBinary = Join-Path $BuildRoot 'dlss5-lab-overlay.addon64'
& link.exe /nologo /DLL /MACHINE:X64 /OPT:REF /OPT:ICF /INCREMENTAL:NO ('/OUT:' + $taskBinary) @taskObjects kernel32.lib user32.lib advapi32.lib libcmt.lib libcpmt.lib libvcruntime.lib libucrt.lib oldnames.lib 2>&1 | Tee-Object -FilePath (Join-Path $BuildRoot 'overlay-link.log')
if ($LASTEXITCODE -ne 0) { throw 'Overlay link failed' }
Get-Item -LiteralPath $taskBinary | Select-Object Name,Length
Get-FileHash -LiteralPath $taskBinary
