# Copy the MUN Live Command Center onto a pendrive, ready to run on any Windows PC.
#
#   Right-click this file  ->  Run with PowerShell
#   or:  powershell -ExecutionPolicy Bypass -File .\Prepare-USB.ps1 -Drive E:
#
# It copies the app AND your live data (database, notes, search index, the 23 MB
# embedding model) so the pendrive is self-contained and works with no internet.

param(
  [string]$Drive,
  [string]$FolderName = 'MUN'
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Info($m) { Write-Host "  $m" }
function Ok($m)   { Write-Host "  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }

Write-Host ""
Write-Host "  MUN Live Command Center - pendrive setup" -ForegroundColor Cyan
Write-Host "  ------------------------------------------------------------"

# --- Pick the destination drive ---------------------------------------------
if (-not $Drive) {
  $removable = Get-Volume |
    Where-Object { $_.DriveType -eq 'Removable' -and $_.DriveLetter } |
    Select-Object DriveLetter, FileSystemLabel, SizeRemaining, FileSystem

  if (-not $removable) {
    Warn "No removable drive found. Plug the pendrive in, then run this again."
    Warn "Or pass one explicitly:  .\Prepare-USB.ps1 -Drive E:"
    return
  }

  Write-Host ""
  Info "Removable drives found:"
  foreach ($v in $removable) {
    $free = [math]::Round($v.SizeRemaining / 1GB, 1)
    Info ("   {0}:  {1}  ({2} GB free, {3})" -f $v.DriveLetter, $v.FileSystemLabel, $free, $v.FileSystem)
  }
  Write-Host ""
  $letter = Read-Host "  Which drive letter should I copy to? (e.g. E)"
  $Drive = "$($letter.Trim(':',' ')):"
}

if (-not (Test-Path $Drive)) { Warn "Drive $Drive was not found."; return }

# --- Space check -------------------------------------------------------------
$vol = Get-Volume -DriveLetter $Drive.Trim(':') -ErrorAction SilentlyContinue
$srcMb = [math]::Round((Get-ChildItem $here -Recurse -File -ErrorAction SilentlyContinue |
  Measure-Object Length -Sum).Sum / 1MB, 0)

if ($vol) {
  $freeMb = [math]::Round($vol.SizeRemaining / 1MB, 0)
  Info "Copying about $srcMb MB. Free on ${Drive} : $freeMb MB."
  if ($freeMb -lt ($srcMb + 300)) { Warn "That may not fit. Free some space first."; return }
  if ($vol.FileSystem -eq 'FAT32') {
    Warn "This drive is FAT32, which cannot hold files over 4 GB. It will work here,"
    Warn "but exFAT or NTFS is a safer choice for a database."
  }
}

$dest = Join-Path $Drive $FolderName
Write-Host ""
Info "Destination: $dest"

# --- Copy the application ----------------------------------------------------
# Skipped: build caches and the dev server's temp files. node_modules IS copied -
# every dependency here is either pure JS or a win32-x64 binary, so it runs as-is
# on another 64-bit Windows PC without npm install.
Write-Host ""
Info "Copying the application (this is the slow part - several minutes on USB 2)..."

# `node` (portable Node.js) IS copied - it is what makes the drive run on a PC
# with nothing installed. Only build caches and live data are skipped.
$exclude = @('.git', '.vite', 'MUN-Data')
$robocopyArgs = @(
  $here, $dest, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'
) + @('/XD') + ($exclude | ForEach-Object { Join-Path $here $_ })

$null = robocopy @robocopyArgs
if ($LASTEXITCODE -ge 8) { Warn "Copy reported errors (robocopy code $LASTEXITCODE)."; return }
Ok "Application copied."

# --- Copy your live data so your work travels with you -----------------------
$liveData = Join-Path $env:LOCALAPPDATA 'mun-command-center'
$destData = Join-Path $dest 'MUN-Data'

if (Test-Path $liveData) {
  Info "Copying your database, notes and the embedding model..."
  # The database must not be copied while the server is mid-write.
  $running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*server*index.js*' }
  if ($running) {
    Warn "The MUN server is still running. Close its window first, then run this again -"
    Warn "copying a database mid-write can corrupt it."
    return
  }
  $null = robocopy $liveData $destData '/E' '/NFL' '/NDL' '/NJH' '/NJS' '/NP' '/R:1' '/W:1'
  Ok "Your data copied - notes, POIs, speeches, resolution and search index."
} else {
  Warn "No existing data found; the pendrive will start with the shipped content."
}

# --- Report on Node ----------------------------------------------------------
Write-Host ""
$portableNode = Join-Path $dest 'node\node.exe'
if (Test-Path $portableNode) {
  $ver = & $portableNode --version 2>$null
  Ok "Portable Node.js $ver is on the drive - this runs on a PC with nothing installed."
} else {
  Warn "No portable Node.js on the drive yet."
  Warn "The app will only start on a PC that already has Node.js installed."
  Write-Host ""
  Info "To make it run ANYWHERE, with no install and no admin rights:"
  Info "  1. Go to  https://nodejs.org/en/download"
  Info "  2. Choose  Windows Binary (.zip), 64-bit  - NOT the .msi installer"
  Info "  3. Unzip, and copy the CONTENTS of node-v24.x.x-win-x64 into:"
  Info "       $dest\node\"
  Info "     so that this file exists:  $dest\node\node.exe"
}

Write-Host ""
Ok "Done. On the other PC: open $Drive\$FolderName and double-click MUN.cmd"
Write-Host ""
Info "Remember to eject the drive safely - it holds a live database."
Write-Host ""
