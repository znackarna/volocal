<#
.SYNOPSIS
  Sets the version in all three files that carry it.

.DESCRIPTION
  Three files say what version this is, and nothing keeps them in step:

    src-tauri/tauri.conf.json   what the installer writes and the window reports
    src-tauri/Cargo.toml        the crate
    package.json                the npm package

  Getting one wrong is not a build error. It installs one number and reports
  another, and because the updater compares the *reported* one, an update is
  then offered for ever or never. `release.ps1` refuses to build a tree where
  they disagree; this is how they are moved together.

    scripts\version.ps1 1.0.0
    scripts\version.ps1            just prints what they say now

  It does not commit, tag or push. Read the diff first.
#>
param([string]$Version)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

# Each file, and the pattern that finds the version in it and nothing else.
# Anchored deliberately: `"version":` appears many times in package.json, and
# `version = ` many times in Cargo.toml. Only the first, at the top of its own
# section, is this application's.
$files = @(
  @{ Path = "src-tauri\tauri.conf.json"; Pattern = '("version":\s*")([^"]+)(")' }
  @{ Path = "src-tauri\Cargo.toml";      Pattern = '(?m)^(version = ")([^"]+)(")' }
  @{ Path = "package.json";              Pattern = '("version":\s*")([^"]+)(")' }
)

function Current($file) {
  $text = Get-Content $file.Path -Raw
  $m = [regex]::Match($text, $file.Pattern)
  if (-not $m.Success) { throw "No version found in $($file.Path)." }
  $m.Groups[2].Value
}

if (-not $Version) {
  foreach ($f in $files) { "{0,-28} {1}" -f $f.Path, (Current $f) }
  $now = $files | ForEach-Object { Current $_ } | Sort-Object -Unique
  if ($now.Count -gt 1) { Write-Host "`nThey disagree." -ForegroundColor Red; exit 1 }
  exit 0
}

# Semver, because that is what the updater compares with. A number it cannot
# parse is not rejected loudly - it simply never compares greater, and the
# update is never offered.
if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
  Write-Host "`n'$Version' is not a version. Expected 1.2.3, optionally 1.2.3-rc.1." -ForegroundColor Red
  exit 1
}

foreach ($f in $files) {
  $was = Current $f
  $text = Get-Content $f.Path -Raw
  # Replace only the first occurrence: `$1` and `$3` put the quotes back.
  $text = [regex]::new($f.Pattern).Replace($text, "`${1}$Version`${3}", 1)
  [System.IO.File]::WriteAllText((Resolve-Path $f.Path), $text)
  "{0,-28} {1} -> {2}" -f $f.Path, $was, $Version
}

# Cargo.lock carries the crate's own version too, and a stale one shows up as
# a dirty tree at exactly the wrong moment. Resolving the graph rewrites it.
# The exit code is not the test - `--offline` reports a non-zero code for
# reasons that have nothing to do with the lock - so the lock itself is read
# back instead.
cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 --offline *> $null
$lock = Get-Content src-tauri\Cargo.lock -Raw
if ($lock -match '(?ms)name = "volocal"\r?\nversion = "([^"]+)"' -and $Matches[1] -eq $Version) {
  "{0,-28} {1}" -f "src-tauri\Cargo.lock", "follows"
} else {
  Write-Host "src-tauri\Cargo.lock still says the old version - run any cargo command to refresh it." -ForegroundColor Yellow
}

Write-Host @"

Set. Nothing is committed or tagged.

  git diff
  git commit -am "Volocal $Version"
  scripts\release.ps1
"@ -ForegroundColor Green
