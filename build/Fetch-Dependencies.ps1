# SPDX-License-Identifier: MIT
param([Parameter(Mandatory=$true)][string]$NativeRoot,[Parameter(Mandatory=$true)][string]$OverlayReShadeRoot,[string]$Git = 'git')
$ErrorActionPreference = 'Stop'
$taskPins = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'dependencies.json') -Raw | ConvertFrom-Json
$taskRequests = @($taskPins.native | ForEach-Object { [pscustomobject]@{path=if($_.path -eq '.'){$NativeRoot}else{Join-Path $NativeRoot $_.path};url=$_.url;commit=$_.commit} })
$taskRequests += [pscustomobject]@{path=$OverlayReShadeRoot;url=$taskPins.overlaySdk.url;commit=$taskPins.overlaySdk.commit}
foreach ($taskRequest in $taskRequests) {
    $taskPath = [IO.Path]::GetFullPath($taskRequest.path)
    $taskFresh = $false
    if (!(Test-Path -LiteralPath (Join-Path $taskPath '.git'))) {
        if ((Test-Path -LiteralPath $taskPath) -and (Get-ChildItem -LiteralPath $taskPath -Force | Select-Object -First 1)) { throw "Refusing to replace nonempty non-Git directory: $taskPath" }
        New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($taskPath)) | Out-Null
        & $Git clone --no-checkout --filter=blob:none $taskRequest.url $taskPath
        if ($LASTEXITCODE -ne 0) { throw 'Clone failed' }
        $taskFresh = $true
    }
    if (!$taskFresh) {
        $taskChanges = @(& $Git -c ('safe.directory=' + $taskPath) -C $taskPath diff --ignore-submodules=all --name-only HEAD)
        if ($LASTEXITCODE -ne 0 -or $taskChanges.Count) { throw "Checkout has tracked changes: $taskPath" }
    }
    & $Git -c ('safe.directory=' + $taskPath) -C $taskPath fetch --depth=1 origin $taskRequest.commit
    if ($LASTEXITCODE -ne 0) { throw 'Pinned fetch failed' }
    & $Git -c ('safe.directory=' + $taskPath) -C $taskPath checkout --detach $taskRequest.commit
    if ($LASTEXITCODE -ne 0) { throw 'Pinned checkout failed' }
    $taskHead = & $Git -c ('safe.directory=' + $taskPath) -C $taskPath rev-parse HEAD
    $taskChanges = @(& $Git -c ('safe.directory=' + $taskPath) -C $taskPath diff --ignore-submodules=all --name-only HEAD)
    if ($LASTEXITCODE -ne 0 -or $taskHead.Trim() -ne $taskRequest.commit -or $taskChanges.Count) { throw 'Pinned clean checkout verification failed' }
}
