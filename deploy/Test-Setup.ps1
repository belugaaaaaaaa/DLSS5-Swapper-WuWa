# SPDX-License-Identifier: MIT
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$WorkRoot)
$ErrorActionPreference='Stop'
$WorkRoot=[IO.Path]::GetFullPath($WorkRoot)
if ($WorkRoot.TrimEnd('\') -eq [IO.Path]::GetPathRoot($WorkRoot).TrimEnd('\')) { throw 'Choose an independent test directory.' }
if ((Test-Path -LiteralPath $WorkRoot) -and (Get-ChildItem -LiteralPath $WorkRoot -Force | Select-Object -First 1)) { throw 'Use a new empty test directory.' }
New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null
$tokens=$null; $parseErrors=$null
$tree=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Setup.ps1'),[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'Setup.ps1 parse failed.' }
foreach($name in @('Assert-SetupCache','Test-Contained','Assert-DeploymentPaths','Write-SetupStatus','Read-SetupState')) {
    $function=$tree.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
    if (!$function) { throw ('Missing function: ' + $name) }
    Invoke-Expression $function.Extent.Text
}
$pins=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'download-pins.json') -Raw -Encoding UTF8|ConvertFrom-Json
$gameRoot=Join-Path $WorkRoot 'game'
$templateRoot=Join-Path $WorkRoot 'bundle'
$exe=Join-Path $gameRoot 'Wuthering Waves Game\Client\Binaries\Win64\Client-Win64-Shipping.exe'
New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($exe)),$templateRoot -Force|Out-Null
[IO.File]::WriteAllText($exe,'isolated fixture; never executed')
$before=(Get-FileHash -LiteralPath $exe).Hash
$passed=0
function Expect-Rejection([scriptblock]$action,[string]$pattern) {
    $caught=$false
    try { $null=&$action } catch { $caught=$_.Exception.Message -match $pattern }
    if (!$caught) { throw 'Expected preflight rejection did not occur.' }
    $script:passed++
}
$CacheRoot=Join-Path $WorkRoot 'cache'
$normalized=Assert-DeploymentPaths $gameRoot $templateRoot
if ($normalized -ne $CacheRoot -or (Test-Path -LiteralPath $CacheRoot)) { throw 'Preflight created files or normalized incorrectly.' }; $passed++
$CacheRoot=$CacheRoot + '\'
if ((Assert-DeploymentPaths $gameRoot $templateRoot).EndsWith('\')) { throw 'Trailing separator was not removed.' }; $passed++
$CacheRoot=Join-Path $gameRoot 'cache'
Expect-Rejection {Assert-DeploymentPaths $gameRoot $templateRoot} '缓存必须独立'
if (Test-Path -LiteralPath $CacheRoot) { throw 'Refused overlap wrote to game.' }
$CacheRoot=$WorkRoot
Expect-Rejection {Assert-DeploymentPaths $gameRoot $templateRoot} '缓存必须独立'
$CacheRoot=Join-Path $templateRoot 'cache'
Expect-Rejection {Assert-DeploymentPaths $gameRoot $templateRoot} '缓存必须独立'
$CacheRoot=Join-Path $WorkRoot 'cache'
Expect-Rejection {Assert-DeploymentPaths (Join-Path $WorkRoot 'not-game') $templateRoot} '没有找到'
$StatusPath=Join-Path $WorkRoot 'status.json'
Write-SetupStatus 'running' 'first'
Write-SetupStatus 'completed' 'second'
$state=Read-SetupState $StatusPath
if ($state.status -ne 'completed' -or $state.message -ne 'second' -or (Test-Path -LiteralPath ($StatusPath+'.previous'))) { throw 'Status update failed.' }; $passed++
if ((Get-FileHash -LiteralPath $exe).Hash -ne $before) { throw 'Game fixture changed.' }; $passed++
[pscustomobject]@{windowsPowerShell=$PSVersionTable.PSVersion.ToString();passed=$passed;gameFixtureUnchanged=$true;preflightDidNotCreateCache=$true}|ConvertTo-Json -Compress
