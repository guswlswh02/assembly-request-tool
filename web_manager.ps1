$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$rootPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$webPath = Join-Path $rootPath "web"
$pythonPath = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$pageUrl = "http://127.0.0.1:8000/index.html"
$stdoutPath = Join-Path $env:TEMP "a-department-web-server.out.log"
$stderrPath = Join-Path $env:TEMP "a-department-web-server.err.log"

function Test-WebServer {
    try {
        $request = [System.Net.HttpWebRequest]::Create($pageUrl)
        $request.Timeout = 500
        $request.ReadWriteTimeout = 500
        $response = $request.GetResponse()
        $ok = [int]$response.StatusCode -eq 200
        $response.Close()
        return $ok
    }
    catch {
        return $false
    }
}

function Start-WebServer {
    if (Test-WebServer) { return $true }
    if (-not (Test-Path -LiteralPath $pythonPath)) {
        throw "Python 실행 파일을 찾지 못했습니다.`n$pythonPath"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $webPath "index.html"))) {
        throw "시작 화면 파일을 찾지 못했습니다.`n$webPath"
    }

    $server = Start-Process -FilePath $pythonPath `
        -ArgumentList @("-m", "http.server", "8000", "--bind", "127.0.0.1", "-d", $webPath) `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru

    for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
        Start-Sleep -Milliseconds 200
        if (Test-WebServer) { return $true }
        if ($server.HasExited) { break }
    }

    $detail = if (Test-Path -LiteralPath $stderrPath) {
        (Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue).Trim()
    } else { "" }
    throw "웹서버가 시작되지 않았습니다.`n$detail"
}

function Stop-WebServer {
    $stopped = 0
    $processes = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue
    foreach ($process in $processes) {
        if ($process.CommandLine -match "http\.server\s+8000" -and $process.CommandLine -like "*$webPath*") {
            Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
            $stopped += 1
        }
    }
    return $stopped
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "A부 국회 요구자료 웹화면 관리"
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object System.Drawing.Size(570, 420)
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(245, 247, 248)
$form.Font = New-Object System.Drawing.Font("Malgun Gothic", 10)

$title = New-Object System.Windows.Forms.Label
$title.Text = "웹화면 실행 관리"
$title.Font = New-Object System.Drawing.Font("Malgun Gothic", 20, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(24, 50, 74)
$title.Location = New-Object System.Drawing.Point(28, 24)
$title.AutoSize = $true
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "총괄 담당 화면의 서버 상태를 확인하고 안전하게 켜거나 끕니다."
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(91, 108, 121)
$subtitle.Location = New-Object System.Drawing.Point(31, 70)
$subtitle.AutoSize = $true
$form.Controls.Add($subtitle)

$statusPanel = New-Object System.Windows.Forms.Panel
$statusPanel.Location = New-Object System.Drawing.Point(30, 108)
$statusPanel.Size = New-Object System.Drawing.Size(510, 118)
$statusPanel.BackColor = [System.Drawing.Color]::White
$statusPanel.BorderStyle = "FixedSingle"
$form.Controls.Add($statusPanel)

$statusDot = New-Object System.Windows.Forms.Label
$statusDot.Location = New-Object System.Drawing.Point(22, 24)
$statusDot.Size = New-Object System.Drawing.Size(68, 68)
$statusDot.TextAlign = "MiddleCenter"
$statusDot.Font = New-Object System.Drawing.Font("Malgun Gothic", 16, [System.Drawing.FontStyle]::Bold)
$statusPanel.Controls.Add($statusDot)

$statusTitle = New-Object System.Windows.Forms.Label
$statusTitle.Location = New-Object System.Drawing.Point(108, 24)
$statusTitle.AutoSize = $true
$statusTitle.Font = New-Object System.Drawing.Font("Malgun Gothic", 16, [System.Drawing.FontStyle]::Bold)
$statusPanel.Controls.Add($statusTitle)

$statusDescription = New-Object System.Windows.Forms.Label
$statusDescription.Location = New-Object System.Drawing.Point(111, 60)
$statusDescription.Size = New-Object System.Drawing.Size(370, 44)
$statusDescription.ForeColor = [System.Drawing.Color]::FromArgb(91, 108, 121)
$statusPanel.Controls.Add($statusDescription)

function New-ActionButton([string]$text, [int]$x, [System.Drawing.Color]$color) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $text
    $button.Location = New-Object System.Drawing.Point($x, 250)
    $button.Size = New-Object System.Drawing.Size(150, 48)
    $button.FlatStyle = "Flat"
    $button.FlatAppearance.BorderSize = 0
    $button.BackColor = $color
    $button.ForeColor = [System.Drawing.Color]::White
    $button.Cursor = "Hand"
    return $button
}

$startButton = New-ActionButton "서버 켜기" 30 ([System.Drawing.Color]::FromArgb(36, 95, 141))
$openButton = New-ActionButton "화면 열기" 195 ([System.Drawing.Color]::FromArgb(38, 114, 88))
$stopButton = New-ActionButton "서버 끄기" 360 ([System.Drawing.Color]::FromArgb(166, 62, 62))
$form.Controls.AddRange(@($startButton, $openButton, $stopButton))

$guide = New-Object System.Windows.Forms.Label
$guide.Location = New-Object System.Drawing.Point(31, 320)
$guide.Size = New-Object System.Drawing.Size(510, 64)
$guide.ForeColor = [System.Drawing.Color]::FromArgb(91, 108, 121)
$guide.Text = "ON이면 화면을 사용할 수 있습니다. OFF이면 화면을 열 수 없습니다.`n이 관리창을 닫아도 서버는 계속 실행됩니다. 사용이 끝나면 [서버 끄기]를 누르세요."
$form.Controls.Add($guide)

$refreshLabel = New-Object System.Windows.Forms.Label
$refreshLabel.Location = New-Object System.Drawing.Point(31, 392)
$refreshLabel.AutoSize = $true
$refreshLabel.ForeColor = [System.Drawing.Color]::FromArgb(125, 140, 150)
$form.Controls.Add($refreshLabel)

function Update-Status {
    $isOn = Test-WebServer
    if ($isOn) {
        $statusDot.Text = "ON"
        $statusDot.BackColor = [System.Drawing.Color]::FromArgb(223, 243, 236)
        $statusDot.ForeColor = [System.Drawing.Color]::FromArgb(38, 114, 88)
        $statusTitle.Text = "서버가 켜져 있습니다"
        $statusDescription.Text = "배분 화면을 사용할 수 있습니다. [화면 열기]로 접속하세요."
        $startButton.Enabled = $false
        $openButton.Enabled = $true
        $stopButton.Enabled = $true
    }
    else {
        $statusDot.Text = "OFF"
        $statusDot.BackColor = [System.Drawing.Color]::FromArgb(248, 226, 226)
        $statusDot.ForeColor = [System.Drawing.Color]::FromArgb(166, 62, 62)
        $statusTitle.Text = "서버가 꺼져 있습니다"
        $statusDescription.Text = "현재 화면에 접속할 수 없습니다. [서버 켜기]를 먼저 누르세요."
        $startButton.Enabled = $true
        $openButton.Enabled = $false
        $stopButton.Enabled = $false
    }
    $refreshLabel.Text = "상태 확인: $((Get-Date).ToString('HH:mm:ss'))"
}

$startButton.Add_Click({
    try {
        $form.UseWaitCursor = $true
        Start-WebServer | Out-Null
        Update-Status
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "서버 시작 오류", "OK", "Error") | Out-Null
    }
    finally {
        $form.UseWaitCursor = $false
    }
})

$openButton.Add_Click({
    if (Test-WebServer) {
        Start-Process $pageUrl
    }
    else {
        Update-Status
    }
})

$stopButton.Add_Click({
    try {
        Stop-WebServer | Out-Null
        Start-Sleep -Milliseconds 300
        Update-Status
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "서버 종료 오류", "OK", "Error") | Out-Null
    }
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({ Update-Status })
$timer.Start()
$form.Add_FormClosed({ $timer.Stop() })

Update-Status
[System.Windows.Forms.Application]::Run($form)
