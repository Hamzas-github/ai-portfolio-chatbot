# Quick check: is the Bedrock quota live and the RAG endpoint answering yet?
# Usage:  powershell -ExecutionPolicy Bypass -File aws\check.ps1
$ErrorActionPreference = "Stop"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# 1. Quota: 0 = still held by AWS, >0 = lifted.
$q = aws service-quotas get-service-quota --service-code bedrock --region us-east-1 --quota-code L-CCA5DF70 --query "Quota.Value" --output text 2>$null
Write-Host "Claude Haiku 4.5 requests/min quota: $q  (0 = still held by AWS)"

# 2. Live endpoint test (uses the shared secret saved at deploy time).
$secretFile = "$env:TEMP\ask_hamza_secret.txt"
if (-not (Test-Path $secretFile)) { Write-Host "No secret file; set it or re-apply Terraform."; exit 1 }
$secret  = Get-Content $secretFile -Raw
$url     = "https://koknejgcgahz2zetvrsw44vg2y0kswbp.lambda-url.us-east-1.on.aws/"
$headers = @{ "x-ask-hamza-key" = $secret; "content-type" = "application/json" }
try {
  $r = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body (@{question="What is EyeSpeak?"} | ConvertTo-Json) -TimeoutSec 90
  Write-Host "`nWORKS:" -ForegroundColor Green
  Write-Host "A: $($r.answer)"
  Write-Host "cites: $($r.citations -join ', ')"
} catch {
  Write-Host "`nStill blocked (expected while quota = 0): $($_.Exception.Message)" -ForegroundColor Yellow
}
