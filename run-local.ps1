# Start DeepSeek Harness Web UI from this checkout on Windows.
#
#   .\run-local.ps1                  # install if needed, build if needed, open http://127.0.0.1:3080
#   .\run-local.ps1 -SkipBuild       # fastest repeat start: node launches dsh web directly, no pnpm dep check
#   .\run-local.ps1 -NoOpen          # do not open a browser
#   .\run-local.ps1 -Port 3081
#   .\run-local.ps1 -Rebuild         # force pnpm run build, then serve
#   .\run-local.ps1 -SkipBuild       # serve existing artifacts (fails if the build record is missing)
#   .\run-local.ps1 -Dev             # build, serve, and rebuild client bundles on source edits
#   .\run-local.ps1 -Dev -SkipBuild  # watch mode against an existing artifact tree
#   .\run-local.ps1 -Install         # run pnpm install even when node_modules exists
#
# If execution policy blocks the file:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\run-local.ps1
#
# Model calls read DEEPSEEK_API_KEY (and optional DEEPSEEK_BASE_URL) from the
# environment or a gitignored .env in the repo root. The UI still starts without them.

[CmdletBinding()]
param(
  [switch]$Dev,
  [switch]$Install,
  [switch]$Rebuild,
  [switch]$SkipBuild,
  [switch]$NoOpen,
  [int]$Port = 3080
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-NodeVersion {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'node was not found on PATH. Install Node.js 22.19+ or 24+.'
  }
  $raw = (& node -v).Trim()
  if ($raw -notmatch '^v(\d+)\.(\d+)\.(\d+)') {
    throw "Cannot parse node version: $raw"
  }
  $major = [int]$Matches[1]
  $minor = [int]$Matches[2]
  $supported = (($major -eq 22) -and ($minor -ge 19)) -or ($major -ge 24)
  if (-not $supported) {
    throw "Node.js 22.19+ or 24+ is required. Current version is $raw."
  }
  Write-Host "node $raw"
}

function Initialize-Pnpm {
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    $script:UseCorepack = $false
  } elseif (Get-Command corepack -ErrorAction SilentlyContinue) {
    $script:UseCorepack = $true
    Write-Host 'pnpm is not on PATH; using corepack pnpm.'
  } else {
    throw 'pnpm was not found. Install Node.js 22.19+ and run: corepack enable; corepack prepare pnpm@11.28.5 --activate'
  }

  $version = if ($script:UseCorepack) { (& corepack pnpm --version).Trim() } else { (& pnpm --version).Trim() }
  Write-Host "pnpm $version"
  if ($version -ne '11.28.5') {
    Write-Host "This repo pins pnpm 11.28.5. Activate it with: corepack enable; corepack prepare pnpm@11.28.5 --activate" -ForegroundColor Yellow
  }
}

function Invoke-Pnpm {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$PnpmArgs
  )
  # pnpm 11 runs a full workspace install check before every script. Skip it;
  # this script already installs when node_modules is missing.
  $PnpmArgs = @('--config.verifyDepsBeforeRun=false') + $PnpmArgs
  if ($script:UseCorepack) {
    & corepack pnpm @PnpmArgs
  } else {
    & pnpm @PnpmArgs
  }
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm failed with exit code ${LASTEXITCODE}: pnpm $($PnpmArgs -join ' ')"
  }
}

function Invoke-Web {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$WebArgs
  )
  & node --import tsx/esm (Join-Path $Root 'apps\cli\src\bin.ts') web @WebArgs
  if ($LASTEXITCODE -ne 0) {
    throw "dsh web failed with exit code ${LASTEXITCODE}"
  }
}

if ($SkipBuild -and $Rebuild) {
  throw 'Pass only one of -SkipBuild or -Rebuild.'
}
if ($Port -lt 1 -or $Port -gt 65535) {
  throw "Invalid -Port $Port."
}

Assert-NodeVersion
Initialize-Pnpm

$nodeModules = Join-Path $Root 'node_modules'
if ($Install -or -not (Test-Path $nodeModules)) {
  Write-Step 'pnpm install'
  Invoke-Pnpm -PnpmArgs @('install')
}

$buildRecord = Join-Path $Root '.dsh-build\client-build-environment.json'
$hasBuild = Test-Path $buildRecord
$webArgs = @('--port', "$Port")
if ($NoOpen) {
  $webArgs += '--no-open'
}

if (-not (Test-Path (Join-Path $Root '.env')) -and [string]::IsNullOrEmpty($env:DEEPSEEK_API_KEY)) {
  Write-Host ""
  Write-Host 'No DEEPSEEK_API_KEY in the environment and no repo-root .env.' -ForegroundColor Yellow
  Write-Host 'The UI can still start. To call the model, create .env with:'
  Write-Host '  DEEPSEEK_API_KEY=sk-...'
  Write-Host '  DEEPSEEK_BASE_URL=https://api.deepseek.com'
}

if ($Dev) {
  Write-Step 'dev:web (build once, then rebuild client bundles on edit)'
  $devArgs = @('run', 'dev:web', '--')
  if ($SkipBuild) {
    if (-not $hasBuild) {
      throw 'No complete build record at .dsh-build/client-build-environment.json. Run .\run-local.ps1 once without -SkipBuild.'
    }
    $devArgs += '--skip-build'
  }
  $devArgs += $webArgs
  Invoke-Pnpm -PnpmArgs $devArgs
  exit $LASTEXITCODE
}

$shouldBuild = $Rebuild -or ((-not $SkipBuild) -and (-not $hasBuild))
if ($SkipBuild -and -not $hasBuild) {
  throw 'No complete build record at .dsh-build/client-build-environment.json. Run .\run-local.ps1 once without -SkipBuild.'
}
if ($shouldBuild) {
  Write-Step 'pnpm run build (first build can take several minutes)'
  Invoke-Pnpm -PnpmArgs @('run', 'build')
} else {
  Write-Host 'Using the existing build. Pass -Rebuild to build again, or -Dev to rebuild on edit.'
}

Write-Step "Web UI at http://127.0.0.1:$Port"
Invoke-Web -WebArgs $webArgs
exit $LASTEXITCODE
