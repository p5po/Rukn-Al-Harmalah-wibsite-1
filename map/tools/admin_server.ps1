# AridMap v1.14 — local service for the land management system (works fully offline, listens on this computer only).
#  - Serves the map files to the browser at http://localhost:47613/ (same files as opening index.html directly).
#  - Saves the admin store to data\admin\admin_store.json and data\admin\admin_store.js (atomic write).
#  - Before every overwrite the previous file is copied to data\admin\backups\ (last 300 + first copy of each day kept).
#  - Appends every admin operation to data\admin\audit_log.jsonl (never truncated).
# It never writes plan files (data\plans\*) or data\sales_status.csv. Started hidden by start_kiosk.bat / start_window.bat.
# Compatible with Windows PowerShell 5.1 (built into Windows 10/11). No installation, no administrator rights.
param([int]$Port = 47613)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$admin = Join-Path (Join-Path $root 'data') 'admin'
$backups = Join-Path $admin 'backups'
$storeJson = Join-Path $admin 'admin_store.json'
$storeJs = Join-Path $admin 'admin_store.js'
$revFile = Join-Path $admin 'admin_store.rev'
$auditFile = Join-Path $admin 'audit_log.jsonl'
$logFile = Join-Path $admin 'service_log.txt'
$authJson = Join-Path $admin 'admin_auth.json'
$authJs = Join-Path $admin 'admin_auth.js'
$settingsJson = Join-Path $admin 'settings.json'
$settingsJs = Join-Path $admin 'settings.js'
$utf8 = New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force -Path $backups | Out-Null

function Log([string]$m) { try { [System.IO.File]::AppendAllText($logFile, (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  ' + $m + "`r`n", $utf8) } catch {} }
function Stamp { (Get-Date).ToString('yyyyMMdd-HHmmss-fff') }
function CurrentRev {
  if (Test-Path $revFile) { $t = ([System.IO.File]::ReadAllText($revFile)).Trim(); $n = 0; if ([int]::TryParse($t, [ref]$n)) { return $n } }
  return 0
}

# already running? Only reuse a service that serves THIS folder. A service left running from another copy of the map
# (e.g. an older version) would otherwise keep showing the old files — v1.17 stops it and starts this one.
$rootFull = [System.IO.Path]::GetFullPath($root)
$rootJson = $rootFull.Replace('\', '\\').Replace('"', '\"')
try {
  $probe = [System.Net.WebRequest]::Create("http://localhost:$Port/__admin/ping"); $probe.Timeout = 1500
  $resp = $probe.GetResponse(); $sr = New-Object System.IO.StreamReader($resp.GetResponseStream()); $txt = $sr.ReadToEnd(); $resp.Close()
  if ($txt.ToLower().Contains(('"root":"' + $rootJson + '"').ToLower())) { exit 0 }
} catch {}
try {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction Stop |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*admin_server.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 800
} catch {}

# one-time safety copies before any admin change is applied
$baseCsv = Join-Path (Join-Path $root 'data') 'sales_status.csv'
$baseBak = Join-Path $backups 'baseline_sales_status_before_v1_14.csv'
if ((Test-Path $baseCsv) -and -not (Test-Path $baseBak)) { Copy-Item $baseCsv $baseBak }
if (Test-Path $storeJson) { Copy-Item $storeJson (Join-Path $backups ('startup_' + (Stamp) + '.json')) }
# keep the startup copies bounded (last 60)
Get-ChildItem $backups -Filter 'startup_*.json' | Sort-Object Name -Descending | Select-Object -Skip 60 | Remove-Item -Force -ErrorAction SilentlyContinue

$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.json'='application/json; charset=utf-8';
  '.csv'='text/csv; charset=utf-8'; '.svg'='image/svg+xml'; '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.webp'='image/webp';
  '.woff2'='font/woff2'; '.txt'='text/plain; charset=utf-8'; '.md'='text/plain; charset=utf-8'; '.pbf'='application/x-protobuf'; '.ico'='image/x-icon' }

function Send($ctx, [int]$code, [string]$body, [string]$type) {
  $b = $utf8.GetBytes($body); $r = $ctx.Response
  $r.StatusCode = $code; $r.ContentType = $type; $r.Headers.Add('Cache-Control', 'no-store'); $r.ContentLength64 = $b.Length
  $r.OutputStream.Write($b, 0, $b.Length); $r.OutputStream.Close()
}
function SendJson($ctx, [int]$code, [string]$json) { Send $ctx $code $json 'application/json; charset=utf-8' }
function ReadBody($ctx) { $sr = New-Object System.IO.StreamReader($ctx.Request.InputStream, $utf8); $t = $sr.ReadToEnd(); $sr.Close(); return $t }
function WriteAtomic([string]$path, [string]$text) {
  $tmp = $path + '.tmp'
  [System.IO.File]::WriteAllText($tmp, $text, $utf8)
  if (Test-Path $path) { Remove-Item $path -Force }
  Move-Item $tmp $path -Force
}

# ---------------- v1.25: admin password (salted PBKDF2-SHA256; the password itself is never stored) ----------------
# data\admin\admin_auth.json holds {salt, hash, iter}. Sessions live in memory only: a restart of the service, "lock" or
# leaving admin mode ends them. Every write endpoint (/__admin/save, /__admin/audit, /__admin/settings) needs a valid session.
$script:sessions = @{}
$script:fails = 0
$script:lockUntil = [DateTime]::MinValue
$SESSION_HOURS = 12
function B64([byte[]]$b) { [Convert]::ToBase64String($b) }
function RandBytes([int]$n) { $b = New-Object byte[] $n; $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($b); $rng.Dispose(); return ,$b }
function Pbkdf2([string]$pw, [byte[]]$salt, [int]$iter) {
  $pwb = $utf8.GetBytes($pw)
  try {
    $kdf = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($pwb, $salt, $iter, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
    $k = $kdf.GetBytes(32); $kdf.Dispose(); return ,$k
  } catch {
    # older .NET without SHA-256 PBKDF2: the same algorithm by hand (one 32-byte block = RFC 8018 with HMAC-SHA256)
    $h = New-Object System.Security.Cryptography.HMACSHA256 -ArgumentList (,$pwb)
    $u = $h.ComputeHash([byte[]]($salt + [byte[]](0,0,0,1))); $t = [byte[]]$u.Clone()
    for ($i = 1; $i -lt $iter; $i++) { $u = $h.ComputeHash($u); for ($j = 0; $j -lt 32; $j++) { $t[$j] = $t[$j] -bxor $u[$j] } }
    $h.Dispose(); return ,$t
  }
}
function SameBytes([byte[]]$a, [byte[]]$b) { if ($a.Length -ne $b.Length) { return $false }; $d = 0; for ($i = 0; $i -lt $a.Length; $i++) { $d = $d -bor ($a[$i] -bxor $b[$i]) }; return ($d -eq 0) }
function EnsureAuth {
  # v1.25: no password file yet (first start, or data\admin copied from an older version) → the default hash (0000) from tools\
  if (Test-Path $authJson) { return }
  $def = Join-Path $PSScriptRoot 'admin_auth_default.json'
  if (-not (Test-Path $def)) { return }
  $json = ([System.IO.File]::ReadAllText($def, $utf8)).Trim()
  WriteAtomic $authJson $json
  WriteAtomic $authJs ("/* written by tools/admin_server.ps1 — admin password as a salted PBKDF2-SHA256 hash (the password itself is not stored). Do not edit by hand. */`nwindow.ADMIN_AUTH = " + $json + ";`n")
  Log 'admin password file created with the default password'
}
function ReadAuth {
  if (-not (Test-Path $authJson)) { return $null }
  try { $o = ([System.IO.File]::ReadAllText($authJson, $utf8)) | ConvertFrom-Json; if ($o.algo -eq 'pbkdf2-sha256' -and $o.salt -and $o.hash -and $o.iter -ge 10000) { return $o } } catch {}
  return $null
}
function CheckPassword([string]$pw) {
  $a = ReadAuth; if ($null -eq $a) { return $false }
  $k = Pbkdf2 $pw ([Convert]::FromBase64String($a.salt)) ([int]$a.iter)
  return (SameBytes $k ([Convert]::FromBase64String($a.hash)))
}
function WriteAuth([string]$pw) {
  $salt = RandBytes 16; $iter = 150000; $k = Pbkdf2 $pw $salt $iter
  $json = '{"schema":"aridmap-admin-auth","algo":"pbkdf2-sha256","iter":' + $iter + ',"salt":"' + (B64 $salt) + '","hash":"' + (B64 $k) + '","changedAt":"' + (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') + '","default":false}'
  if (Test-Path $authJson) { Copy-Item $authJson (Join-Path $backups ('admin_auth_' + (Stamp) + '.json')) }
  WriteAtomic $authJson $json
  WriteAtomic $authJs ("/* written by tools/admin_server.ps1 — admin password as a salted PBKDF2-SHA256 hash (the password itself is not stored). Do not edit by hand. */`nwindow.ADMIN_AUTH = " + $json + ";`n")
}
function NewToken { $b = RandBytes 32; return (($b | ForEach-Object { $_.ToString('x2') }) -join '') }
function TokenOk($req) {
  $t = [string]$req.Headers['X-Admin-Token']; if (-not $t) { return $false }
  if (-not $script:sessions.ContainsKey($t)) { return $false }
  if ($script:sessions[$t] -lt (Get-Date)) { $script:sessions.Remove($t); return $false }
  return $true
}
function JsonBody($ctx) { try { return ((ReadBody $ctx) | ConvertFrom-Json) } catch { return $null } }
function Throttled($ctx) {
  if ((Get-Date) -lt $script:lockUntil) { $w = [int][Math]::Ceiling(($script:lockUntil - (Get-Date)).TotalSeconds); SendJson $ctx 429 ('{"ok":false,"error":"wait","wait":' + $w + '}'); return $true }
  return $false
}
function BadPassword($ctx) {
  $script:fails++
  if ($script:fails -ge 5) { $script:lockUntil = (Get-Date).AddSeconds(30); $script:fails = 0; Log 'admin login: 5 wrong passwords, locked for 30 s' }
  SendJson $ctx 401 '{"ok":false,"error":"password"}'
}
function Login($ctx) {
  if (Throttled $ctx) { return }
  $b = JsonBody $ctx; $pw = if ($b) { [string]$b.password } else { '' }
  if (-not (CheckPassword $pw)) { BadPassword $ctx; return }
  $script:fails = 0; $t = NewToken; $script:sessions[$t] = (Get-Date).AddHours($SESSION_HOURS)
  Log 'admin login'
  $a = ReadAuth; $def = if ($a -and $a.default) { 'true' } else { 'false' }
  SendJson $ctx 200 ('{"ok":true,"token":"' + $t + '","hours":' + $SESSION_HOURS + ',"default":' + $def + '}')
}
function Logout($ctx) {
  $t = [string]$ctx.Request.Headers['X-Admin-Token']; if ($t -and $script:sessions.ContainsKey($t)) { $script:sessions.Remove($t); Log 'admin locked' }
  SendJson $ctx 200 '{"ok":true}'
}
function ChangePassword($ctx) {
  if (Throttled $ctx) { return }
  $b = JsonBody $ctx; if (-not $b) { SendJson $ctx 400 '{"ok":false,"error":"invalid"}'; return }
  $new = [string]$b.new
  if ($new.Length -lt 4 -or $new.Length -gt 64) { SendJson $ctx 400 '{"ok":false,"error":"length"}'; return }
  if (-not (CheckPassword ([string]$b.current))) { BadPassword $ctx; return }
  WriteAuth $new
  $keep = [string]$ctx.Request.Headers['X-Admin-Token']; $now = @{}; if ($keep -and $script:sessions.ContainsKey($keep)) { $now[$keep] = $script:sessions[$keep] }
  $script:sessions = $now   # other sessions end when the password changes
  Log 'admin password changed'
  SendJson $ctx 200 '{"ok":true}'
}
function SaveSettings($ctx) {
  $b = JsonBody $ctx; if (-not $b) { SendJson $ctx 400 '{"ok":false,"error":"invalid"}'; return }
  $key = ([string]$b.esri_api_key).Trim()
  if ($key -notmatch '^[A-Za-z0-9_\-\.]{0,400}$') { SendJson $ctx 400 '{"ok":false,"error":"key"}'; return }
  $json = '{"esri_api_key":"' + $key + '","savedAt":"' + (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') + '"}'
  WriteAtomic $settingsJson $json
  WriteAtomic $settingsJs ("/* written by tools/admin_server.ps1 — settings saved from the admin panel. Do not edit by hand. */`nwindow.ADMIN_SETTINGS = " + $json + ";`n")
  Log 'settings saved'
  SendJson $ctx 200 '{"ok":true}'
}

function Save($ctx) {
  $q = $ctx.Request.QueryString
  $rev = 0; $base = -1
  [void][int]::TryParse([string]$q['rev'], [ref]$rev); [void][int]::TryParse([string]$q['base'], [ref]$base)
  $body = ReadBody $ctx
  $head = $body.Substring(0, [Math]::Min(300, $body.Length))
  if (-not $body.StartsWith('{') -or -not $head.Contains('"schema":"aridmap-admin-store"') -or -not $body.TrimEnd().EndsWith('}')) { SendJson $ctx 400 '{"ok":false,"error":"invalid store"}'; return }
  $cur = CurrentRev
  if ($base -ne $cur) { Log "save refused: base $base <> disk $cur"; SendJson $ctx 409 ('{"ok":false,"error":"conflict","rev":' + $cur + '}'); return }
  if ($rev -le $cur) { SendJson $ctx 400 '{"ok":false,"error":"rev must increase"}'; return }
  if (Test-Path $storeJson) {
    Copy-Item $storeJson (Join-Path $backups ('admin_store_' + (Stamp) + '_rev' + $cur + '.json'))
    $day = Join-Path $backups ('daily_' + (Get-Date).ToString('yyyy-MM-dd') + '.json')
    if (-not (Test-Path $day)) { Copy-Item $storeJson $day }
    Get-ChildItem $backups -Filter 'admin_store_*.json' | Sort-Object Name -Descending | Select-Object -Skip 300 | Remove-Item -Force -ErrorAction SilentlyContinue
  }
  WriteAtomic $storeJson $body
  WriteAtomic $storeJs ("/* written by tools/admin_server.ps1 — do not edit by hand; a backup of every version is in data/admin/backups/ */`nwindow.ADMIN_STORE_DISK = " + $body + ";`n")
  WriteAtomic $revFile ([string]$rev)
  Log "saved rev $rev ($($body.Length) chars)"
  SendJson $ctx 200 ('{"ok":true,"rev":' + $rev + '}')
}

function Audit($ctx) {
  $body = ReadBody $ctx
  $lines = $body -split "`n" | Where-Object { $_.Trim().StartsWith('{') }
  if ($lines.Count -gt 0) { [System.IO.File]::AppendAllText($auditFile, (($lines -join "`r`n") + "`r`n"), $utf8) }
  SendJson $ctx 200 '{"ok":true}'
}

function Static($ctx) {
  $p = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
  if ($p -eq '/' -or $p -eq '') { $p = '/index.html' }
  $rel = $p.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
  if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $full -PathType Leaf)) { Send $ctx 404 'not found' 'text/plain; charset=utf-8'; return }
  if ($p -match '(?i)^/data/admin/(admin_auth\.|admin_store\.rev|service_log|audit_log|backups/)') { Send $ctx 403 'forbidden' 'text/plain; charset=utf-8'; return }   # v1.25: password hash and logs are not served
  $ext = [System.IO.Path]::GetExtension($full).ToLower(); $type = $mime[$ext]; if (-not $type) { $type = 'application/octet-stream' }
  $r = $ctx.Response
  # v1.19: map files may be cached by the browser and are re-checked each start (304 = unchanged) — faster start, and the
  # browser keeps its compiled copy of the large data scripts. data/admin/* is never cached.
  if ($p.StartsWith('/data/admin/', [System.StringComparison]::OrdinalIgnoreCase)) { $r.Headers.Add('Cache-Control', 'no-store') }
  else {
    $lm = [System.IO.File]::GetLastWriteTimeUtc($full).ToString('r')
    $r.Headers.Add('Cache-Control', 'no-cache'); $r.Headers.Add('Last-Modified', $lm)
    if ($ctx.Request.Headers['If-Modified-Since'] -eq $lm) { $r.StatusCode = 304; $r.OutputStream.Close(); return }
  }
  $r.StatusCode = 200; $r.ContentType = $type
  $fs = [System.IO.File]::OpenRead($full)
  try { $r.ContentLength64 = $fs.Length; $fs.CopyTo($r.OutputStream) } finally { $fs.Close(); $r.OutputStream.Close() }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$started = $false
for ($i = 0; $i -lt 5 -and -not $started; $i++) { try { $listener.Start(); $started = $true } catch { Start-Sleep -Milliseconds 700; $listener = New-Object System.Net.HttpListener; $listener.Prefixes.Add("http://localhost:$Port/") } }
if (-not $started) { Log "could not start on port ${Port} (another program uses it)"; exit 1 }
EnsureAuth
Log "service started on http://localhost:$Port/ (root $root, disk rev $(CurrentRev))"

while ($listener.IsListening) {
  $ctx = $null
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    # only this computer, only our own host name (blocks DNS-rebinding style requests)
    if (-not $req.IsLocal -or ($req.Url.Host -ne 'localhost' -and $req.Url.Host -ne '127.0.0.1')) { Send $ctx 403 'forbidden' 'text/plain'; continue }
    $path = $req.Url.AbsolutePath
    if ($path -eq '/__admin/ping') { SendJson $ctx 200 ('{"ok":true,"service":"aridmap-admin","auth":true,"rev":' + (CurrentRev) + ',"root":"' + $rootJson + '"}') }
    elseif ($req.HttpMethod -eq 'POST' -and $path.StartsWith('/__admin/')) {
      $origin = $req.Headers['Origin']
      if ($origin -and $origin -ne "http://localhost:$Port" -and $origin -ne "http://127.0.0.1:$Port") { SendJson $ctx 403 '{"ok":false,"error":"origin"}' }
      elseif ($path -eq '/__admin/login') { Login $ctx }
      elseif ($path -eq '/__admin/logout') { Logout $ctx }
      elseif ($path -eq '/__admin/password') { if (TokenOk $req) { ChangePassword $ctx } else { SendJson $ctx 401 '{"ok":false,"error":"login"}' } }
      elseif (-not (TokenOk $req)) { SendJson $ctx 401 '{"ok":false,"error":"login"}' }   # v1.25: no write without an admin session
      elseif ($path -eq '/__admin/save') { Save $ctx }
      elseif ($path -eq '/__admin/audit') { Audit $ctx }
      elseif ($path -eq '/__admin/settings') { SaveSettings $ctx }
      else { Send $ctx 404 'not found' 'text/plain' }
    }
    elseif ($req.HttpMethod -eq 'GET' -or $req.HttpMethod -eq 'HEAD') { Static $ctx }
    else { Send $ctx 405 'method not allowed' 'text/plain' }
  } catch {
    Log "request error: $($_.Exception.Message)"
    try { if ($ctx) { SendJson $ctx 500 '{"ok":false,"error":"server"}' } } catch {}
  }
}
