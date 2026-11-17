# Converts data\sales_status.csv into data\sales_status.js (so the map works without a server) and checks every row
# against the parcel index of the displayed plans. Rows that do not identify exactly one shape are reported and will be
# ignored by the map. Report: data\sales_status_report.txt. Run automatically by the start scripts.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$csvPath = Join-Path $root 'data\sales_status.csv'
$jsPath  = Join-Path $root 'data\sales_status.js'
$repPath = Join-Path $root 'data\sales_status_report.txt'
if (-not (Test-Path $csvPath)) { Write-Host "sales_status.csv not found - skipping"; exit 0 }
# v1.19: nothing to do when sales_status.js is already newer than the CSV (the full check of 54,000 rows took many seconds at every start)
if ((Test-Path $jsPath) -and ([System.IO.File]::GetLastWriteTimeUtc($jsPath) -ge [System.IO.File]::GetLastWriteTimeUtc($csvPath))) { Write-Host "sales_status.js is up to date"; exit 0 }
$text = [System.IO.File]::ReadAllText($csvPath, [System.Text.Encoding]::UTF8)
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($jsPath, "window.SALES_CSV = " + ($text | ConvertTo-Json -Compress) + ";`n", $utf8)

# --- validation against docs\parcels_index_<plan>.csv ---
$index = @{}
Get-ChildItem (Join-Path $root 'docs') -Filter 'parcels_index_*.csv' | ForEach-Object {
  Import-Csv -Path $_.FullName -Encoding UTF8 | ForEach-Object { $index[$_.parcel_uid] = $_.parcel_no }
}
$allowed = @('متاحة','متاح','محجوزة','محجوز','مباعة','مباع','غير محددة','غير محدد','available','reserved','sold','unknown','غير مخصصة للبيع','غير مخصص للبيع','خدمات','service','not_for_sale','')
$rows = Import-Csv -Path $csvPath -Encoding UTF8
$problems = New-Object System.Collections.Generic.List[string]
$seen = @{}
$line = 1
foreach ($r in $rows) {
  $line++
  if (-not ($r.PSObject.Properties.Name -contains 'parcel_uid')) { $problems.Add("الملف بالصيغة القديمة (بدون parcel_uid). الرجاء استخدام القالب الجديد."); break }
  $uid = ($r.parcel_uid).Trim(); $st = ($r.status).Trim()
  if (-not $index.ContainsKey($uid)) { $problems.Add("سطر ${line}: معرّف غير موجود: $uid"); continue }
  if ($r.parcel_no -and ($r.parcel_no.Trim() -ne $index[$uid])) { $problems.Add("سطر ${line}: رقم القطعة لا يطابق المعرّف $uid"); continue }
  if (-not ($allowed -contains $st.ToLower())) { $problems.Add("سطر ${line}: قيمة حالة غير معروفة: $st"); continue }
  if ($seen.ContainsKey($uid)) { $problems.Add("سطر ${line}: المعرّف مكرر: $uid (السطر الأول $($seen[$uid])) — إن اختلفت القيم تُهمل الخريطة كل صفوف هذا المعرّف"); continue }
  $seen[$uid] = $line
}
$summary = "صفوف: $($rows.Count) — مشاكل: $($problems.Count)"
[System.IO.File]::WriteAllText($repPath, ($summary + "`r`n" + ($problems -join "`r`n")), $utf8)
Write-Host "Sales status updated. Rows: $($rows.Count). Problems: $($problems.Count) (see data\sales_status_report.txt)"
