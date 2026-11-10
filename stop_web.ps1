$ErrorActionPreference = "Stop"

try {
    $listeners = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
    $stopped = 0

    foreach ($listener in $listeners) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
        if ($process -and $process.Name -eq "python.exe" -and $process.CommandLine -match "http\.server\s+8000") {
            Stop-Process -Id $listener.OwningProcess -Force
            $stopped += 1
        }
    }

    Add-Type -AssemblyName PresentationFramework
    $message = if ($stopped -gt 0) { "웹서버를 종료했습니다." } else { "실행 중인 웹서버가 없습니다." }
    [System.Windows.MessageBox]::Show($message, "A부 국회 요구자료") | Out-Null
}
catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, "웹서버 종료 오류") | Out-Null
    exit 1
}
