# SPDX-License-Identifier: MIT
param(
    [Parameter(Mandatory=$true)][string]$NativeRoot,
    [Parameter(Mandatory=$true)][string]$VcRoot,
    [Parameter(Mandatory=$true)][string]$SdkRoot,
    [string]$SdkLibRoot,
    [string]$SdkVersion = '10.0.26100.0',
    [Parameter(Mandatory=$true)][string]$DetoursLib,
    [Parameter(Mandatory=$true)][string]$BuildRoot
)
. (Join-Path $PSScriptRoot 'Common.ps1')
Use-BuildTools -VcRoot $VcRoot -SdkRoot $SdkRoot -SdkLibRoot $SdkLibRoot -SdkVersion $SdkVersion -BuildRoot $BuildRoot
$taskMirror = Stage-NativeSource -SourceRoot ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\native'))) -NativeRoot $NativeRoot
$taskExe = Join-Path $BuildRoot 'compat-test.exe'
& cl.exe /nologo /std:c++20 /EHa /MT /O2 /DNOMINMAX ('/I' + $taskMirror) ('/I' + (Join-Path $NativeRoot 'external\reshade')) ('/I' + (Join-Path $NativeRoot 'external\Detours\src')) ('/Fe' + $taskExe) ('/Fo' + (Join-Path $BuildRoot 'compat-test.obj')) (Join-Path $PSScriptRoot 'tests\compat_test.cpp') /link $DetoursLib kernel32.lib user32.lib uuid.lib
if ($LASTEXITCODE -ne 0) { throw 'Compatibility test compile failed' }
& $taskExe 2>&1 | Tee-Object -FilePath (Join-Path $BuildRoot 'compat-test.log')
if ($LASTEXITCODE -ne 0) { throw 'Compatibility test failed' }
