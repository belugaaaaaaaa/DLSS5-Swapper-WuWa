# SPDX-License-Identifier: MIT
# Builds a source snapshot plus our two addons. No runtime/compiler download.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$TemplateDir,
    [Parameter(Mandatory=$true)][string]$OverlayFile,
    [Parameter(Mandatory=$true)][string]$NativeRoot,
    [Parameter(Mandatory=$true)][string]$OverlayReShadeRoot,
    [Parameter(Mandatory=$true)][string]$ProductionNodeModules,
    [Parameter(Mandatory=$true)][string[]]$MicrosoftLicenseFiles,
    [Parameter(Mandatory=$true)][string]$OutRoot,
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$SourceCommit,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,99}$')][string]$Release
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
Add-Type -AssemblyName System.IO.Compression.FileSystem
$utf8 = New-Object Text.UTF8Encoding($false)
function Write-Utf8([string]$File, [string]$Text) { [IO.File]::WriteAllText($File, $Text, $utf8) }
function Json-Write([string]$File, $Value) { Write-Utf8 $File (($Value | ConvertTo-Json -Depth 20) + "`n") }
function Hash([string]$File) { return (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() }
function Full([string]$Value) {
    if (![IO.Path]::IsPathRooted($Value) -or $Value -match '[\x00\r\n]') { throw 'Inputs and OutRoot must be absolute paths.' }
    return [IO.Path]::GetFullPath($Value).TrimEnd('\','/')
}
function Inside([string]$Parent, [string]$Child) {
    return $Child.Equals($Parent, [StringComparison]::OrdinalIgnoreCase) -or $Child.StartsWith($Parent + '\', [StringComparison]::OrdinalIgnoreCase)
}
function No-Links([string]$Value) {
    for ($current = $Value; $current; $current = [IO.Path]::GetDirectoryName($current)) {
        if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw ('Reparse point refused: ' + $current) }
    }
}
function Need-File([string]$File) { No-Links $File; if (!(Test-Path -LiteralPath $File -PathType Leaf)) { throw ('Required file missing: ' + $File) }; return $File }
function Git([string]$Root, [string[]]$Arguments) {
    $lines = @(& git -c ('safe.directory=' + $Root.Replace('\','/')) -C $Root @Arguments)
    if ($LASTEXITCODE -ne 0) { throw ('git failed: ' + ($Arguments -join ' ')) }
    return $lines
}
function Relative([string]$Root, [string]$File) {
    if (!(Inside $Root $File)) { throw 'Relative path would escape its root.' }
    return $File.Substring($Root.Length + 1).Replace('\','/')
}
function Copy-File([string]$Source, [string]$Target) {
    $null = Need-File $Source
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($Target)) -Force | Out-Null
    if (Test-Path -LiteralPath $Target) { throw ('Refusing to overwrite release file: ' + $Target) }
    [IO.File]::Copy($Source, $Target, $false)
}
function No-Payload([string]$RelativePath) {
    if ($RelativePath -match '(?i)(^|/)(\.git|node_modules|vendor|artifacts|out|dist|build-output|test-runs|backups|captures|sessions)(/|$)' -or
        $RelativePath -match '(?i)\.(exe|dll|addon64|lib|obj|o|pdb|cso|asar|zip|7z|tgz|nupkg|vsix|log|csv|local\.json)$' -or
        $RelativePath -match '(?i)(^|/)(native-build|overlay-build|deployment[^/]*|launcher-deployment[^/]*|game-deployment[^/]*|local-config)\.json$' -or
        $RelativePath -match '(?i)(^|/)(target-exe\.hpp|ReShade\.ini|\.env(?:\..*)?)$') { throw ('Source snapshot contains generated/private payload: ' + $RelativePath) }
}
$sourceRoot = Full (Split-Path -Parent $PSScriptRoot)
foreach ($name in @('TemplateDir','NativeRoot','OverlayReShadeRoot','ProductionNodeModules','OutRoot','OverlayFile')) {
    Set-Variable -Name $name -Value (Full (Get-Variable -Name $name -ValueOnly))
    No-Links (Get-Variable -Name $name -ValueOnly)
}
No-Links $sourceRoot
foreach ($directory in @($TemplateDir,$NativeRoot,$OverlayReShadeRoot,$ProductionNodeModules)) {
    if (!(Test-Path -LiteralPath $directory -PathType Container)) { throw ('Input directory missing: ' + $directory) }
}
if ($OutRoot -eq [IO.Path]::GetPathRoot($OutRoot).TrimEnd('\','/')) { throw 'OutRoot cannot be a disk root.' }
foreach ($inputRoot in @($sourceRoot,$TemplateDir,$NativeRoot,$OverlayReShadeRoot,$ProductionNodeModules,[IO.Path]::GetDirectoryName($OverlayFile))) {
    if ((Inside $OutRoot $inputRoot) -or (Inside $inputRoot $OutRoot)) { throw 'OutRoot must be independent of all inputs and source.' }
}
if ((Test-Path -LiteralPath $OutRoot) -and @((Get-ChildItem -LiteralPath $OutRoot -Force)).Count -ne 0) { throw 'OutRoot must be new or empty. Nothing will be deleted.' }
$null = Need-File $OverlayFile
if (!$MicrosoftLicenseFiles -or $MicrosoftLicenseFiles.Count -eq 0) { throw 'Supply the complete applicable Microsoft build/runtime license texts.' }
foreach ($file in $MicrosoftLicenseFiles) {
    $licenseFile = Need-File (Full $file)
    if ([IO.Path]::GetExtension($licenseFile) -notmatch '^\.(txt|rtf|html|md|docx)$' -or (Get-Item -LiteralPath $licenseFile).Length -lt 128) { throw 'Supply complete Microsoft license text/document (not a document landing page).' }
    if ([IO.Path]::GetExtension($licenseFile) -eq '.html' -and [IO.File]::ReadAllText($licenseFile) -match '<iframe' -and [IO.File]::ReadAllText($licenseFile) -notmatch '(?i)distributable code') { throw 'Microsoft HTML is only an embedded-document landing page; supply the actual complete license.' }
}
$resolvedCommit = (Git $sourceRoot @('rev-parse', ($SourceCommit + '^{commit}')) | Select-Object -First 1).Trim()
if ($resolvedCommit -ne $SourceCommit.ToLowerInvariant()) { throw 'SourceCommit must identify the exact full commit.' }
New-Item -ItemType Directory -Path $OutRoot -Force | Out-Null
$stage = Join-Path $OutRoot ('DLSS5-Swapper-WuWa-' + $Release)
New-Item -ItemType Directory -Path $stage | Out-Null
$snapshotZip = Join-Path $OutRoot 'source-snapshot.zip'
$null = Git $sourceRoot @('archive','--format=zip',('--output=' + $snapshotZip),$SourceCommit)
$tree = @(Git $sourceRoot @('ls-tree','-r',$SourceCommit))
if (@($tree | Where-Object { $_ -match '^(120000|160000) ' }).Count) { throw 'Source tree contains links/submodules; release closure would be incomplete.' }
$zip = [IO.Compression.ZipFile]::OpenRead($snapshotZip)
try {
    $count = 0
    foreach ($entry in $zip.Entries) {
        if (!$entry.Name) { continue }
        $relative = $entry.FullName
        if ($relative.Contains('\') -or [IO.Path]::IsPathRooted($relative) -or $relative.Split('/') -contains '..') { throw 'Unsafe git archive path.' }
        No-Payload $relative
        $destination = [IO.Path]::GetFullPath((Join-Path $stage $relative))
        if (!(Inside $stage $destination)) { throw 'Source path escapes staging directory.' }
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$destination,$false)
        $count++
    }
    if ($count -ne $tree.Count) { throw 'git archive did not include the complete tracked source tree (check export-ignore).' }
} finally { $zip.Dispose() }
foreach ($required in @('Start-Setup.cmd','deploy/Setup.ps1','deploy/worker.js','deploy/lib/deploy-core.js','deploy/lib/bind-native.js','deploy/lib/resources.js','deploy/THIRD_PARTY.md','docs/DEPLOYMENT.zh-CN.md','swapper/src/core/backend-manager.js','swapper/package-lock.json','build/dependencies.json')) { $null = Need-File (Join-Path $stage $required) }
# Detect accidental inclusion of this project's private workspace/game paths.
foreach ($file in Get-ChildItem -LiteralPath $stage -Recurse -File -Force) {
    if ($file.Extension -match '^\.(md|js|json|ps1|cmd|cpp|h|hpp|hlsl|yml|yaml|txt)$') {
        if ([IO.File]::ReadAllText($file.FullName) -match '(?i)\b[A-Z]:[\\/](?:Users|codex|wave|DLSS5-Swapper)[\\/]') { throw ('Private machine path found in ' + (Relative $stage $file.FullName)) }
    }
}
$dependencies = Get-Content -LiteralPath (Join-Path $stage 'build/dependencies.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($dependency in $dependencies.native) {
    $root = Full (Join-Path $NativeRoot $dependency.path)
    if ((Git $root @('rev-parse','HEAD') | Select-Object -First 1).Trim() -ne $dependency.commit) { throw ('Dependency pin mismatch: ' + $dependency.path) }
}
if (Test-Path -LiteralPath (Join-Path $OverlayReShadeRoot '.git')) {
    if ((Git $OverlayReShadeRoot @('rev-parse','HEAD') | Select-Object -First 1).Trim() -ne $dependencies.overlaySdk.commit) { throw 'Overlay ReShade pin mismatch.' }
}
$bundle = Join-Path $stage 'deploy/bundle'
New-Item -ItemType Directory -Path $bundle | Out-Null
$nativeName = 'renodx-dlss5-wuwa-template.addon64'
$metadataName = 'native-build-template.json'
$nativeSource = Need-File (Join-Path $TemplateDir $nativeName)
$metadataSource = Need-File (Join-Path $TemplateDir $metadataName)
$metadata = Get-Content -LiteralPath $metadataSource -Raw -Encoding UTF8 | ConvertFrom-Json
$nativeHash = Hash $nativeSource
if ($metadata.nativeFile -ne $nativeName -or $metadata.nativeSha256 -ne $nativeHash -or $metadata.templateSha256 -ne $nativeHash -or
    $metadata.controlAbi -ne 1 -or $metadata.stateBytes -ne 376 -or $metadata.commandBytes -ne 24 -or $metadata.experimentEnabled -ne $true -or
    $metadata.sourceSha256 -notmatch '^[a-fA-F0-9]{64}$' -or $metadata.targetBinding.version -ne 1 -or
    $metadata.targetBinding.export -ne 'RenoDX_WuWa_TargetExe' -or $metadata.targetBinding.characters -ne 260 -or
    $metadata.targetBinding.marker -ne 'WUWA_UNBOUND_V1' -or ($metadata.PSObject.Properties.Name -contains 'targetExe')) { throw 'Not a verified unbound ABI1 production template.' }
Copy-File $nativeSource (Join-Path $bundle $nativeName)
Copy-File $metadataSource (Join-Path $bundle $metadataName)
Copy-File $OverlayFile (Join-Path $bundle 'dlss5-lab-overlay.addon64')
$spec = [ordered]@{schema=1;release=$Release;sourceCommit=$resolvedCommit;nativeTemplate=[ordered]@{file=$nativeName;metadata=$metadataName;sha256=$nativeHash;metadataSha256=(Hash $metadataSource)};overlay=[ordered]@{file='dlss5-lab-overlay.addon64';sha256=(Hash $OverlayFile)};previousReleases=@()}
Json-Write (Join-Path $bundle 'bundle.json') $spec
$licenses = Join-Path $bundle 'licenses'
New-Item -ItemType Directory -Path $licenses | Out-Null
$licenseInventory = New-Object Collections.ArrayList
function License-Copy([string]$Source, [string]$RelativeName, [string]$Component) {
    $target = Join-Path $licenses $RelativeName
    Copy-File $Source $target
    $null = $licenseInventory.Add([ordered]@{component=$Component;file=$RelativeName.Replace('\','/');sha256=(Hash $target)})
}
foreach ($pair in @(
    @('LICENSE','Project-MIT.txt','Original contributions'),
    @('THIRD_PARTY_NOTICES.md','Project-NOTICES.md','Source provenance'),
    @('native/LICENSE','Generic-MIT.txt','RenoDX-DLSS5-Generic'),
    @('native/NOTICE.md','Generic-NOTICE.md','Native source provenance'),
    @('overlay/LICENSE','Overlay-MIT.txt','Overlay contributors'),
    @('overlay/LICENSE-Swapper','Swapper-MIT.txt','DLSS5-Swapper'),
    @('overlay/NOTICE.md','Overlay-NOTICE.md','Overlay source provenance'),
    @('swapper/THIRD_PARTY_NOTICES.md','Swapper-NOTICES.md','Upstream source notice')
)) { License-Copy (Join-Path $stage $pair[0]) $pair[1] $pair[2] }
foreach ($pair in @(
    @('LICENSE','RenoDX-MIT.txt','RenoDX'),
    @('external/Detours/LICENSE.md','Detours-MIT.txt','Microsoft Detours'),
    @('external/reshade/LICENSE.md','ReShade-Native-BSD-3-Clause.txt','ReShade native headers'),
    @('external/reshade/deps/imgui/LICENSE.txt','ImGui-MIT.txt','Dear ImGui'),
    @('external/json/LICENSE.MIT','nlohmann-json-MIT.txt','nlohmann/json'),
    @('external/frozen/LICENSE','frozen-Apache-2.0.txt','frozen'),
    @('external/frozen/AUTHORS','frozen-AUTHORS.txt','frozen authors'),
    @('external/gtl/LICENSE','gtl-Apache-2.0.txt','gtl and Abseil fragments'),
    @('external/Streamline/license.txt','Streamline-LICENSE.txt','NVIDIA Streamline header terms'),
    @('external/Streamline/3rd-party-licenses.md','Streamline-THIRD-PARTY.md','Upstream Streamline dependency notice'),
    @('external/DLSS/LICENSE.txt','NVIDIA-DLSS-SDK-TERMS.txt','NVIDIA RTX SDK terms')
)) { License-Copy (Join-Path $NativeRoot $pair[0]) $pair[1] $pair[2] }
$overlayLicense = Join-Path $OverlayReShadeRoot 'LICENSE.md'
if (!(Test-Path -LiteralPath $overlayLicense)) { $overlayLicense = Join-Path $OverlayReShadeRoot 'LICENSE-ReShade.md' }
License-Copy $overlayLicense 'ReShade-Overlay-BSD-3-Clause.txt' 'ReShade overlay headers'
foreach ($file in $MicrosoftLicenseFiles) { License-Copy (Full $file) ('Microsoft/' + [IO.Path]::GetFileName($file)) 'Microsoft build/runtime terms supplied for this build' }
# These upstream texts are copied if supplied by the pinned source trees.
foreach ($dependency in $dependencies.native) {
    $root = Join-Path $NativeRoot $dependency.path
    foreach ($name in @('NOTICE','NOTICE.txt','NOTICE.md')) {
        $file = Join-Path $root $name
        if (Test-Path -LiteralPath $file -PathType Leaf) { License-Copy $file ('Vendor-NOTICE/' + $dependency.path.Replace('/','_').Replace('.','RenoDX') + '-' + $name) $dependency.path }
    }
}
$boost = @'
Boost Software License - Version 1.0 - August 17th, 2003

Permission is hereby granted, free of charge, to any person or organization
obtaining a copy of the software and accompanying documentation covered by
this license (the "Software") to use, reproduce, display, distribute,
execute, and transmit the Software, and to prepare derivative works of the
Software, and to permit third-parties to whom the Software is furnished to
do so, all subject to the following:

The copyright notices in the Software and this entire statement, including
the above license grant, this restriction and the following disclaimer,
must be included in all copies of the Software, in whole or in part, and
all derivative works of the Software, unless such copies or derivative
works are solely in the form of machine-executable object code generated by
a source language processor.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT. IN NO EVENT
SHALL THE COPYRIGHT HOLDERS OR ANYONE DISTRIBUTING THE SOFTWARE BE LIABLE
FOR ANY DAMAGES OR OTHER LIABILITY, WHETHER IN CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
'@
Write-Utf8 (Join-Path $licenses 'Boost-1.0.txt') ($boost + "`n")
Write-Utf8 (Join-Path $licenses 'gtl-CREDITS.txt') @'
gtl: Copyright (c) 2019-2022 Gregory Popovitch. Apache License 2.0.
Included Abseil-derived portions: Copyright 2018 The Abseil Authors. Apache License 2.0.
phmap_utils.hpp Combiner fragments: Copyright 2005-2014 Daniel James. Boost Software License 1.0.
Upstream dependency pins and source URLs: build/dependencies.json.
Boost license source: https://www.boost.org/LICENSE_1_0.txt
Streamline included header notice: Copyright (c) 2022-2024 NVIDIA CORPORATION. MIT.
Streamline's full upstream notice includes components not linked into these addons (for example Nsight Perf).
'@
foreach ($name in @('Boost-1.0.txt','gtl-CREDITS.txt')) { $null = $licenseInventory.Add([ordered]@{component='gtl upstream notices';file=$name;sha256=(Hash (Join-Path $licenses $name))}) }
# Copy only the resolved production closure, preserving npm's directory layout.
# Optional installed dependencies are included; development dependencies are not.
$copied = @{}
$packageInventory = New-Object Collections.ArrayList
function Find-Package([string]$Name, [string]$From) {
    if ($Name -notmatch '^(?:@[a-zA-Z0-9._-]+/)?[a-zA-Z0-9._-]+$') { throw 'Invalid production dependency name.' }
    for ($current=$From; $current; $current=[IO.Path]::GetDirectoryName($current)) {
        $candidate = Join-Path $current ('node_modules/' + $Name)
        if (Test-Path -LiteralPath (Join-Path $candidate 'package.json') -PathType Leaf) {
            $candidate = Full $candidate
            if (!(Inside $ProductionNodeModules $candidate)) { throw 'Production dependency resolves outside provided node_modules.' }
            No-Links $candidate; return $candidate
        }
        if ($current.Equals([IO.Path]::GetDirectoryName($ProductionNodeModules),[StringComparison]::OrdinalIgnoreCase)) { break }
    }
    return $null
}
function Add-Package([string]$PackageDir) {
    if ($copied.ContainsKey($PackageDir)) { return }
    $copied[$PackageDir]=$true
    $manifest = Get-Content -LiteralPath (Need-File (Join-Path $PackageDir 'package.json')) -Raw -Encoding UTF8 | ConvertFrom-Json
    $relative = Relative $ProductionNodeModules $PackageDir
    if ($manifest.name -match '^(electron|electron-builder|7zip-bin)$') { throw 'Unexpected runtime/build tool in production closure.' }
    $destination = Join-Path $stage ('node_modules/' + $relative)
    $packageLicenses = New-Object Collections.ArrayList
    foreach ($file in Get-ChildItem -LiteralPath $PackageDir -Recurse -File -Force) {
        No-Links $file.FullName
        $fileRelative = Relative $PackageDir $file.FullName
        if ($fileRelative -match '(^|/)node_modules/') { continue }
        if ($fileRelative -match '(?i)\.(exe|dll|node|addon64|lib|obj|pdb|zip|7z|tgz|nupkg|vsix)$') { throw ('Unexpected binary in production dependency ' + $manifest.name) }
        Copy-File $file.FullName (Join-Path $destination $fileRelative)
        if ($file.Name -match '(?i)^(license|licence|copying|notice)([._-]|$)') {
            $null = $packageLicenses.Add($fileRelative)
            License-Copy $file.FullName ('Node/' + $relative + '/' + $fileRelative) ($manifest.name + '@' + $manifest.version)
        }
    }
    if ($packageLicenses.Count -eq 0) { throw ('Complete license text missing in package ' + $manifest.name) }
    $null = $packageInventory.Add([ordered]@{name=$manifest.name;version=$manifest.version;directory=('node_modules/' + $relative);license=$manifest.license;licenseFiles=@($packageLicenses)})
    foreach ($section in @('dependencies','optionalDependencies')) {
        if ($manifest.PSObject.Properties.Name -notcontains $section) { continue }
        foreach ($property in $manifest.$section.PSObject.Properties) {
            $dependency = Find-Package $property.Name $PackageDir
            if (!$dependency) { if ($section -eq 'dependencies') { throw ('Missing production dependency: ' + $property.Name) }; continue }
            Add-Package $dependency
        }
    }
}
$extract = Find-Package 'extract-zip' ([IO.Path]::GetDirectoryName($ProductionNodeModules))
if (!$extract) { throw 'extract-zip is missing from ProductionNodeModules.' }
$extractManifest = Get-Content -LiteralPath (Join-Path $extract 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$sourceLock = Get-Content -LiteralPath (Join-Path $stage 'swapper/package-lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($extractManifest.version -ne $sourceLock.packages.'node_modules/extract-zip'.version) { throw 'extract-zip does not match the source lockfile.' }
Add-Package $extract
Json-Write (Join-Path $licenses 'inventory.json') ([ordered]@{schema=1;sourceCommit=$resolvedCommit;licenses=@($licenseInventory);productionPackages=@($packageInventory)})
# Keep a portable provenance inventory in the package, never absolute input paths.
$files = @((Get-ChildItem -LiteralPath $stage -Recurse -File -Force | Sort-Object FullName) | ForEach-Object { [ordered]@{file=(Relative $stage $_.FullName);bytes=$_.Length;sha256=(Hash $_.FullName)} })
Json-Write (Join-Path $stage 'deploy/release-files.json') ([ordered]@{schema=1;release=$Release;sourceCommit=$resolvedCommit;files=$files})
$archive = Join-Path $OutRoot ('DLSS5-Swapper-WuWa-' + $Release + '.zip')
[IO.Compression.ZipFile]::CreateFromDirectory($stage,$archive,[IO.Compression.CompressionLevel]::Optimal,$false)
Json-Write (Join-Path $OutRoot 'build-release.json') ([ordered]@{schema=1;release=$Release;sourceCommit=$resolvedCommit;archive=[IO.Path]::GetFileName($archive);archiveSha256=(Hash $archive);archiveBytes=(Get-Item -LiteralPath $archive).Length;trackedSourceFiles=$tree.Count;productionPackages=@($packageInventory);nativeTemplateSha256=$nativeHash;overlaySha256=(Hash $OverlayFile)})
Write-Output ('Created ' + $archive)
Write-Output ('SHA256 ' + (Hash $archive))
