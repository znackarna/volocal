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
  [switch]$SkipChecks,
  # Release without an Authenticode signature. Everybody who downloads it then
  # meets SmartScreen - "Windows protected your PC", More info, Run anyway -
  # and has to decide to trust a program Windows says it does not know.
  #
  # It has to be asked for, because the guard exists to stop it happening by
  # accident, and it is worth knowing what it does not cost: a certificate on
  # its own does not remove that warning either. OV and the cheap cloud
  # services start with no reputation and earn it by being downloaded, which is
  # the very thing that has not happened yet. Only EV is trusted on sight.
  [switch]$Unsigned
)

$ErrorActionPreference = "Stop"
# PowerShell 7.4 turns a non-zero exit code from a native command into a
# terminating error, which sounds helpful and is not: it fires before the
# `if ($LASTEXITCODE)` lines below, so every message this script writes about
# what actually went wrong is skipped in favour of a stack trace. It also blew
# up the one place a failure is the expected answer - asking whether the tag
# exists yet. The exit codes are checked here explicitly; that is the design.
$PSNativeCommandUseErrorActionPreference = $false
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Step($text) { Write-Host "`n=== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "`n$text" -ForegroundColor Red; exit 1 }

# The key's password, asked for once and passed on explicitly everywhere.
#
# Explicitly, because the signer waits for one even when the key has none, with
# no prompt a script can answer - it simply hangs. An empty answer is a real
# answer and means the key is not protected.
#
# Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD before running to skip the question,
# which is what a scripted release would do. Typing it in is better on a
# machine where the shell history is kept.
function Get-KeyPassword {
  if ($null -ne $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    return $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  }
  $secure = Read-Host "Password for the updater signing key (empty if it has none)" -AsSecureString
  [System.Net.NetworkCredential]::new("", $secure).Password
}

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
  # Built with the updater artifact turned off, which is also how CI builds it.
  #
  # The bundler would otherwise make a .sig here and demand the signing key to
  # make it with - and that signature is thrown away anyway, because it is over
  # bytes Authenticode has not touched yet. So the long step needs no key and
  # no password: the only signature that survives is made in the second pass,
  # over the file as it will be downloaded.
  npm run tauri build -- --config src-tauri/tauri.ci.conf.json
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
# Checked rather than assumed. The whole reason this script has two passes is
# to make room for this signature.
$sig = Get-AuthenticodeSignature $exe.FullName
if ($sig.Status -eq "Valid") {
  Write-Host "signed by $($sig.SignerCertificate.Subject)" -ForegroundColor Green
} elseif ($Unsigned) {
  Write-Host @"
Not signed ($($sig.Status)), and -Unsigned was passed.

Everybody who downloads this will meet SmartScreen: "Windows protected your
PC", More info, Run anyway. Say so wherever the download is offered - a warning
nobody was warned about is what makes people close the page.
"@ -ForegroundColor Yellow
} else {
  Fail @"
$($exe.Name) is not signed ($($sig.Status)).

Sign it and run this again, or pass -Unsigned to release it as it is and take
the SmartScreen warning. Worth knowing before buying anything: a certificate
does not remove that warning by itself. OV certificates and the cheap cloud
signing services start with no reputation and earn it by being downloaded.
Only EV is trusted on sight.
"@
}

Step "Updater signature"
# Over the bytes as they now are, Authenticode and all.
#
# The password goes through the environment and never onto a command line.
# `-p` worked and printed it: npm echoes the command it runs, so the password
# ended up in the console, in the scrollback and in anything reading either.
# And the binary is called directly rather than through `npm run`, because that
# is what does the echoing.
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Get-KeyPassword
& "node_modules\.bin\tauri.cmd" signer sign -f $key $exe.FullName | Out-Null
if ($LASTEXITCODE) { Fail "Signing for the updater failed - wrong password for the key?" }
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
# Written without a byte order mark, and that is the whole point of not using
# Set-Content here. It wrote one - EF BB BF, three bytes nobody sees in an
# editor - and the updater's JSON parser stops on them. The file downloads with
# a perfectly good 200 and the application reports that it cannot find out
# whether there is a new version, which sounds like the network and is not.
[System.IO.File]::WriteAllText(
  $latestPath,
  ($latest | ConvertTo-Json -Depth 5),
  (New-Object System.Text.UTF8Encoding $false)
)
$firstByte = [System.IO.File]::ReadAllBytes($latestPath)[0]
if ($firstByte -ne 0x7B) { Fail "latest.json does not start with '{' - something wrote a mark in front of it." }
Write-Host (Get-Content $latestPath -Raw)

Step "Draft release $tag"
# A draft, always. Its assets are not reachable at releases/latest/download,
# so nothing is offered to anybody until somebody has looked at the page and
# pressed publish. That is the last chance to notice a wrong number.
# `gh release list` rather than `gh release view`: view fails when the release
# is absent, which is the ordinary case here, and a command whose failure is
# the expected answer is a bad thing to build a guard on.
$existing = gh release list --json tagName -q '.[].tagName' 2>$null
if ($LASTEXITCODE) { Fail "Could not ask GitHub what has been released. Is gh signed in?" }
if ($existing -contains $tag) {
  Fail "$tag already exists on GitHub. Move the version on with scripts\version.ps1."
}
gh release create $tag --draft --title "Volocal $version" --notes $Notes `
  $exe.FullName "$($exe.FullName).sig" $latestPath
if ($LASTEXITCODE) { Fail "Creating the release failed." }

Write-Host @"

Draft release $tag created with three assets.

Check the page, then publish it. Until you do, `releases/latest/download/latest.json`
still points at the release before this one and nobody is offered anything.
"@ -ForegroundColor Green
