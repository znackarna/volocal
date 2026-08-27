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

.PARAMETER NotesCs
  What the reader gets, in Czech, for the dialog the application shows before
  anybody agrees to a download. This is the text that goes into latest.json,
  which only an installed copy of Volocal ever reads - and its readers are
  Czech.

  Short noun phrases naming the gain, not sentences describing the commit:

    Zprehledneni nabidky mluvcich          not  Nabidka nad prepisem nabizi
    Drobna vizualni vylepseni ikon              jmena mluvcich misto "vyse/nize"

  The reader is deciding whether to restart their work for this. What they want
  is what improves, in the time it takes to read four words. The detail belongs
  in the English text and in docs\history.

  Lines beginning with "- " become a list in the dialog. Everything else is a
  paragraph.

.PARAMETER NotesEn
  The same release in English, for the GitHub release page. Its readers arrive
  from anywhere and are developers, so nothing on that page is in Czech.

  Short here too. This used to say the detail was welcome on that page, and it
  was wrong: a developer reading a release page is deciding whether this version
  matters to them, which is the same question the Czech reader is asking in
  their own words. One line per change, the gain and not the mechanism, and no
  paragraph under a bullet.

  Two texts rather than one translated at either end, because the two audiences
  read different languages - not because one of them wants more.

  Where the detail goes instead: docs\history, which is written per day and
  holds the reasoning behind every decision in the release. A release note that
  has to explain itself is a history entry standing in the wrong place.

.PARAMETER Material
  Prints what happened since the last tag - the commits, and the change log for
  the days they fall on - and stops. This is what the two texts get written
  from; it summarises nothing by itself, because a machine summary of commit
  subjects is exactly how a release ends up announcing "various fixes".
#>
param(
  [switch]$Publish,
  [string]$Installer,
  [string]$NotesCs = "",
  [string]$NotesEn = "",
  [switch]$Material,
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

<#
  The tree has to be the commit it says it is, and it has to be asked before
  anything is built rather than after.

  **Asking afterwards is not a guard.** The build takes what is on disk at that
  moment; stash the uncommitted part and the tree is clean and still at the same
  commit, so a later check passes over an installer nobody can account for. The
  version in the file name and the commit in built-from.txt both agree with it,
  because both were true - of a tree that no longer exists.

  It also cost twenty minutes on 26 August in the ordinary direction: the build
  rewrites Cargo.lock with the new version, that file was still uncommitted when
  the second pass ran, and committing it moved HEAD away from the installer.

  `git status --porcelain` already reports all three states this must refuse -
  staged, modified in the working tree, untracked - and reports no ignored file,
  so what .gitignore covers is allowed by construction. What it did not do is
  say which files, which is the difference between a stop and a useful one.
#>
function Assert-CleanTree {
  $dirty = @(git status --porcelain)
  if ($LASTEXITCODE) { Fail "git status failed - is this a repository?" }
  if (-not $dirty) { return }

  $staged  = @($dirty | Where-Object { $_[0] -ne " " -and $_[0] -ne "?" })
  $changed = @($dirty | Where-Object { $_[1] -ne " " -and $_[1] -ne "?" })
  $new     = @($dirty | Where-Object { $_.StartsWith("??") })

  $lines = @()
  if ($staged.Count)  { $lines += "  staged but not committed:"; $lines += ($staged  | ForEach-Object { "    " + $_.Substring(3) }) }
  if ($changed.Count) { $lines += "  changed and not committed:"; $lines += ($changed | ForEach-Object { "    " + $_.Substring(3) }) }
  if ($new.Count)     { $lines += "  not in the repository at all:"; $lines += ($new     | ForEach-Object { "    " + $_.Substring(3) }) }

  Fail @"
The working tree is not the commit it stands on.

$($lines -join "`n")

An installer built from this cannot be traced to anything - and stashing these
afterwards would leave a clean tree at the same commit, which is a release that
passes every check and contains code nobody can point at.

Commit them, or stash them now and build from what is left. Files .gitignore
covers are not counted here.
"@
}

# Everything that happened since the last release, laid out to write the two
# note texts from. Nothing here decides what is worth mentioning.
function Show-Material {
  $last = git describe --tags --abbrev=0 2>$null
  if ($LASTEXITCODE -or -not $last) {
    Write-Host "No tag yet - showing the whole history." -ForegroundColor Yellow
    $range = "HEAD"
  } else {
    $range = "$last..HEAD"
  }

  Step "Commits ($range)"
  git log --no-merges --format="  %h  %s" $range

  Step "Change log for those days"
  # The log is one file per day and the commits carry their dates, so the days
  # that were worked on are the days worth reading back.
  $days = git log --format="%ad" --date=format:"%Y-%m-%d" $range | Sort-Object -Unique
  foreach ($day in $days) {
    $file = "docs\history\$day.md"
    if (Test-Path $file) {
      Write-Host "`n--- $file" -ForegroundColor DarkGray
      Get-Content $file
    }
  }

  Write-Host @"

Now write the two texts and publish with both:

  scripts\release.ps1 -Publish -NotesCs "..." -NotesEn "..."

Czech goes to the application's dialog, English to the release page. Lines
starting with "- " become a list in the dialog.
"@ -ForegroundColor Green
}

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

if ($Material) {
  Show-Material
  exit 0
}

if (-not $Publish) {
  # First, and before the twenty minutes: what is about to be built has to be
  # something that can be pointed at afterwards.
  if ($SkipChecks) {
    Write-Host @"

-SkipChecks: building without asking whether the tree is committed.

Whatever is on disk goes into this installer, and nothing later can work out
what that was.
"@ -ForegroundColor Yellow
  } else {
    Step "The tree"
    Assert-CleanTree
    Write-Host "clean at $((git rev-parse --short HEAD).Trim())" -ForegroundColor Green
  }

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
  & "node_modules\.bin\tauri.cmd" build --config src-tauri/tauri.ci.conf.json
  if ($LASTEXITCODE) { Fail "The build failed." }

  $exe = Get-ChildItem "$bundle\*.exe" | Sort-Object LastWriteTime | Select-Object -Last 1

  # What this installer was built from, written beside it. The second pass reads
  # it back and refuses to publish an installer built from a different tree -
  # see the note there for why an mtime and a version in the file name are not
  # enough to tell.
  $head = (git rev-parse HEAD).Trim()
  Set-Content -Path (Join-Path $bundle "built-from.txt") -Value "$head`n$version" -NoNewline
  Write-Host @"

Built: $($exe.FullName)

Now sign it with the certificate on the token, and then run:

  scripts\release.ps1 -Material
  scripts\release.ps1 -Publish -NotesCs "..." -NotesEn "..."

The first prints what changed since the last tag; the second wants that written
up twice, in Czech for the dialog the application shows and in English for the
release page.

Signing after this point is deliberate: the updater signature is made in the
second pass, over the file as it will be downloaded.
"@ -ForegroundColor Green
  exit 0
}

# ---------------------------------------------------------------- second pass

<#
  **This pass used to check nothing at all.** It picked the newest .exe in the
  bundle folder by write time, confirmed the version was in its name, and
  published it. That is not a guard: a rebuild between the two passes has the
  same name and a newer time, and so does a build of a tree with uncommitted
  work in it. Volocal shipped 1.0.0's installer as 1.0.1 once already, and on a
  day with several releases the exposure compounds.

  Three questions, all cheap, all asked before anything is signed or uploaded:

  * is the tree the one the installer was built from, and is it clean;
  * is the dictionary still ready, which is the check most likely to have been
    broken by a "just one more string" between the passes;
  * does the installer name the version being released.

  A refused release is annoying and visible. A release that does not contain
  what it says is neither.
#>
if (-not $SkipChecks) {
  Step "What is being published"

  # The same guard the first pass ran, for the case where something landed
  # between the two - and it is the same function, because two spellings of one
  # rule is how the passes come to disagree about what clean means.
  Assert-CleanTree

  node scripts/i18n.mjs check --strict
  if ($LASTEXITCODE) { Fail "The dictionary is not ready for a release." }
}

# Asked for before anything is signed or uploaded. A release without notes is
# what 1.0.4 was: the application offers a restart for a version it can say
# nothing about, and the reader agrees to it blind. There is no default here on
# purpose - "" would pass a check for emptiness and still say nothing.
if (-not $NotesCs.Trim() -or -not $NotesEn.Trim()) {
  Fail @"
Both -NotesCs and -NotesEn are needed.

  scripts\release.ps1 -Material       what changed since the last tag
  scripts\release.ps1 -Publish -NotesCs "..." -NotesEn "..."

Czech goes into latest.json, which only the application reads, and it shows it
before anybody agrees to download. English goes on the release page, which
developers read. Neither audience should meet the other's language.
"@
}

if (-not $Installer) {
  $found = Get-ChildItem "$bundle\*.exe" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
  if (-not $found) { Fail "No installer in $bundle. Run without -Publish first, or pass -Installer." }
  $Installer = $found.FullName
}
if (-not (Test-Path $Installer)) { Fail "No such file: $Installer" }
$exe = Get-Item $Installer

# The installer is picked by date, so a build that failed leaves the previous
# one sitting there looking like the newest thing in the folder. Publishing
# that would put the old binary behind the new version number: the update would
# install, report the version it was before, and be offered again for ever.
# Tauri puts the version in the file name, so the two can simply be compared.
if ($exe.Name -notlike "*$version*") {
  Fail @"
$($exe.Name) is not version $version.

That is the previous build, still in the folder because this one did not get
as far as replacing it. Run the first pass again and watch it finish.
"@
}

# And the commit it was built from, which the version in the name cannot tell:
# a rebuild of a different tree at the same version has the same name and a
# newer time. The first pass writes this down; a missing note means the
# installer came from somewhere else, which is exactly when to say so.
$note = Join-Path (Split-Path $exe.FullName -Parent) "built-from.txt"
# Read out here and not inside the check, because the tag is created from it
# further down whether the checks ran or not.
$here = (git rev-parse HEAD).Trim()
if (-not $SkipChecks) {
  if (-not (Test-Path $note)) {
    Fail @"
No record of what $($exe.Name) was built from.

The first pass writes built-from.txt beside the installer. Either this file
came from elsewhere - CI, another machine - or the build predates that record.
Build again, or pass -SkipChecks if you know what this installer is.
"@
  }
  $built = (Get-Content $note -Raw).Trim() -split "`n"
  if ($built[0] -ne $here) {
    Fail @"
$($exe.Name) was built from $($built[0].Substring(0, 8)); this tree is at $($here.Substring(0, 8)).

Something landed between the two passes. Whatever it was is not in the file
about to be published under this version number - build again.
"@
  }
}

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
  # Czech: this file is fetched by installed copies of Volocal and by nothing
  # else, and it is shown in the application's own dialog.
  notes     = $NotesCs
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
# English on the page, Czech in the file the page carries.
#
# `--target`, because a draft has no tag yet: GitHub makes it at the moment the
# draft is published, from the default branch's head *then*. Publish an hour
# later with one more merge on main and the tag names code this installer does
# not contain - the release page, `git describe` and every later `-Material`
# then describe the wrong tree. It is the commit the checks above just agreed
# the installer was built from.
gh release create $tag --draft --target $here --title "Volocal $version" --notes $NotesEn `
  $exe.FullName "$($exe.FullName).sig" $latestPath
if ($LASTEXITCODE) { Fail "Creating the release failed." }

Write-Host @"

Draft release $tag created with three assets.

Check the page, then publish it. Until you do, releases/latest/download/latest.json
still points at the release before this one and nobody is offered anything.
"@ -ForegroundColor Green
