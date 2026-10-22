# HR-Agent 线上全功能回归脚本（第 N 轮）
param([int]$Round = 1)
$ErrorActionPreference = "Stop"
$results = @()
function Out-Row([string]$name, [string]$status, [string]$detail) {
  $script:results += [pscustomobject]@{ 功能 = $name; 状态 = $status; 详情 = $detail }
  Write-Output ("[$status] " + $name + " | " + $detail)
}
$base = "https://hr-gumaoqi.netlify.app"

# ---------- F1 岗位普查 ----------
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
  $r = Invoke-WebRequest -Uri "$base/api/census" -Method POST -Body '{"job":"产品经理","city":"成都"}' -ContentType "application/json; charset=utf-8" -UseBasicParsing -TimeoutSec 60
  $c = $r.Content | ConvertFrom-Json
  Out-Row "F1 岗位普查(产品经理/成都)" "PASS" ("HTTP 200 " + [Math]::Round($sw.Elapsed.TotalSeconds, 1) + "s total=" + $c.total + " items=" + $c.items.Count)
} catch { Out-Row "F1 岗位普查" "FAIL" $_.Exception.Message }

# ---------- F2 简历筛选（2 份 PDF）----------
$boundary = "----hr-round$Round"
$form = @{ job = "Java开发工程师"; city = "成都"; salary = ""; education = ""; other = "" }
$sb = [System.Text.StringBuilder]::new()
foreach ($k in $form.Keys) { [void]$sb.Append("--$boundary`r`nContent-Disposition: form-data; name=`"$k`"`r`n`r`n$($form[$k])`r`n") }
$h = [System.Text.Encoding]::UTF8.GetBytes($sb.ToString())
$files = @("张伟-测试简历.pdf", "李娜-测试简历.pdf")
$stream = [System.IO.MemoryStream]::new(); $stream.Write($h, 0, $h.Length)
foreach ($f in $files) {
  $hd = [System.Text.Encoding]::UTF8.GetBytes("--$boundary`r`nContent-Disposition: form-data; name=`"resumes`"; filename=`"$f`"`r`nContent-Type: application/pdf`r`n`r`n")
  $bt = [System.IO.File]::ReadAllBytes("E:\AndroidProject\AiMate\HR-Agent\test-resumes\$f")
  $stream.Write($hd, 0, $hd.Length); $stream.Write($bt, 0, $bt.Length); $stream.Write([System.Text.Encoding]::UTF8.GetBytes("`r`n"), 0, 2)
}
$mid = [System.Text.Encoding]::UTF8.GetBytes("--$boundary--`r`n"); $stream.Write($mid, 0, $mid.Length)
$sw.Restart()
try {
  $r = Invoke-WebRequest -Uri "$base/api/resume-screening" -Method POST -Body $stream.ToArray() -ContentType "multipart/form-data; boundary=$boundary" -UseBasicParsing -TimeoutSec 120
  $c = $r.Content | ConvertFrom-Json
  $scores = ($c.items | ForEach-Object { $_.name + "=" + $_.score }) -join ", "
  Out-Row "F2 简历筛选(2份)" "PASS" ("HTTP 200 " + [Math]::Round($sw.Elapsed.TotalSeconds, 1) + "s count=" + $c.count + " [" + $scores + "]")
} catch { Out-Row "F2 简历筛选" "FAIL" $_.Exception.Message }

# ---------- F3 面试问题生成 ----------
$sw.Restart()
try {
  $r = Invoke-WebRequest -Uri "$base/api/interview-prep" -Method POST -Body '{"fileName":"张伟-测试简历.pdf"}' -ContentType "application/json; charset=utf-8" -UseBasicParsing -TimeoutSec 60
  $c = $r.Content | ConvertFrom-Json
  Out-Row "F3 问题生成" "PASS" ("HTTP 200 " + [Math]::Round($sw.Elapsed.TotalSeconds, 1) + "s 题目数=" + $c.questions.Count)
} catch { Out-Row "F3 问题生成" "FAIL" $_.Exception.Message }

# ---------- F3 预提问 PDF 导出 ----------
$q1 = $c.questions[0]
$body2 = @{ fileName = "张伟-测试简历.pdf"; specialNeed = ""; questions = @($q1) } | ConvertTo-Json -Depth 4 -Compress
$sw.Restart()
try {
  $r = Invoke-WebRequest -Uri "$base/api/interview-pdf" -Method POST -Body $body2 -ContentType "application/json; charset=utf-8" -UseBasicParsing -TimeoutSec 60
  $ct = $r.Headers['Content-Type']; $len = if ($r.RawContentLength) { $r.RawContentLength } else { 0 }
  $ok = ($ct -match 'pdf') -and ($len -gt 1000)
  Out-Row "F3 PDF导出" $(if ($ok) { "PASS" } else { "FAIL" }) ("HTTP 200 " + [Math]::Round($sw.Elapsed.TotalSeconds, 1) + "s CT=" + $ct + " Len=" + $len)
} catch { Out-Row "F3 PDF导出" "FAIL" $_.Exception.Message }

# ---------- F4 文本评分 ----------
$boundary2 = "----hr-round${Round}b"
$fields = @{ resumeFileName = "张伟-测试简历.pdf"; transcript = "面试官：请介绍你的项目。候选人：我叫张伟，5年Java经验，负责电商订单系统，Spring Cloud微服务，订单状态机用Redis分布式锁，Seata解决分布式事务。面试官：为什么来成都？候选人：成都互联网发展好，个人也希望长期稳定发展。" }
$sb2 = [System.Text.StringBuilder]::new()
foreach ($k in $fields.Keys) { [void]$sb2.Append("--$boundary2`r`nContent-Disposition: form-data; name=`"$k`"`r`n`r`n$($fields[$k])`r`n") }
$h2 = [System.Text.Encoding]::UTF8.GetBytes($sb2.ToString())
$stream2 = [System.IO.MemoryStream]::new(); $stream2.Write($h2, 0, $h2.Length)
$hd2 = [System.Text.Encoding]::UTF8.GetBytes("--$boundary2`r`nContent-Disposition: form-data; name=`"questionsPdf`"; filename=`"q.pdf`"`r`nContent-Type: application/pdf`r`n`r`n")
$bt2 = [System.IO.File]::ReadAllBytes("E:\AndroidProject\AiMate\HR-Agent\test-resumes\回归-预提问.pdf")
$stream2.Write($hd2, 0, $hd2.Length); $stream2.Write($bt2, 0, $bt2.Length); $stream2.Write([System.Text.Encoding]::UTF8.GetBytes("`r`n"), 0, 2)
$mid2 = [System.Text.Encoding]::UTF8.GetBytes("--$boundary2--`r`n"); $stream2.Write($mid2, 0, $mid2.Length)
$sw.Restart()
try {
  $r = Invoke-WebRequest -Uri "$base/api/interview-score" -Method POST -Body $stream2.ToArray() -ContentType "multipart/form-data; boundary=$boundary2" -UseBasicParsing -TimeoutSec 120
  $c4 = $r.Content | ConvertFrom-Json
  Out-Row "F4 文本评分" "PASS" ("HTTP 200 " + [Math]::Round($sw.Elapsed.TotalSeconds, 1) + "s score=" + $c4.score)
} catch { Out-Row "F4 文本评分" "FAIL" $_.Exception.Message }

Write-Output ""
Write-Output ("===== 第 " + $Round + " 轮回归汇总 =====")
$results | Format-Table -AutoSize
$fail = ($results | Where-Object { $_.状态 -eq "FAIL" }).Count
Write-Output ("PASS=" + ($results.Count - $fail) + " FAIL=" + $fail)
