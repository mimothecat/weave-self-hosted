param(
  [Parameter(Mandatory = $true)]
  [string]$Server,

  [string]$Branch = "main",

  [string]$AppDirectory = "~/apps/weave"
)

$ErrorActionPreference = "Stop"
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path.Replace("\", "/")

Push-Location $RepositoryRoot
try {
  git -c "safe.directory=$RepositoryRoot" push origin $Branch
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub push failed."
  }

  git -c "safe.directory=$RepositoryRoot" push deploy $Branch
  if ($LASTEXITCODE -ne 0) {
    throw "Arch deployment push failed."
  }

  ssh -tt $Server "cd $AppDirectory && bash deploy/update.sh"
  if ($LASTEXITCODE -ne 0) {
    throw "Remote update failed."
  }
} finally {
  Pop-Location
}

Write-Host "Weave published successfully."
