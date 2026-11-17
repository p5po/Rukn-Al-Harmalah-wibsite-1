# Waits (max ~8 s) until the local land-management service answers FOR THIS FOLDER. Exit code 0 = ready, 1 = not available.
param([int]$Port = 47613, [int]$Seconds = 8)
$rootFull = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$want = ('"root":"' + $rootFull.Replace('\', '\\').Replace('"', '\"') + '"').ToLower()
$end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
  try {
    $q = [System.Net.WebRequest]::Create("http://localhost:$Port/__admin/ping"); $q.Timeout = 1000
    $r = $q.GetResponse(); $s = New-Object System.IO.StreamReader($r.GetResponseStream()); $t = $s.ReadToEnd(); $r.Close()
    if ($t.ToLower().Contains($want)) { exit 0 }
  } catch {}
  Start-Sleep -Milliseconds 300
}
exit 1
