# SPDX-License-Identifier: MIT
param(
    [Parameter(Mandatory=$true)][string]$NativeRoot,
    [Parameter(Mandatory=$true)][string]$VcRoot,
    [Parameter(Mandatory=$true)][string]$SdkRoot,
    [string]$SdkLibRoot,
    [string]$SdkVersion = '10.0.26100.0',
    [Parameter(Mandatory=$true)][string]$ZigRoot,
    [Parameter(Mandatory=$true)][string]$BuildRoot,
    [string]$TargetExe,
    [switch]$MacroOff,
    [string]$Git = 'git'
)
. (Join-Path $PSScriptRoot 'Common.ps1')
$taskRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$NativeRoot = (Resolve-Path -LiteralPath $NativeRoot).Path
$BuildRoot = [IO.Path]::GetFullPath($BuildRoot)
Assert-NativePins -NativeRoot $NativeRoot -Git $Git
Use-BuildTools -VcRoot $VcRoot -SdkRoot $SdkRoot -SdkLibRoot $SdkLibRoot -SdkVersion $SdkVersion -BuildRoot $BuildRoot
$taskTarget = ''
if (!$MacroOff) {
    if (!$TargetExe -or ![IO.Path]::IsPathFullyQualified($TargetExe)) { throw 'ON build requires an absolute -TargetExe for the selected WuWa installation.' }
    $taskTarget = (Resolve-Path -LiteralPath $TargetExe).Path
    if ((Get-Item -LiteralPath $taskTarget).PSIsContainer -or [IO.Path]::GetFileName($taskTarget) -ine 'Client-Win64-Shipping.exe' -or $taskTarget.Length -ge 260) { throw 'Select the actual Client-Win64-Shipping.exe; paths >=260 characters remain unsupported.' }
}
$taskTargetHeader = Join-Path $BuildRoot 'target-exe.hpp'
Write-TargetHeader -TargetExe $taskTarget -Output $taskTargetHeader
$taskMirror = Stage-NativeSource -SourceRoot (Join-Path $taskRepo 'native') -NativeRoot $NativeRoot
$taskManifest = foreach ($taskFile in Get-ChildItem -LiteralPath (Join-Path $taskRepo 'native') -Recurse -File) {
    [ordered]@{path=[IO.Path]::GetRelativePath((Join-Path $taskRepo 'native'),$taskFile.FullName);sha256=(Get-FileHash -LiteralPath $taskFile.FullName).Hash}
}
$taskSourceManifest = Join-Path $BuildRoot 'native-sources.json'
$taskManifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $taskSourceManifest -Encoding UTF8
$taskEmbed = Join-Path $BuildRoot 'include\embed'
New-Item -ItemType Directory -Force -Path $taskEmbed | Out-Null
$taskShaderIncludes = [Collections.Generic.List[string]]::new()
$taskShaders = @()
foreach ($taskShader in Get-ChildItem -LiteralPath (Join-Path $taskMirror 'shaders') -Filter '*.hlsl' | Sort-Object Name) {
    if ($taskShader.Name -notmatch '^(.*)\.([pcv]s_5_[01])\.hlsl$') { throw "Unsupported shader target: $($taskShader.Name)" }
    $taskName = $Matches[1]; $taskShaderTarget = $Matches[2]
    $taskCso = Join-Path $taskEmbed ($taskName + '.cso')
    & (Join-Path $PSScriptRoot 'Compile-Shader.ps1') -Source $taskShader.FullName -Output $taskCso -Target $taskShaderTarget | Out-Null
    $taskBytes = [IO.File]::ReadAllBytes($taskCso)
    $taskHeader = "#pragma once`n#include <cstdint>`n#include <span>`ninline constexpr std::uint8_t __${taskName}_base[] = {" + [string]::Join(',', $taskBytes) + "};`ninline constexpr std::span<const std::uint8_t> __${taskName}{__${taskName}_base};`n"
    [IO.File]::WriteAllText((Join-Path $taskEmbed ($taskName + '.h')), $taskHeader)
    $taskShaderIncludes.Add('#include "./' + $taskName + '.h"')
    $taskShaders += [ordered]@{source=$taskShader.Name;sourceSha256=(Get-FileHash -LiteralPath $taskShader.FullName).Hash;bytecodeSha256=(Get-FileHash -LiteralPath $taskCso).Hash;bytes=$taskBytes.Length}
}
[IO.File]::WriteAllText((Join-Path $taskEmbed 'shaders.h'), "#pragma once`n" + [string]::Join("`n", $taskShaderIncludes) + "`n")
$taskShaders | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $BuildRoot 'native-shaders.json') -Encoding UTF8
# Build the unchanged Detours sources into this build directory, not vendor/lib.
$taskDetoursOut = Join-Path $BuildRoot 'detours'
New-Item -ItemType Directory -Force -Path $taskDetoursOut | Out-Null
$taskObjects = @()
foreach ($taskName in @('detours','modules','disasm','image','creatwth','disolx86','disolx64','disolia64','disolarm','disolarm64')) {
    $taskObject = Join-Path $taskDetoursOut ($taskName + '.obj')
    & cl.exe /nologo /c /std:c++17 /MT /O2 /Gy /Zl /DWIN32_LEAN_AND_MEAN /D_WIN32_WINNT=0x501 /DDETOUR_DEBUG=0 ('/I' + (Join-Path $NativeRoot 'external\Detours\src')) ('/Fo' + $taskObject) (Join-Path $NativeRoot ('external\Detours\src\' + $taskName + '.cpp')) 2>&1 | Out-File -LiteralPath (Join-Path $taskDetoursOut ($taskName + '.log'))
    if ($LASTEXITCODE -ne 0) { throw "Detours compile failed: $taskName" }
    $taskObjects += $taskObject
}
$taskDetoursLib = Join-Path $taskDetoursOut 'detours.lib'
& lib.exe /nologo /MACHINE:X64 ('/OUT:' + $taskDetoursLib) @taskObjects
if ($LASTEXITCODE -ne 0) { throw 'Detours archive failed' }
$taskMacro = if ($MacroOff) { 0 } else { 1 }
$taskObject = Join-Path $BuildRoot ('native-' + $taskMacro + '.obj')
$taskIncludes = @('Detours\src','json\include','frozen\include','gtl\include','Streamline\include','DLSS\include','reshade' | ForEach-Object { Join-Path $NativeRoot ('external\' + $_) })
$taskIncludes += Join-Path $BuildRoot 'include'
$taskArgs = @('cc','-target','x86_64-windows-msvc','-nostdinc','-nostdlib','-x','c++','-std=c++20','-fms-extensions','-fms-compatibility','-fms-compatibility-version=19.44','-fexceptions','-fcxx-exceptions','-fasync-exceptions','-fno-sanitize=all','-DNOMINMAX','-D_MT','-DNDEBUG','-D_ITERATOR_DEBUG_LEVEL=0','-O2','-Wno-error=date-time',('-DRENODX_WUWA_COST_EXPERIMENT=' + $taskMacro))
foreach ($taskPath in (($env:INCLUDE -split ';') + (Join-Path $ZigRoot 'lib\include'))) { $taskArgs += @('-isystem',$taskPath) }
foreach ($taskPath in $taskIncludes) { $taskArgs += @('-I',$taskPath) }
$taskArgs += @('-include',$taskTargetHeader,'-include',(Join-Path $taskMirror 'generic_compat.hpp'),'-c',(Join-Path $taskMirror 'addon.cpp'),'-o',$taskObject)
& (Join-Path $ZigRoot 'zig.exe') @taskArgs 2>&1 | Tee-Object -FilePath (Join-Path $BuildRoot ('native-compile-' + $taskMacro + '.log'))
if ($LASTEXITCODE -ne 0) { throw 'Native Microsoft-ABI compile failed' }
$taskFile = if ($MacroOff) { 'renodx-dlss5-baseline.addon64' } else { 'renodx-dlss5-wuwa.addon64' }
$taskBinary = Join-Path $BuildRoot $taskFile
& link.exe /nologo /DLL /MACHINE:X64 /OPT:REF /OPT:ICF /DELAYLOAD:winhttp.dll ('/OUT:' + $taskBinary) $taskObject $taskDetoursLib kernel32.lib user32.lib advapi32.lib bcrypt.lib shell32.lib ole32.lib version.lib dbghelp.lib winhttp.lib delayimp.lib d3d12.lib dxgi.lib d3d11.lib psapi.lib uuid.lib libcmt.lib libcpmt.lib libvcruntime.lib libucrt.lib oldnames.lib 2>&1 | Tee-Object -FilePath (Join-Path $BuildRoot ('native-link-' + $taskMacro + '.log'))
if ($LASTEXITCODE -ne 0) { throw 'Native link failed' }
if (!$MacroOff) {
    [ordered]@{targetExe=$taskTarget;nativeFile=$taskFile;nativeSha256=(Get-FileHash -LiteralPath $taskBinary).Hash;controlAbi=1;stateBytes=376;commandBytes=24;experimentEnabled=$true;sourceSha256=(Get-FileHash -LiteralPath $taskSourceManifest).Hash} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $BuildRoot 'native-build.json') -Encoding UTF8
}
Get-Item -LiteralPath $taskBinary | Select-Object Name,Length
Get-FileHash -LiteralPath $taskBinary
