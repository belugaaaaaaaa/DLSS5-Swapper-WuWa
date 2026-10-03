# SPDX-License-Identifier: MIT
param([Parameter(Mandatory=$true)][string]$ReShadeRoot,[Parameter(Mandatory=$true)][string]$ImguiRoot,[Parameter(Mandatory=$true)][string]$Destination,[string]$Git = 'git')
$ErrorActionPreference = 'Stop'
$taskPins = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'dependencies.json') -Raw | ConvertFrom-Json
$taskHead = & $Git -c ('safe.directory=' + $ReShadeRoot) -C $ReShadeRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $taskHead.Trim() -ne $taskPins.overlaySdk.commit) { throw 'ReShade6.8 SDK pin mismatch' }
$taskHead = & $Git -c ('safe.directory=' + $ImguiRoot) -C $ImguiRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $taskHead.Trim() -ne $taskPins.overlaySdk.imguiCommit) { throw 'ImGui19250 source pin mismatch' }
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
foreach ($taskName in @('reshade.hpp','reshade_api.hpp','reshade_api_device.hpp','reshade_api_format.hpp','reshade_api_pipeline.hpp','reshade_api_resource.hpp','reshade_events.hpp','reshade_overlay.hpp')) {
    Copy-Item -LiteralPath (Join-Path $ReShadeRoot ('include\' + $taskName)) -Destination $Destination -Force
}
Copy-Item -LiteralPath (Join-Path $ImguiRoot 'imgui.h'),(Join-Path $ImguiRoot 'imconfig.h') -Destination $Destination -Force
Copy-Item -LiteralPath (Join-Path $ReShadeRoot 'LICENSE.md') -Destination (Join-Path $Destination 'LICENSE-ReShade.md') -Force
Copy-Item -LiteralPath (Join-Path $ImguiRoot 'LICENSE.txt') -Destination (Join-Path $Destination 'LICENSE-ImGui.txt') -Force
