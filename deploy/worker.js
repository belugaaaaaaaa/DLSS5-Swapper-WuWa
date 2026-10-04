// SPDX-License-Identifier: MIT
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { runDeployment, absolute, assertNoLinks, inside } = require('./lib/deploy-core');

const fail = (code, message) => Object.assign(new Error(message), { code });
function powershell(script, environment = {}, runner = execFile) {
  if (process.platform !== 'win32') return Promise.reject(fail('errProcessInspection', '生产部署只支持 Windows，未检查游戏进程时不会写入。'));
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return new Promise((resolve, reject) => runner(executable, ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...environment } },
    (error, stdout) => error ? reject(fail('errProcessInspection', '无法可靠检查游戏进程或重解析点，本次未修改游戏。')) : resolve(stdout)));
}

async function assertGameClosed(gameRoot, targetExe, runner = execFile) {
  let rows;
  try {
    const output = await powershell("$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath) | ConvertTo-Json -Compress", {}, runner);
    rows = JSON.parse(output.replace(/^\uFEFF/, '').trim() || '[]');
    if (!Array.isArray(rows)) rows = [rows];
    if (rows.some(row => !row || !Number.isInteger(row.ProcessId) || row.ProcessId < 0 || typeof row.Name !== 'string' ||
      (row.ExecutablePath !== null && typeof row.ExecutablePath !== 'string') || (row.ExecutablePath && !path.isAbsolute(row.ExecutablePath)))) throw Error('invalid process data');
    if (!rows.some(row => row.ProcessId === process.pid)) throw Error('incomplete process snapshot');
  } catch (error) { throw fail(error.code || 'errProcessInspection', '无法可靠取得游戏进程列表，本次未修改游戏。'); }
  for (const row of rows) {
    if (row.ProcessId === process.pid) continue;
    const imagePath = row.ExecutablePath?.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\(?=[a-zA-Z]:\\)/, '');
    if (imagePath && inside(gameRoot, imagePath)) throw fail('errGameRunning', '请先关闭鸣潮及其游戏目录中的启动器/辅助进程。');
    if (!row.ExecutablePath && [path.basename(targetExe).toLowerCase(), 'dlss5-feed-host64.exe'].includes(row.Name.toLowerCase())) throw fail('errGameRunning', '发现无法确认路径的同名游戏进程，请关闭后重试。');
  }
}

async function assertNoReparsePoints(paths, runner = execFile) {
  const script = "$ErrorActionPreference='Stop'; $taskPaths=ConvertFrom-Json $env:WUWA_DEPLOY_CHECK_PATHS; foreach($taskPath in $taskPaths){ $taskCurrent=[IO.Path]::GetFullPath($taskPath); while($taskCurrent){ if(Test-Path -LiteralPath $taskCurrent){ $taskItem=Get-Item -Force -LiteralPath $taskCurrent; if(($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){ throw 'ReparsePoint refused' } }; $taskParent=[IO.Directory]::GetParent($taskCurrent); if($null -eq $taskParent){break}; $taskCurrent=$taskParent.FullName } }; 'OK'";
  const result = await powershell(script, { WUWA_DEPLOY_CHECK_PATHS: JSON.stringify(paths) }, runner);
  if (result.trim() !== 'OK') throw fail('errReparsePoint', '无法确认路径不含重解析点，本次未修改游戏。');
}

function atomicStatus(file, value) {
  assertNoLinks(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(temporary, file);
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  if (argv.length !== 4 || argv[0] !== '--request' || argv[2] !== '--status') throw fail('errArguments', '使用 --request <本地JSON> --status <本地JSON>。');
  const requestFile = absolute(argv[1], '请求文件');
  const statusFile = absolute(argv[3], '状态文件');
  assertNoLinks(requestFile); assertNoLinks(statusFile);
  if (requestFile.toLowerCase() === statusFile.toLowerCase() || fs.statSync(requestFile).size > 64 * 1024) throw fail('errArguments', '请求与状态文件必须独立，且请求不能超过 64 KiB。');
  const request = JSON.parse(fs.readFileSync(requestFile, 'utf8').replace(/^\uFEFF/, ''));
  const allowed = new Set(['action', 'gameRoot', 'cacheRoot', 'officialResources', 'officialPortable', 'templateRoot', 'antiCheatAcknowledged']);
  if (!request || Array.isArray(request) || Object.keys(request).some(key => !allowed.has(key)) || (request.antiCheatAcknowledged !== undefined && typeof request.antiCheatAcknowledged !== 'boolean')) throw fail('errArguments', '部署请求字段不兼容。');
  const gameRoot = absolute(request.gameRoot, '鸣潮根目录');
  const templateRoot = absolute(request.templateRoot, '模板目录');
  if ([requestFile, statusFile].some(file => inside(gameRoot, file) || inside(templateRoot, file))) throw fail('errUnsafePath', '请求和状态文件不能放在游戏或可信模板目录。');
  let sequence = 0;
  const publish = value => atomicStatus(statusFile, { schema: 1, sequence: ++sequence, updatedAt: new Date().toISOString(), ...value });
  publish({ status: 'running', phase: 'checking', percent: 0, message: '正在准备部署。' });
  try {
    const result = await (dependencies.runDeployment || runDeployment)(request,
      event => publish({ status: 'running', phase: event.phase || 'working', percent: event.percent ?? 0, message: event.message || '正在处理。' }));
    publish({ status: 'completed', phase: 'done', percent: 100, message: request.action === 'prepare' ? '准备完成，游戏文件未修改。' : request.action === 'restore' ? '鸣潮插件已卸载，游戏原文件保留。' : '插件安装完成；请进游戏后用 F8 确认实际运行状态。', result });
    return result;
  } catch (error) {
    publish({ status: 'failed', phase: 'error', percent: 0, message: error.message || '部署失败。', error: { code: error.code || 'errDeployment', message: error.message || '部署失败。' } });
    throw error;
  }
}

module.exports = { main, assertGameClosed, assertNoReparsePoints, atomicStatus };
if (require.main === module) main().catch(() => { process.exitCode = 1; });
