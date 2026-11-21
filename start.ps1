$ErrorActionPreference = "Stop"
$studyRoot = $PSScriptRoot
$studyPort = 8765
$url = "http://127.0.0.1:$studyPort/"

Write-Host "词刻 CET-6 正在启动..."
Write-Host "地址: $url"
Write-Host "关闭此窗口或按 Ctrl+C 可停止服务。"

$server = Start-Process `
  -FilePath "python" `
  -ArgumentList "-m", "http.server", "$studyPort", "--bind", "127.0.0.1" `
  -WorkingDirectory $studyRoot `
  -WindowStyle Hidden `
  -PassThru

Start-Sleep -Milliseconds 800
Start-Process $url

try {
  Write-Host "服务进程 PID: $($server.Id)"
  Write-Host "按 Ctrl+C 停止。"
  Wait-Process -Id $server.Id
}
finally {
  if (-not $server.HasExited) {
    Stop-Process -Id $server.Id
  }
}
