param()

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

$script:backend = $null
$script:frontend = $null
$script:cleanupDone = $false

function Cleanup {
    if ($script:cleanupDone) { return }
    $script:cleanupDone = $true

    Write-Host "`n" -NoNewline
    Write-Host "===========================================" -ForegroundColor Yellow
    Write-Host "  正在关闭所有服务..." -ForegroundColor Yellow
    Write-Host "===========================================" -ForegroundColor Yellow

    foreach ($proc in @($script:backend, $script:frontend)) {
        if ($null -eq $proc) { continue }
        $name = if ($proc.Name -match 'cargo') { 'Backend' } elseif ($proc.Name -match 'node') { 'Frontend' } else { "PID $($proc.Id)" }
        if (!$proc.HasExited) {
            try {
                $proc.Kill()
                Write-Host "  [x] $name (PID $($proc.Id)) 已停止" -ForegroundColor Green
            } catch {
                Write-Host "  [-] $name (PID $($proc.Id)) 无法终止: $_" -ForegroundColor DarkYellow
            }
        } else {
            Write-Host "  [-] $name (PID $($proc.Id)) 已自行退出" -ForegroundColor Gray
        }
    }

    # 额外扫一遍可能残留的 cargo/pnpm/node 子进程
    $extraProcs = @(
        @{ Name = 'cargo'; Path = "$root\api" }
        @{ Name = 'pnpm';  Path = "$root\web" }
        @{ Name = 'node';  Path = "$root\web" }
    )
    foreach ($t in $extraProcs) {
        Get-Process -Name $t.Name -ErrorAction SilentlyContinue | Where-Object {
            try { $_.CommandLine -match [Regex]::Escape($t.Path) } catch { $false }
        } | ForEach-Object {
            try { $_.Kill(); Write-Host "  [x] $($t.Name) (PID $($_.Id)) 已停止" -ForegroundColor Green } catch { }
        }
    }

    Write-Host "所有服务已停止。" -ForegroundColor Green
}

# -- Ctrl+C 拦截 ----------------------------------------------
$consoleHandler = [System.EventHandler[System.ConsoleCancelEventArgs]]{
    param($sender, $e)
    $e.Cancel = $true
    Write-Host "`n" -NoNewline
    Write-Host "[!] 收到 Ctrl+C，正在清理..." -ForegroundColor Yellow
    Cleanup
    [Environment]::Exit(0)
}
[Console]::CancelKeyPress += $consoleHandler

# -- 启动 ----------------------------------------------------
try {
    # 检测必备命令
    $missing = @()
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { $missing += 'cargo' }
    if (-not (Get-Command pnpm  -ErrorAction SilentlyContinue)) { $missing += 'pnpm' }
    if ($missing.Count -gt 0) {
        Write-Host "[!] 缺少命令: $($missing -join ', ')" -ForegroundColor Red
        Write-Host "  请先安装后再运行此脚本。" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host "  Mengnex 一键启动" -ForegroundColor Cyan
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host ""

    # -- 后端 ------------------------------------------------
    Write-Host "[+] 启动后端 (Rust API)..." -ForegroundColor Green
    Write-Host "  端口: 3001  (可通过 PORT 环境变量修改)" -ForegroundColor Gray
    Write-Host "  工作目录: $root\api" -ForegroundColor Gray

    $script:backend = Start-Process -NoNewWindow -PassThru `
        -FilePath "cargo" -ArgumentList "run" `
        -WorkingDirectory "$root\api"
    Write-Host "  PID: $($script:backend.Id)" -ForegroundColor Gray

    # 初次编译需要时间，等一会儿再起前端
    Write-Host "  等待后端编译启动..." -ForegroundColor Gray
    Start-Sleep -Seconds 5

    # -- 前端 ------------------------------------------------
    Write-Host "[+] 启动前端 (Next.js)..." -ForegroundColor Green
    Write-Host "  端口: 3000" -ForegroundColor Gray
    Write-Host "  工作目录: $root\web" -ForegroundColor Gray

    $script:frontend = Start-Process -NoNewWindow -PassThru `
        -FilePath "pnpm" -ArgumentList "dev" `
        -WorkingDirectory "$root\web"
    Write-Host "  PID: $($script:frontend.Id)" -ForegroundColor Gray

    # -- 完成提示 --------------------------------------------
    Write-Host ""
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host "  两个服务正在运行!" -ForegroundColor Cyan
    Write-Host "  后端 API: http://localhost:3001" -ForegroundColor White
    Write-Host "  API 文档: http://localhost:3001/docs" -ForegroundColor White
    Write-Host "  前端界面: http://localhost:3000" -ForegroundColor White
    Write-Host "  按 Ctrl+C 关闭所有服务" -ForegroundColor Yellow
    Write-Host "===========================================" -ForegroundColor Cyan

    # -- 等待任一进程退出 ------------------------------------
    Wait-Process -InputObject @($script:backend, $script:frontend) -ErrorAction SilentlyContinue

    Write-Host "`n[!] 某个服务异常退出，正在关闭所有进程..." -ForegroundColor Red
} catch {
    Write-Host "`n[!] 启动出错: $_" -ForegroundColor Red
} finally {
    Cleanup
}
