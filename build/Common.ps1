# SPDX-License-Identifier: MIT
$ErrorActionPreference = 'Stop'
function Use-BuildTools {
    param([string]$VcRoot,[string]$SdkRoot,[string]$SdkLibRoot,[string]$SdkVersion,[string]$BuildRoot)
    if (!$SdkLibRoot) { $SdkLibRoot = $SdkRoot }
    $taskSdkInclude = Join-Path $SdkRoot ('Include\' + $SdkVersion)
    $taskUcrtLib = Join-Path $SdkLibRoot ('Lib\' + $SdkVersion + '\ucrt\x64')
    $taskUmLib = Join-Path $SdkLibRoot ('Lib\' + $SdkVersion + '\um\x64')
    # The official NuGet SDK packages keep the libraries in a separate package.
    if (!(Test-Path -LiteralPath $taskUcrtLib)) { $taskUcrtLib = Join-Path $SdkLibRoot 'ucrt\x64' }
    if (!(Test-Path -LiteralPath $taskUmLib)) { $taskUmLib = Join-Path $SdkLibRoot 'um\x64' }
    $taskVcBin = Join-Path $VcRoot 'bin\Hostx64\x64'
    foreach ($taskPath in @((Join-Path $VcRoot 'include'),$taskSdkInclude,$taskUcrtLib,$taskUmLib,(Join-Path $taskVcBin 'cl.exe'),(Join-Path $taskVcBin 'link.exe'),(Join-Path $taskVcBin 'lib.exe'))) {
        if (!(Test-Path -LiteralPath $taskPath)) { throw "Missing build input: $taskPath" }
    }
    New-Item -ItemType Directory -Force -Path $BuildRoot | Out-Null
    $env:INCLUDE = (@((Join-Path $VcRoot 'include')) + @('ucrt','shared','um','winrt','cppwinrt' | ForEach-Object { Join-Path $taskSdkInclude $_ })) -join ';'
    $env:LIB = @((Join-Path $VcRoot 'lib\x64'),$taskUcrtLib,$taskUmLib) -join ';'
    $env:PATH = $taskVcBin + ';' + $env:PATH
    $env:VSCMD_SKIP_SENDTELEMETRY = '1'
    $env:ZIG_GLOBAL_CACHE_DIR = Join-Path $BuildRoot 'zig-global-cache'
    $env:ZIG_LOCAL_CACHE_DIR = Join-Path $BuildRoot 'zig-local-cache'
}
function Assert-NativePins {
    param([string]$NativeRoot,[string]$Git = 'git')
    $taskPins = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'dependencies.json') -Raw | ConvertFrom-Json
    foreach ($taskPin in $taskPins.native) {
        $taskPath = if ($taskPin.path -eq '.') { $NativeRoot } else { Join-Path $NativeRoot $taskPin.path }
        $taskHead = & $Git -c ('safe.directory=' + $taskPath) -C $taskPath rev-parse HEAD
        if ($LASTEXITCODE -ne 0 -or $taskHead.Trim() -ne $taskPin.commit) { throw "Dependency pin mismatch: $($taskPin.path)" }
        $taskChanges = @(& $Git -c ('safe.directory=' + $taskPath) -C $taskPath diff --ignore-submodules=all --name-only HEAD)
        if ($LASTEXITCODE -ne 0 -or $taskChanges.Count) { throw "Tracked dependency source changed: $($taskPin.path)" }
    }
}
function Stage-NativeSource {
    param([string]$SourceRoot,[string]$NativeRoot)
    $taskMirror = [IO.Path]::GetFullPath((Join-Path $NativeRoot 'src\addons\wuwa-public'))
    $taskMarker = Join-Path $taskMirror '.wuwa-public-build'
    if ((Test-Path -LiteralPath $taskMirror) -and !(Test-Path -LiteralPath $taskMarker) -and (Get-ChildItem -LiteralPath $taskMirror -Force | Select-Object -First 1)) {
        throw 'The addon staging directory already contains unrelated files.'
    }
    New-Item -ItemType Directory -Force -Path $taskMirror | Out-Null
    'Source staging only; no shared or vendor source edits.' | Set-Content -LiteralPath $taskMarker -Encoding UTF8
    foreach ($taskFile in Get-ChildItem -LiteralPath $SourceRoot -Recurse -File) {
        $taskRelative = [IO.Path]::GetRelativePath($SourceRoot,$taskFile.FullName)
        $taskDestination = Join-Path $taskMirror $taskRelative
        New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($taskDestination)) | Out-Null
        Copy-Item -LiteralPath $taskFile.FullName -Destination $taskDestination -Force
    }
    return $taskMirror
}
function Write-TargetHeader {
    param([string]$TargetExe,[string]$Output)
    $taskLiteral = $TargetExe.Replace('\','\\').Replace('"','\"')
    ('#pragma once' + "`n" + '#define WUWA_TARGET_EXE_W L"' + $taskLiteral + '"' + "`n") | Set-Content -LiteralPath $Output -Encoding UTF8
}
