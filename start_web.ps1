$ErrorActionPreference = "Stop"

$rootPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$webPath = Join-Path $rootPath "web"
$pythonPath = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$pageUrl = "http://127.0.0.1:8000/index.html"
$stdoutPath = Join-Path $env:TEMP "a-department-web-server.out.log"
$stderrPath = Join-Path $env:TEMP "a-department-web-server.err.log"

function Show-LaunchError([string]$message) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        $message,
        "A부 국회 요구자료 실행 오류",
        [System.Windows.MessageBoxButton]::OK,
        [System.Windows.MessageBoxImage]::Error
    ) | Out-Null
}

function Test-WebServer {
    try {
        $response = Invoke-WebRequest -Uri $pageUrl -UseBasicParsing -TimeoutSec 1
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

try {
    if (-not (Test-Path -LiteralPath $pythonPath)) {
        throw "Python 실행 파일을 찾지 못했습니다.`n$pythonPath"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $webPath "index.html"))) {
        throw "시작 화면 파일을 찾지 못했습니다.`n$webPath"
    }

    if (-not (Test-WebServer)) {
        $server = Start-Process -FilePath $pythonPath `
            -ArgumentList @("-m", "http.server", "8000", "--bind", "127.0.0.1", "-d", $webPath) `
            -WindowStyle Hidden `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath `
            -PassThru

        $ready = $false
        for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
            Start-Sleep -Milliseconds 200
            if (Test-WebServer) {
                $ready = $true
                break
            }
            if ($server.HasExited) {
                break
            }
        }

        if (-not $ready) {
            $detail = if (Test-Path -LiteralPath $stderrPath) {
                (Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue).Trim()
            } else { "" }
            throw "웹서버가 시작되지 않았습니다.`n$detail"
        }
    }

    Start-Process $pageUrl
}
catch {
    Show-LaunchError $_.Exception.Message
    exit 1
}
