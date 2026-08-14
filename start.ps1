param()

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

$script:backend = $null
$script:frontend = $null
$script:cleanupDone = $false

$backendPort = if ([string]::IsNullOrWhiteSpace($env:PORT)) { 3001 } else { [int]$env:PORT }
$frontendPort = 3000

function Stop-ListenerOnPort {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$ServiceName
    )

    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) {
        Write-Host "  [-] $ServiceName 端口 $Port 未被占用" -ForegroundColor Gray
        return
    }

    foreach ($processId in @($listeners.OwningProcess | Sort-Object -Unique)) {
        try {
            $process = Get-Process -Id $processId -ErrorAction Stop
            Write-Host "  [x] 关闭占用 $ServiceName 端口 $Port 的 $($process.ProcessName) (PID $processId)" -ForegroundColor Yellow
            Stop-Process -Id $processId -Force -ErrorAction Stop
        } catch {
            Write-Host "  [!] 无法关闭占用 $ServiceName 端口 $Port 的 PID ${processId}: $_" -ForegroundColor Red
            throw
        }
    }

    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
            Write-Host "  [x] $ServiceName 端口 $Port 已释放" -ForegroundColor Green
            return
        }
        Start-Sleep -Milliseconds 250
    }

    throw "$ServiceName 端口 $Port 仍被占用，已取消启动。"
}

function Wait-ForListenerOnPort {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [int]$ProcessId,
        [int]$TimeoutSeconds = 60
    )

    for ($attempt = 0; $attempt -lt ($TimeoutSeconds * 4); $attempt++) {
        if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
            Write-Host "  [x] $ServiceName 已在端口 $Port 就绪" -ForegroundColor Green
            return
        }

        if ($ProcessId -and -not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
            throw "$ServiceName (PID $ProcessId) 在监听端口 $Port 前已退出。"
        }

        Start-Sleep -Milliseconds 250
    }

    throw "$ServiceName 未能在 $TimeoutSeconds 秒内监听端口 $Port。"
}

function Cleanup {
    if ($script:cleanupDone) { return }
    $script:cleanupDone = $true

    Write-Host "`n" -NoNewline
    Write-Host "===========================================" -ForegroundColor Yellow
    Write-Host "  正在关闭所有服务..." -ForegroundColor Yellow
    Write-Host "===========================================" -ForegroundColor Yellow

    foreach ($proc in @($script:backend, $script:frontend)) {
        if ($null -eq $proc) { continue }
        $processId = $proc.Id
        $runningProc = Get-Process -Id $processId -ErrorAction SilentlyContinue
        $name = if ($processId -eq $script:backend.Id) { 'Backend' } elseif ($processId -eq $script:frontend.Id) { 'Frontend' } else { "PID $processId" }
        if ($null -ne $runningProc) {
            try {
                Stop-Process -Id $processId -Force -ErrorAction Stop
                Write-Host "  [x] $name (PID $processId) 已停止" -ForegroundColor Green
            } catch {
                Write-Host "  [-] $name (PID $processId) 无法终止: $_" -ForegroundColor DarkYellow
            }
        } else {
            Write-Host "  [-] $name (PID $processId) 已自行退出" -ForegroundColor Gray
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
try {
    $consoleHandler = [ConsoleCancelEventHandler]{
        param($sender, $e)
        $e.Cancel = $true
        Write-Host "`n" -NoNewline
        Write-Host "[!] 收到 Ctrl+C，正在清理..." -ForegroundColor Yellow
        Cleanup
        [Environment]::Exit(0)
    }
    [Console]::CancelKeyPress += $consoleHandler
} catch {
    Write-Host "[!] 当前 PowerShell 版本不支持 CancelKeyPress，跳过 Ctrl+C 拦截。" -ForegroundColor DarkYellow
}

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

    # -- 启动前清理端口占用 ----------------------------------
    Write-Host "[+] 检查并清理残留进程..." -ForegroundColor Green
    Stop-ListenerOnPort -Port $backendPort -ServiceName 'Backend'
    Stop-ListenerOnPort -Port $frontendPort -ServiceName 'Frontend'
    Write-Host ""

    # -- 后端 ------------------------------------------------
    Write-Host "[+] 启动后端 (Rust API)..." -ForegroundColor Green
    Write-Host "  端口: $backendPort  (可通过 PORT 环境变量修改)" -ForegroundColor Gray
    Write-Host "  工作目录: $root\api" -ForegroundColor Gray

    $script:backend = Start-Process -NoNewWindow -PassThru `
        -FilePath "cargo" -ArgumentList "run" `
        -WorkingDirectory "$root\api"
    Write-Host "  PID: $($script:backend.Id)" -ForegroundColor Gray

    # 后端可用后再启动前端，避免后端启动失败时留下孤立前端进程。
    Write-Host "  等待后端编译启动..." -ForegroundColor Gray
    Wait-ForListenerOnPort -Port $backendPort -ServiceName 'Backend' -ProcessId $script:backend.Id

    # -- 前端 ------------------------------------------------
    Write-Host "[+] 启动前端 (Next.js)..." -ForegroundColor Green
    Write-Host "  端口: 3000" -ForegroundColor Gray
    Write-Host "  工作目录: $root\web" -ForegroundColor Gray

    # 查找 pnpm 的可执行文件（优先 .cmd，避免 .ps1 无法被 Start-Process 执行）
    $pnpmPath = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $pnpmPath) {
        $pnpmPath = (Get-Command pnpm.exe -ErrorAction SilentlyContinue).Source
    }
    if (-not $pnpmPath) {
        $pnpmPath = (Get-Command pnpm -ErrorAction SilentlyContinue).Source
        # 如果是 .ps1 脚本，回退到 cmd 方式
        if ($pnpmPath -match '\.ps1$') {
            $pnpmPath = $null
        }
    }
    if ($pnpmPath) {
        $script:frontend = Start-Process -NoNewWindow -PassThru `
            -FilePath $pnpmPath -ArgumentList "dev" `
            -WorkingDirectory "$root\web"
    } else {
        # 回退：通过 cmd 启动 pnpm
        $script:frontend = Start-Process -NoNewWindow -PassThru `
            -FilePath "cmd" -ArgumentList "/c pnpm dev" `
            -WorkingDirectory "$root\web"
    }
    Write-Host "  PID: $($script:frontend.Id)" -ForegroundColor Gray
    Write-Host "  等待前端启动..." -ForegroundColor Gray
    Wait-ForListenerOnPort -Port $frontendPort -ServiceName 'Frontend' -TimeoutSeconds 30

    # -- 完成提示 --------------------------------------------
    Write-Host ""
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host "  两个服务正在运行!" -ForegroundColor Cyan
    Write-Host "  后端 API: http://localhost:$backendPort" -ForegroundColor White
    Write-Host "  API 文档: http://localhost:$backendPort/docs" -ForegroundColor White
    Write-Host "  前端界面: http://localhost:$frontendPort" -ForegroundColor White
    Write-Host "  按 Ctrl+C 关闭所有服务" -ForegroundColor Yellow
    Write-Host "===========================================" -ForegroundColor Cyan

    # -- 持续监测服务端口 ------------------------------------
    while ($true) {
        if (-not (Get-NetTCPConnection -LocalPort $backendPort -State Listen -ErrorAction SilentlyContinue)) {
            Write-Host "`n[!] Backend 已退出，正在关闭所有进程..." -ForegroundColor Red
            break
        }
        if (-not (Get-NetTCPConnection -LocalPort $frontendPort -State Listen -ErrorAction SilentlyContinue)) {
            Write-Host "`n[!] Frontend 已退出，正在关闭所有进程..." -ForegroundColor Red
            break
        }
        Start-Sleep -Seconds 1
    }
} catch {
    Write-Host "`n[!] 启动出错: $_" -ForegroundColor Red
} finally {
    Cleanup
}
