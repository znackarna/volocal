<#
.SYNOPSIS
  Builds, signs and publishes a Volocal release.

.DESCRIPTION
  Two passes, because one of the signatures needs a human and a hardware token.

    scripts\release.ps1                 checks, builds, stops and tells you to sign
    scripts\release.ps1 -Publish        signs for the updater, writes latest.json,
                                        opens a draft release on GitHub

  Why the pause. There are two signatures on a release and they are unrelated:

    * Authenticode, which is what stops Windows SmartScreen warning about the
      installer. Its certificate lives on a hardware token that cannot be handed
      to a script, let alone to a CI runner.
    * The updater's own minisign signature, which is what an installed copy
      checks before it will accept a download. That one is a file on this
      machine.

  The order matters and is the reason this is not one command: the updater
  signature is over the *bytes of the installer*, so it has to be made after
  Authenticode has touched them. Sign in the other order and every existing
  installation refuses the update, having correctly noticed the file changed.

.PARAMETER Publish
  Second pass: expects a signed installer and finishes the release.

.PARAMETER Installer
  The .exe to publish. Defaults to what the build leaves in
  src-tauri\target\release\bundle\nsis\. Point it at the artifact from CI if
  that is the build being released.

.PARAMETER Notes
  What changed, in the language the readers speak. Shown by the updater before
  anyone agrees to download.
#>
param(
  [switch]$Publish,
  [string]$Installer,
  [string]$Notes = "",
  [switch]$SkipChecks
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Step($text) { Write-Host "`n=== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "`n$text" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- the version

# Three files carry it and nothing keeps them in step. A release built from a
# tree where they disagree installs one number and reports another, and the
# updater compares the reported one - so an update can be offered for ever, or
# never.
$conf = Get-Content src-tauri\tauri.conf.json -Raw
$version = ([regex]::Match($conf, '"version": "([^"]+)"')).Groups[1].Value
$cargo = ([regex]::Match((Get-Content src-tauri\Cargo.toml -Raw), '(?m)^version = "([^"]+)"')).Groups[1].Value
$npm = ([regex]::Match((Get-Content package.json -Raw), '"version": "([^"]+)"')).Groups[1].Value
if ($version -ne $cargo -or $version -ne $npm) {
  Fail "The version differs between files: tauri.conf.json $version, Cargo.toml $cargo, package.json $npm."
}
$tag = "v$version"
Write-Host "Volocal $version" -ForegroundColor Green

$key = "$env:USERPROFILE\.slobot\updater.key"
if (-not (Test-Path $key)) {
  Fail @"
The updater signing key is not at $key.

Without it nothing can be released that an installed copy will accept. If it is
lost, a new pair has to be generated and the public half put into
tauri.conf.json - which every existing installation will refuse, because it
trusts the old one. Restore it from wherever it is kept.

  npm run tauri signer generate -- -w "$key"
"@
}

$bundle = "src-tauri\target\release\bundle\nsis"

# ---------------------------------------------------------------- first pass

if (-not $Publish) {
  if (-not $SkipChecks) {
    Step "Checks"
    # The same commands CONTRIBUTING lists, plus the release-only dictionary
    # rule: a translation whose Czech source was never fingerprinted is a
    # warning during the week and a stop here.
    npm run build; if ($LASTEXITCODE) { Fail "npm run build failed." }
    npm run test;  if ($LASTEXITCODE) { Fail "npm run test failed." }
    node scripts/i18n.mjs check --strict; if ($LASTEXITCODE) { Fail "The dictionary is not ready for a release." }
    cargo fmt --manifest-path src-tauri/Cargo.toml --all --check; if ($LASTEXITCODE) { Fail "cargo fmt found formatting to do." }
    cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings; if ($LASTEXITCODE) { Fail "clippy has findings." }
    cargo test --manifest-path src-tauri/Cargo.toml; if ($LASTEXITCODE) { Fail "cargo test failed." }
  }

  Step "Building the installer (twenty minutes and change)"
  # `createUpdaterArtifacts` makes the bundler produce a .sig beside the
  # installer, and it refuses to run without a key to make it with. That
  # signature is thrown away below - it is over the unsigned bytes - but the
  # build needs it to finish.
  $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $key
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
  npm run tauri build
  if ($LASTEXITCODE) { Fail "The build failed." }

  $exe = Get-ChildItem "$bundle\*.exe" | Sort-Object LastWriteTime | Select-Object -Last 1
  Write-Host @"

Built: $($exe.FullName)

Now sign it with the certificate on the token, and then run:

  scripts\release.ps1 -Publish -Notes "what changed"

Signing after this point is deliberate: the updater signature is made in the
second pass, over the file as it will be downloaded.
"@ -ForegroundColor Green
  exit 0
}

# ---------------------------------------------------------------- second pass

if (-not $Installer) {
  $found = Get-ChildItem "$bundle\*.exe" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
  if (-not $found) { Fail "No installer in $bundle. Run without -Publish first, or pass -Installer." }
  $Installer = $found.FullName
}
if (-not (Test-Path $Installer)) { Fail "No such file: $Installer" }
$exe = Get-Item $Installer

Step "Authenticode"
# Checked rather than assumed. An unsigned installer is a release everybody
# has to click past a SmartScreen warning to install, and the whole reason
# this script has two passes is to make room for the signature.
$sig = Get-AuthenticodeSignature $exe.FullName
if ($sig.Status -ne "Valid") {
  Fail @"
$($exe.Name) is not signed ($($sig.Status)).

Sign it with the token and run this again. Releasing without a signature means
SmartScreen warns every reader who downloads it, so if that is really the
intention, take this guard out of the script deliberately rather than working
around it - that way it is a decision somebody made and can be found again.
"@
}
Write-Host "signed by $($sig.SignerCertificate.Subject)" -ForegroundColor Green

Step "Updater signature"
# Over the bytes as they now are, Authenticode and all. -p "" because the key
# has no password and the signer otherwise sits waiting for one with no prompt
# a script can answer.
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npx tauri signer sign -f $key -p "" $exe.FullName | Out-Null
if ($LASTEXITCODE) { Fail "Signing for the updater failed." }
$signature = (Get-Content "$($exe.FullName).sig" -Raw).Trim()
if (-not $signature) { Fail "The signature file is empty." }

Step "latest.json"
# What the application fetches. `windows-x86_64` is the only target Volocal
# ships; the url is the download path the tag will have once the release is
# published, which is why the draft has to be published before an update can
# be found.
$latest = [ordered]@{
  version   = $version
  notes     = $Notes
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = $signature
      url       = "https://github.com/znackarna/volocal/releases/download/$tag/$($exe.Name)"
    }
  }
}
$latestPath = Join-Path $exe.DirectoryName "latest.json"
$latest | ConvertTo-Json -Depth 5 | Set-Content $latestPath -Encoding utf8
Write-Host (Get-Content $latestPath -Raw)

Step "Draft release $tag"
# A draft, always. Its assets are not reachable at releases/latest/download,
# so nothing is offered to anybody until somebody has looked at the page and
# pressed publish. That is the last chance to notice a wrong number.
gh release view $tag *> $null
if ($LASTEXITCODE -eq 0) { Fail "$tag already exists on GitHub. Bump the version in all three files." }
gh release create $tag --draft --title "Volocal $version" --notes $Notes `
  $exe.FullName "$($exe.FullName).sig" $latestPath
if ($LASTEXITCODE) { Fail "Creating the release failed." }

Write-Host @"

Draft release $tag created with three assets.

Check the page, then publish it. Until you do, `releases/latest/download/latest.json`
still points at the release before this one and nobody is offered anything.
"@ -ForegroundColor Green
