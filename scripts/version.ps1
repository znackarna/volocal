<#
.SYNOPSIS
  Sets the version everywhere it is written down.

.DESCRIPTION
  Three files decide what version this is, and nothing keeps them in step:

    src-tauri/tauri.conf.json   what the installer writes and the window reports
    src-tauri/Cargo.toml        the crate
    package.json                the npm package

  Getting one wrong is not a build error. It installs one number and reports
  another, and because the updater compares the *reported* one, an update is
  then offered for ever or never. `release.ps1` refuses to build a tree where
  they disagree; this is how they are moved together.

  Four more files only *say* the version — to a reader, not to a program:

    README.md                          the status line
    README.cs.md                       the installer's filename, twice, and the status line
    NOTICE                             which release these components belong to
    .github/ISSUE_TEMPLATE/…yml        the example a reporter is shown

  They are moved with the rest because they were not. On 12 August 2026 all
  four still said 0.9.0 with ten versions released, and the repository told a
  visitor the application was unpublished. A wrong number here breaks nothing
  and is read by everybody, which is exactly why nobody noticed. A pattern that
  stops matching is reported and skipped rather than throwing: a reworded
  sentence must not be able to block a release.

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

# The documents. `Every` where the version appears more than once in the file.
$documents = @(
  @{ Path = "README.md";     Pattern = '(\*\*Status: released, )([\d.]+)(\.\*\*)' }
  @{ Path = "README.cs.md";  Pattern = '(Volocal_)([\d.]+)(_x64-setup\.exe)'; Every = $true }
  @{ Path = "README.cs.md";  Pattern = '(\*\*Stav: vydáno, )([\d.]+)(\.\*\*)' }
  @{ Path = "NOTICE";        Pattern = '(?m)^(Volocal )([\d.]+)( — )' }
  @{ Path = ".github\ISSUE_TEMPLATE\bug_report.yml"; Pattern = '(placeholder: ")([\d.]+)(")' }
)

function Current($file) {
  $text = Get-Content $file.Path -Raw
  $m = [regex]::Match($text, $file.Pattern)
  if (-not $m.Success) { throw "No version found in $($file.Path)." }
  $m.Groups[2].Value
}

# Same, but a document that no longer matches is a warning, not the end.
function CurrentInDocument($file) {
  if (-not (Test-Path $file.Path)) { return $null }
  $m = [regex]::Match((Get-Content $file.Path -Raw), $file.Pattern)
  if ($m.Success) { $m.Groups[2].Value } else { $null }
}

if (-not $Version) {
  foreach ($f in $files) { "{0,-40} {1}" -f $f.Path, (Current $f) }
  foreach ($d in $documents) {
    "{0,-40} {1}" -f $d.Path, ((CurrentInDocument $d) ?? "no version found")
  }
  # @() deliberately: with three files agreeing, `Sort-Object -Unique` returns
  # one string, and indexing a string gives a character.
  $now = @($files | ForEach-Object { Current $_ } | Sort-Object -Unique)
  if ($now.Count -gt 1) { Write-Host "`nThey disagree." -ForegroundColor Red; exit 1 }
  $behind = $documents | Where-Object { $v = CurrentInDocument $_; $v -and $v -ne $now[0] }
  if ($behind) {
    Write-Host "`nThe documents are behind. Run this with the version to move them." -ForegroundColor Yellow
  }
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
  "{0,-40} {1} -> {2}" -f $f.Path, $was, $Version
}

foreach ($d in $documents) {
  $was = CurrentInDocument $d
  if (-not $was) {
    Write-Host ("{0,-40} no version found - check it by hand" -f $d.Path) -ForegroundColor Yellow
    continue
  }
  $text = Get-Content $d.Path -Raw
  $count = if ($d.Every) { [int]::MaxValue } else { 1 }
  $text = [regex]::new($d.Pattern).Replace($text, "`${1}$Version`${3}", $count)
  [System.IO.File]::WriteAllText((Resolve-Path $d.Path), $text)
  "{0,-40} {1} -> {2}" -f $d.Path, $was, $Version
}

# Cargo.lock carries the crate's own version too, and a stale one shows up as
# a dirty tree at exactly the wrong moment. Resolving the graph rewrites it.
# The exit code is not the test - `--offline` reports a non-zero code for
# reasons that have nothing to do with the lock - so the lock itself is read
# back instead.
cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 --offline *> $null
$lock = Get-Content src-tauri\Cargo.lock -Raw
if ($lock -match '(?ms)name = "volocal"\r?\nversion = "([^"]+)"' -and $Matches[1] -eq $Version) {
  "{0,-40} {1}" -f "src-tauri\Cargo.lock", "follows"
} else {
  Write-Host "src-tauri\Cargo.lock still says the old version - run any cargo command to refresh it." -ForegroundColor Yellow
}

Write-Host @"

Set. Nothing is committed or tagged.

  git diff
  git commit -am "Volocal $Version"
  scripts\release.ps1
"@ -ForegroundColor Green
