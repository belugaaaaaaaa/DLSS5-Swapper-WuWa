# SPDX-License-Identifier: MIT
[CmdletBinding()]
param([string]$CacheRoot, [switch]$BootstrapNode, [string]$StatusPath, [string]$RenderPath)
$ErrorActionPreference = 'Stop'
if (!$CacheRoot) { $CacheRoot = Join-Path $env:LOCALAPPDATA 'WuWa-Swapper-Community' }
$pins = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'download-pins.json') -Raw -Encoding UTF8 | ConvertFrom-Json
function Write-SetupStatus([string]$state, [string]$message, [string]$nodePath = '') {
    $text = @{schema=1;status=$state;phase='bootstrap';message=$message;nodePath=$nodePath} | ConvertTo-Json -Compress
    $temporary = $StatusPath + '.tmp'
    [IO.File]::WriteAllText($temporary, $text, [Text.UTF8Encoding]::new($false))
    if (Test-Path -LiteralPath $StatusPath) {
        $previous = $StatusPath + '.previous'
        [IO.File]::Replace($temporary, $StatusPath, $previous)
        if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous }
    }
    else { [IO.File]::Move($temporary, $StatusPath) }
}
function Read-SetupState([string]$file) {
    $sharing=[IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
    $stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,$sharing)
    $reader=[IO.StreamReader]::new($stream,[Text.Encoding]::UTF8,$true)
    try { return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() }
}
function Assert-SetupCache {
    if (![IO.Path]::IsPathRooted($CacheRoot)) { throw '缓存目录必须是完整路径。' }
    $root = [IO.Path]::GetFullPath($CacheRoot).TrimEnd('\')
    if ($root.TrimEnd('\') -eq [IO.Path]::GetPathRoot($root).TrimEnd('\')) { throw '不能把整个磁盘作为缓存目录。' }
    foreach ($candidate in @($root,(Join-Path $root 'tools'),(Join-Path $root 'downloads'),(Join-Path $root 'requests'),(Join-Path $root ('tools\' + $pins.node.directory)))) {
      for ($dir = $candidate; $dir; $dir = [IO.Path]::GetDirectoryName($dir.TrimEnd('\'))) {
        if ((Test-Path -LiteralPath $dir) -and ((Get-Item -LiteralPath $dir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '缓存目录不能经过链接或目录联接。' }
      }
    }
    return $root
}
function Test-Contained([string]$parent, [string]$child) {
    $parent=[IO.Path]::GetFullPath($parent).TrimEnd('\')
    $child=[IO.Path]::GetFullPath($child).TrimEnd('\')
    return $child.Equals($parent,[StringComparison]::OrdinalIgnoreCase) -or $child.StartsWith($parent + '\',[StringComparison]::OrdinalIgnoreCase)
}
function Assert-DeploymentPaths([string]$gameRoot, [string]$templateRoot) {
    $cache=Assert-SetupCache
    if ((Test-Contained $gameRoot $cache) -or (Test-Contained $cache $gameRoot) -or (Test-Contained $templateRoot $cache) -or (Test-Contained $cache $templateRoot)) { throw '缓存必须独立于游戏和部署组件目录，本次未下载或安装。' }
    $exe=Join-Path $gameRoot 'Wuthering Waves Game\Client\Binaries\Win64\Client-Win64-Shipping.exe'
    if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw '这个目录下没有找到鸣潮主程序，请选择包含 Wuthering Waves Game 的目录。' }
    for($dir=$exe; $dir; $dir=[IO.Path]::GetDirectoryName($dir.TrimEnd('\'))) {
        if ((Test-Path -LiteralPath $dir) -and ((Get-Item -LiteralPath $dir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '游戏目录不能经过链接或目录联接，本次未下载或安装。' }
    }
    return $cache
}
function Get-PortableNode {
    $root=Assert-SetupCache
    $nodeRoot = Join-Path $root ('tools\' + $pins.node.directory)
    $nodeExe = Join-Path $nodeRoot 'node.exe'
    $receipt = Join-Path $nodeRoot '.verified.json'
    if (Test-Path -LiteralPath $nodeExe) {
        $item=Get-Item -LiteralPath $nodeExe -Force
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or (Get-FileHash -LiteralPath $nodeExe).Hash.ToLowerInvariant() -ne $pins.node.executableSha256) { throw '运行环境缓存已被修改，请换一个缓存目录后重试。' }
        if (!(Test-Path -LiteralPath $receipt)) { @{archiveSha256=$pins.node.sha256;nodeSha256=$pins.node.executableSha256} | ConvertTo-Json | Set-Content -LiteralPath $receipt -Encoding UTF8 }
        return $nodeExe
    }
    $downloads = Join-Path $root 'downloads'
    New-Item -ItemType Directory -Path $downloads -Force | Out-Null
    $archive = Join-Path $downloads $pins.node.filename
    if (!(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive).Hash.ToLowerInvariant() -ne $pins.node.sha256) {
        Write-SetupStatus 'running' '正在下载便携运行环境，之后会自动复用。'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $partial = $archive + '.' + [guid]::NewGuid().ToString('N') + '.part'
        $client = New-Object Net.WebClient
        try {
            $client.DownloadFile($pins.node.url, $partial)
            if ((Get-FileHash -LiteralPath $partial).Hash.ToLowerInvariant() -ne $pins.node.sha256) { throw '运行环境下载校验失败。' }
            Move-Item -LiteralPath $partial -Destination $archive -Force
        } finally { $client.Dispose(); if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial } }
    }
    Write-SetupStatus 'running' '正在准备便携运行环境。'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $temporaryRoot = Join-Path $root ('tools\.node-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName.Contains('..') -or [IO.Path]::IsPathRooted($entry.FullName)) { throw '运行环境归档路径无效。' }
            $destination = [IO.Path]::GetFullPath((Join-Path $temporaryRoot $entry.FullName))
            if (!$destination.StartsWith($temporaryRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '运行环境归档路径越界。' }
            if (!$entry.Name) { New-Item -ItemType Directory -Path $destination -Force | Out-Null; continue }
            New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $false)
        }
    } finally { $zip.Dispose() }
    $extracted = Join-Path $temporaryRoot $pins.node.directory
    if (!(Test-Path -LiteralPath (Join-Path $extracted 'node.exe'))) { throw '运行环境归档不完整。' }
    if ((Get-FileHash -LiteralPath (Join-Path $extracted 'node.exe')).Hash.ToLowerInvariant() -ne $pins.node.executableSha256) { throw '运行环境执行文件校验失败。' }
    if (Test-Path -LiteralPath $nodeRoot) { throw '运行环境目录已存在，本次未覆盖。' }
    Move-Item -LiteralPath $extracted -Destination $nodeRoot
    @{archiveSha256=$pins.node.sha256;nodeSha256=(Get-FileHash -LiteralPath $nodeExe).Hash.ToLowerInvariant()} | ConvertTo-Json | Set-Content -LiteralPath $receipt -Encoding UTF8
    return $nodeExe
}
if ($BootstrapNode) {
    try { $nodePath = Get-PortableNode; Write-SetupStatus 'completed' '运行环境准备完成。' $nodePath; exit 0 }
    catch { Write-SetupStatus 'failed' $_.Exception.Message; exit 1 }
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object Windows.Forms.Form
$form.Text = '鸣潮 · 社区显卡减负部署助手'
$form.ClientSize = New-Object Drawing.Size(740, 560)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = New-Object Drawing.Font('Microsoft YaHei UI', 10)
$form.BackColor = [Drawing.Color]::FromArgb(247,249,252)
function Add-Label([string]$text, [int]$x, [int]$y, [int]$width, [int]$height, [int]$size = 10) {
    $label = New-Object Windows.Forms.Label
    $label.Text=$text; $label.SetBounds($x,$y,$width,$height)
    $label.Font=New-Object Drawing.Font('Microsoft YaHei UI',$size)
    $form.Controls.Add($label); return $label
}
$null = Add-Label '让显卡轻松一些，让画面依然满意' 28 23 680 42 18
$null = Add-Label '选好鸣潮目录，工具会准备组件、校验并安装。安装完成后进游戏按 F8。' 28 74 680 28
$null = Add-Label '1  选择鸣潮安装目录（包含 Wuthering Waves Game 的文件夹）' 28 121 680 27
$game = New-Object Windows.Forms.TextBox
$game.SetBounds(28,155,565,30); $game.ReadOnly=$true; $form.Controls.Add($game)
$browse = New-Object Windows.Forms.Button
$browse.Text='选择目录'; $browse.SetBounds(606,153,105,34); $form.Controls.Add($browse)
$browse.Add_Click({
    $dialog=New-Object Windows.Forms.FolderBrowserDialog
    $dialog.Description='选择包含 Wuthering Waves Game 的鸣潮安装目录'
    $dialog.ShowNewFolderButton=$false
    if ($dialog.ShowDialog($form) -eq 'OK') { $game.Text=$dialog.SelectedPath }
    $dialog.Dispose()
})
$null = Add-Label '2  原版组件来源' 28 211 500 26
$source = New-Object Windows.Forms.TextBox
$source.SetBounds(28,244,565,30); $source.ReadOnly=$true; $source.Text='自动从官方 v2.2.7 下载（首次需要联网）'; $form.Controls.Add($source)
$script:officialPortable=''
$selectSource=New-Object Windows.Forms.Button
$selectSource.Text='选择已有包'; $selectSource.SetBounds(606,242,105,34); $form.Controls.Add($selectSource)
$selectSource.Add_Click({
    $dialog=New-Object Windows.Forms.OpenFileDialog
    $dialog.Title='选择未经修改的官方 v2.2.7 portable（不运行这个程序）'
    $dialog.Filter='原版 portable (*.exe)|*.exe'
    if ($dialog.ShowDialog($form) -eq 'OK') { $script:officialPortable=$dialog.FileName; $source.Text=$dialog.FileName }
    $dialog.Dispose()
})
$autoLink=New-Object Windows.Forms.LinkLabel
$autoLink.Text='改用自动下载'; $autoLink.SetBounds(28,280,180,25); $form.Controls.Add($autoLink)
$autoLink.Add_LinkClicked({$script:officialPortable=''; $source.Text='自动从官方 v2.2.7 下载（首次需要联网）'})
$consent=New-Object Windows.Forms.CheckBox
$consent.Text='我同意随包列出的第三方组件许可，并了解在线游戏可能限制插件使用。'
$consent.SetBounds(28,323,680,30); $form.Controls.Add($consent)
$terms=New-Object Windows.Forms.LinkLabel
$terms.Text='查看许可与组件来源'; $terms.SetBounds(28,355,280,25); $form.Controls.Add($terms)
$terms.Add_LinkClicked({
    $licenseForm=New-Object Windows.Forms.Form
    $licenseForm.Text='组件来源和许可'; $licenseForm.Size=New-Object Drawing.Size(850,640)
    $licenseForm.StartPosition='CenterParent'
    $licenseText=New-Object Windows.Forms.TextBox
    $licenseText.Multiline=$true; $licenseText.ReadOnly=$true; $licenseText.ScrollBars='Both'
    $licenseText.Dock='Fill'; $licenseText.WordWrap=$true
    $licenseText.Font=New-Object Drawing.Font('Microsoft YaHei UI',10)
    $text=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'THIRD_PARTY.md') -Raw -Encoding UTF8
    $licenseDirectory=Join-Path $PSScriptRoot 'bundle\licenses'
    if (Test-Path -LiteralPath $licenseDirectory) {
        foreach($file in Get-ChildItem -LiteralPath $licenseDirectory -Recurse -File | Sort-Object FullName) {
            $content=Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
            if ($file.Extension -eq '.docx') {
                Add-Type -AssemblyName System.IO.Compression.FileSystem
                $document=[IO.Compression.ZipFile]::OpenRead($file.FullName)
                try {
                    $reader=[IO.StreamReader]::new($document.GetEntry('word/document.xml').Open())
                    try { $xml=[xml]$reader.ReadToEnd(); $content=($xml.SelectNodes('//*[local-name()="p"]') | ForEach-Object {$_.InnerText}) -join "`r`n" } finally { $reader.Dispose() }
                } finally { $document.Dispose() }
            } elseif ($file.Extension -eq '.rtf') {
                $rich=New-Object Windows.Forms.RichTextBox
                try { $rich.Rtf=$content; $content=$rich.Text } catch {} finally { $rich.Dispose() }
            } elseif ($file.Extension -eq '.html') {
                $content=[regex]::Replace($content,'(?is)<(script|style)[^>]*>.*?</\1>','')
                $content=[Net.WebUtility]::HtmlDecode([regex]::Replace($content,'<[^>]+>',' '))
            }
            $text+="`r`n`r`n========== " + $file.Name + " ==========`r`n" + $content
        }
    }
    $licenseText.Text=$text; $licenseForm.Controls.Add($licenseText)
    $null=$licenseForm.ShowDialog($form); $licenseForm.Dispose()
})
$install=New-Object Windows.Forms.Button
$install.Text='一键安装 / 修复'; $install.SetBounds(28,397,230,46)
$install.BackColor=[Drawing.Color]::FromArgb(36,110,91); $install.ForeColor=[Drawing.Color]::White
$form.Controls.Add($install)
$restore=New-Object Windows.Forms.Button
$restore.Text='卸载鸣潮插件'; $restore.SetBounds(276,397,200,46); $form.Controls.Add($restore)
$progress=New-Object Windows.Forms.ProgressBar
$progress.SetBounds(28,463,683,10); $form.Controls.Add($progress)
$status=Add-Label '请先关闭鸣潮。无需安装编译环境，已校验的下载会复用。' 28 484 683 54
$script:child=$null; $script:request=$null; $script:statusFile=''; $script:nodeExe=''; $script:stage=''; $script:busy=$false
function Start-HiddenProcess([string]$file, [string]$arguments) {
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=$file; $info.Arguments=$arguments; $info.UseShellExecute=$false
    $info.CreateNoWindow=$true; $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
    $process=New-Object Diagnostics.Process
    $process.StartInfo=$info
    if (!$process.Start()) { throw '无法启动部署任务。' }
    return $process
}
function Set-Busy([bool]$value) {
    $script:busy=$value
    foreach ($control in @($browse,$selectSource,$autoLink,$install,$restore,$consent)) { $control.Enabled=!$value }
    $progress.Style=if($value){[Windows.Forms.ProgressBarStyle]::Marquee}else{[Windows.Forms.ProgressBarStyle]::Blocks}
}
function Start-Worker {
    $null=Assert-SetupCache
    $expectedNode=Join-Path ([IO.Path]::GetFullPath($CacheRoot)) ('tools\' + $pins.node.directory + '\node.exe')
    $nodeItem=Get-Item -LiteralPath $expectedNode -Force
    if ($nodeItem.PSIsContainer -or ($nodeItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or (Get-FileHash -LiteralPath $expectedNode).Hash.ToLowerInvariant() -ne $pins.node.executableSha256) { throw '运行环境执行前校验失败，请更换缓存目录后重试。' }
    $script:nodeExe=$expectedNode
    $requestFile=Join-Path $CacheRoot ('requests\' + [guid]::NewGuid().ToString('N') + '.json')
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($requestFile)) -Force | Out-Null
    $script:request | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $requestFile -Encoding UTF8
    $script:statusFile=$requestFile + '.status.json'
    $script:child=Start-HiddenProcess $script:nodeExe ('"' + (Join-Path $PSScriptRoot 'worker.js') + '" --request "' + $requestFile + '" --status "' + $script:statusFile + '"')
    $script:stage='worker'
}
function Start-Deployment([string]$action) {
    if (!$game.Text) { $status.Text='请先选择鸣潮安装目录。'; return }
    if ($action -eq 'install' -and !$consent.Checked) { $status.Text='请先查看许可与组件来源，勾选同意后继续。'; return }
    $bundle=Join-Path $PSScriptRoot 'bundle'
    if (!(Test-Path -LiteralPath (Join-Path $bundle 'bundle.json'))) { $status.Text='这是源码目录，请从 GitHub Releases 下载完整部署助手压缩包。'; return }
    $script:request=@{action=$action;gameRoot=$game.Text;cacheRoot=$CacheRoot;officialPortable=$script:officialPortable;templateRoot=$bundle;antiCheatAcknowledged=$consent.Checked}
    try {
        $script:CacheRoot=Assert-DeploymentPaths $game.Text $bundle
        $script:request.cacheRoot=$script:CacheRoot
        Set-Busy $true
        $status.Text='正在检查并准备部署环境……'
        New-Item -ItemType Directory -Path (Join-Path $CacheRoot 'requests') -Force | Out-Null
        $script:statusFile=Join-Path $CacheRoot ('requests\bootstrap-' + [guid]::NewGuid().ToString('N') + '.json')
        $psExe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $script:child=Start-HiddenProcess $psExe ('-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -BootstrapNode -CacheRoot "' + $CacheRoot + '" -StatusPath "' + $script:statusFile + '"')
        $script:stage='bootstrap'
    } catch { Set-Busy $false; $status.Text=$_.Exception.Message }
}
$install.Add_Click({Start-Deployment 'install'})
$restore.Add_Click({Start-Deployment 'restore'})
$timer=New-Object Windows.Forms.Timer
$timer.Interval=400
$timer.Add_Tick({
    if (!$script:busy -or !$script:child) { return }
    try {
        $state=$null
        if (Test-Path -LiteralPath $script:statusFile) {
            try { $state=Read-SetupState $script:statusFile; $status.Text=$state.message } catch {}
        }
        if (!$script:child.HasExited) { return }
        $code=$script:child.ExitCode
        $errText=$script:child.StandardError.ReadToEnd()
        $script:child.Dispose(); $script:child=$null
        if ($script:stage -eq 'bootstrap' -and $code -eq 0 -and $state.status -eq 'completed' -and $state.nodePath) {
            Start-Worker; return
        }
        Set-Busy $false
        if ($code -eq 0 -and $state.status -eq 'completed') {
            $status.Text=if($script:request.action -eq 'restore'){'鸣潮插件已卸载，个人调节记录会保留。'}else{'安装完成。启动鸣潮，按 F8 查看并调节；部署助手可以关闭。'}
            $progress.Value=100
        } elseif ($state.error.message) { $status.Text=$state.error.message }
        elseif ($state.message) { $status.Text=$state.message }
        else { $status.Text='任务未完成，请查看缓存 requests 中的状态记录后重试。' }
    } catch { Set-Busy $false; $status.Text=$_.Exception.Message }
})
$timer.Start()
$form.Add_FormClosing({
    if ($script:busy) { $_.Cancel=$true; $status.Text='正在处理安装事务，请等待本次任务结束后关闭。' }
})
if ($RenderPath) {
    $form.ShowInTaskbar=$false
    $form.StartPosition='Manual'
    $form.Location=New-Object Drawing.Point(-32000,-32000)
    $form.Show()
    [Windows.Forms.Application]::DoEvents()
    $form.CreateControl()
    foreach($control in $form.Controls){$control.CreateControl()}
    $bitmap=New-Object Drawing.Bitmap($form.Width,$form.Height)
    $form.DrawToBitmap($bitmap, [Drawing.Rectangle]::new(0,0,$form.Width,$form.Height))
    $bitmap.Save([IO.Path]::GetFullPath($RenderPath), [Drawing.Imaging.ImageFormat]::Png)
    $form.Hide()
    $bitmap.Dispose(); $timer.Dispose(); $form.Dispose(); exit 0
}
[Windows.Forms.Application]::Run($form)
$timer.Dispose(); $form.Dispose()
