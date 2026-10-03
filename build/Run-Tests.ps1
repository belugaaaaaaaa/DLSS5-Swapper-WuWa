# SPDX-License-Identifier: MIT
param(
    [Parameter(Mandatory=$true)][string]$NativeRoot,
    [Parameter(Mandatory=$true)][string]$VcRoot,
    [Parameter(Mandatory=$true)][string]$SdkRoot,
    [string]$SdkLibRoot,
    [string]$SdkVersion = '10.0.26100.0',
    [Parameter(Mandatory=$true)][string]$ZigRoot,
    [Parameter(Mandatory=$true)][string]$BuildRoot,
    [string]$Git = 'git'
)
. (Join-Path $PSScriptRoot 'Common.ps1')
$taskRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$NativeRoot = (Resolve-Path -LiteralPath $NativeRoot).Path
$BuildRoot = [IO.Path]::GetFullPath($BuildRoot)
Assert-NativePins -NativeRoot $NativeRoot -Git $Git
Use-BuildTools -VcRoot $VcRoot -SdkRoot $SdkRoot -SdkLibRoot $SdkLibRoot -SdkVersion $SdkVersion -BuildRoot $BuildRoot
$taskMirror = Stage-NativeSource -SourceRoot (Join-Path $taskRepo 'native') -NativeRoot $NativeRoot
foreach ($taskName in @('wuwa_cost_policy_test','wuwa_control_policy_test')) {
    $taskExe = Join-Path $BuildRoot ($taskName + '.exe')
    $taskArgs = @('/nologo','/std:c++20','/EHsc','/MT','/O2','/utf-8','/DNOMINMAX',('/I' + (Join-Path $NativeRoot 'external\reshade')),('/I' + (Join-Path $NativeRoot 'external\Detours\src')),('/I' + (Join-Path $NativeRoot 'external\gtl\include')),('/Fe' + $taskExe),('/Fo' + (Join-Path $BuildRoot ($taskName + '.obj'))),(Join-Path $taskMirror ('tests\' + $taskName + '.cpp')),'/link','kernel32.lib','user32.lib','uuid.lib')
    & cl.exe @taskArgs 2>&1 | Tee-Object -FilePath (Join-Path $BuildRoot ($taskName + '-compile.log'))
    if ($LASTEXITCODE -ne 0) { throw "$taskName compile failed" }
    & $taskExe 2>&1 | Tee-Object -FilePath (Join-Path $BuildRoot ($taskName + '.log'))
    if ($LASTEXITCODE -ne 0) { throw "$taskName failed" }
}
# Test the actual public path guard: exact configured path, another directory
# with the SAME shipping filename, empty target, and relative target.
$taskA = Join-Path $BuildRoot 'target-a\Client-Win64-Shipping.exe'
$taskB = Join-Path $BuildRoot 'target-b\Client-Win64-Shipping.exe'
New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($taskA)),([IO.Path]::GetDirectoryName($taskB)) | Out-Null
$taskTargetHeader = Join-Path $BuildRoot 'guard-target.hpp'
Write-TargetHeader -TargetExe $taskA -Output $taskTargetHeader
$taskTargetSource = Join-Path $taskMirror 'tests\wuwa_target_test.cpp'
& cl.exe /nologo /std:c++20 /EHsc /MT /O2 /utf-8 ('/FI' + $taskTargetHeader) ('/Fe' + $taskA) ('/Fo' + (Join-Path $BuildRoot 'guard-a.obj')) $taskTargetSource
if ($LASTEXITCODE -ne 0) { throw 'Target guard compile failed' }
& $taskA 1
if ($LASTEXITCODE -ne 0) { throw 'Configured exact path was denied' }
Copy-Item -LiteralPath $taskA -Destination $taskB -Force
& $taskB 0
if ($LASTEXITCODE -ne 0) { throw 'Wrong process with same shipping basename was allowed' }
foreach ($taskMode in @('empty','relative')) {
    $taskTarget = if ($taskMode -eq 'empty') { '' } else { '.\Client-Win64-Shipping.exe' }
    Write-TargetHeader -TargetExe $taskTarget -Output $taskTargetHeader
    $taskExe = Join-Path $BuildRoot ('guard-' + $taskMode + '.exe')
    & cl.exe /nologo /std:c++20 /EHsc /MT /O2 /utf-8 ('/FI' + $taskTargetHeader) ('/Fe' + $taskExe) ('/Fo' + (Join-Path $BuildRoot ('guard-' + $taskMode + '.obj'))) $taskTargetSource
    if ($LASTEXITCODE -ne 0) { throw 'Unconfigured guard compile failed' }
    & $taskExe 0
    if ($LASTEXITCODE -ne 0) { throw 'Unconfigured or relative target was allowed' }
}
# Plain-C transport fixture: MSVC provider and independent GNU ABI consumer.
# This fixture performs no model/GPU work and cannot qualify game behaviour.
$taskProvider = Join-Path $BuildRoot 'renodx-dlss5.addon64'
& cl.exe /nologo /std:c++17 /EHsc /MT /O2 /utf-8 /c (Join-Path $taskRepo 'overlay\tests\control-provider.cpp') ('/Fo' + (Join-Path $BuildRoot 'provider.obj'))
if ($LASTEXITCODE -ne 0) { throw 'Transport provider compile failed' }
& link.exe /nologo /DLL /MACHINE:X64 ('/OUT:' + $taskProvider) ('/IMPLIB:' + (Join-Path $BuildRoot 'provider.lib')) (Join-Path $BuildRoot 'provider.obj') kernel32.lib libcmt.lib libcpmt.lib libvcruntime.lib libucrt.lib oldnames.lib
if ($LASTEXITCODE -ne 0) { throw 'Transport provider link failed' }
$taskClient = Join-Path $BuildRoot 'control-client-test.exe'
& (Join-Path $ZigRoot 'zig.exe') c++ -target x86_64-windows-gnu -std=c++17 -O2 -static (Join-Path $taskRepo 'overlay\tests\control-client-test.cpp') -o $taskClient
if ($LASTEXITCODE -ne 0) { throw 'Transport GNU client compile failed' }
Push-Location $BuildRoot
try {
    & $taskClient 2>&1 | Tee-Object -FilePath 'control-transport.log'
    if ($LASTEXITCODE -ne 0) { throw '54 transport assertions failed' }
} finally { Pop-Location }
# Mixed compiler test for the virtual interface and REAL __try/__except.
$taskProbe = Join-Path $BuildRoot 'msvc-abi-probe.obj'
$taskArgs = @('cc','-target','x86_64-windows-msvc','-nostdinc','-nostdlib','-x','c++','-std=c++20','-fms-extensions','-fms-compatibility','-fms-compatibility-version=19.44','-fasync-exceptions','-D_MT','-DNDEBUG','-D_ITERATOR_DEBUG_LEVEL=0','-O2')
foreach ($taskPath in (($env:INCLUDE -split ';') + (Join-Path $ZigRoot 'lib\include'))) { $taskArgs += @('-isystem',$taskPath) }
$taskArgs += @('-c',(Join-Path $PSScriptRoot 'tests\msvc_abi_probe.cpp'),'-o',$taskProbe)
& (Join-Path $ZigRoot 'zig.exe') @taskArgs
if ($LASTEXITCODE -ne 0) { throw 'Microsoft ABI/SEH probe compile failed' }
$taskAbiExe = Join-Path $BuildRoot 'msvc-abi-test.exe'
& cl.exe /nologo /std:c++20 /EHsc /MT /O2 ('/Fe' + $taskAbiExe) ('/Fo' + (Join-Path $BuildRoot 'abi-runner.obj')) (Join-Path $PSScriptRoot 'tests\msvc_abi_runner.cpp') $taskProbe
if ($LASTEXITCODE -ne 0) { throw 'MSVC ABI runner link failed' }
& $taskAbiExe 2>&1 | Tee-Object -FilePath (Join-Path $BuildRoot 'msvc-abi.log')
if ($LASTEXITCODE -ne 0) { throw 'Microsoft ABI/SEH probe failed' }
if (!(Test-Path -LiteralPath (Join-Path $BuildRoot '..\native\detours\detours.lib'))) {
    Write-Output 'Compatibility transaction test: run after Build-Native and supply -DetoursLib to Run-CompatTest.ps1.'
}
Write-Output 'Actual native CPU policies, four process identities, 54 C transport assertions, and Microsoft ABI/SEH probes passed; no game/GPU model test.'
