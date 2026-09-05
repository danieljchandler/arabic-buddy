#Requires -Version 5.1
<#
.SYNOPSIS
    Installs LM Studio and downloads Arabic-capable GGUF models sized to fit a 24 GB machine.

.DESCRIPTION
    End-to-end, unattended local setup for running Arabic LLMs on Windows 11:

      1. Preflight  - checks Windows build, AVX2, RAM and free disk.
      2. Engine     - installs LM Studio via winget, bootstraps the `lms` CLI.
      3. Models     - resolves each model's exact GGUF filename and byte size from
                      the Hugging Face API, downloads with resume, verifies the size.
      4. Report     - prints per-model runtime settings for a 24 GB box.

    No Python, no pip, no Hugging Face CLI. Uses curl.exe, which ships with
    Windows 10 1803+ and Windows 11.

    Downloads are resumable: re-run the script after an interruption and it
    picks up where it stopped rather than starting over.

.PARAMETER ModelsRoot
    Where GGUFs land. Defaults to LM Studio's own model directory, in the
    publisher\repo\file.gguf layout LM Studio indexes automatically.

.PARAMETER Only
    Download just these catalogue keys (e.g. -Only fanar-9b,jais-13b).
    Default is every model marked Recommended.

.PARAMETER All
    Download every catalogue entry, including ones not recommended for 24 GB.

.PARAMETER SkipEngine
    Skip the LM Studio install/bootstrap; download models only.

.PARAMETER DryRun
    Print the plan (sizes, destinations, total download) and exit.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\setup-local-arabic-models.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\setup-local-arabic-models.ps1 -Only fanar-9b -DryRun
#>
[CmdletBinding()]
param(
    [string]   $ModelsRoot = "$env:USERPROFILE\.lmstudio\models",
    [string[]] $Only,
    [switch]   $All,
    [switch]   $SkipEngine,
    [switch]   $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ModelsRoot)) {
    throw 'ModelsRoot resolved to an empty path. Pass -ModelsRoot explicitly, e.g. -ModelsRoot D:\models'
}
$ProgressPreference    = 'SilentlyContinue'   # keeps Invoke-RestMethod fast

# ---------------------------------------------------------------------------
# Catalogue
#
# Sizes are fetched live from the Hugging Face API at run time; the figures in
# ApproxGB are for the dry-run plan and preflight only.
#
# Everything Recommended fits in 24 GB of shared CPU/iGPU memory with room for
# context. Jais 30B is listed but NOT recommended: see the note on its entry.
# ---------------------------------------------------------------------------
$Catalogue = @(
    [pscustomobject]@{
        Key         = 'fanar-9b'
        Repo        = 'mradermacher/Fanar-1-9B-Instruct-GGUF'
        Quant       = 'Q4_K_M'
        ApproxGB    = 5.4
        Recommended = $true
        Title       = 'Fanar 1 9B Instruct (QCRI)'
        Why         = 'Arabic-first, and the same family Hakiya already calls through the QCRI API. Best like-for-like local comparison.'
        Context     = 8192
    },
    [pscustomobject]@{
        Key         = 'jais-13b'
        Repo        = 'mradermacher/jais-family-13b-chat-GGUF'
        Quant       = 'Q4_K_M'
        ApproxGB    = 9.0
        Recommended = $true
        Title       = 'Jais family 13B chat (G42/Inception)'
        Why         = 'Real Jais architecture, bilingual AR/EN tokenizer. The largest Jais that fits this machine with usable quality.'
        Context     = 4096
    },
    [pscustomobject]@{
        Key         = 'falcon-h1-7b'
        Repo        = 'tiiuae/Falcon-H1-7B-Instruct-GGUF'
        Quant       = 'Q4_K_M'
        ApproxGB    = 4.6
        Recommended = $true
        Title       = 'Falcon-H1 7B Instruct (TII)'
        Why         = 'Strong multilingual base. NOT the Arabic-tuned variant - TII announced Falcon-H1 Arabic but has published no Arabic weights. Hybrid Mamba/Transformer: needs a recent LM Studio runtime.'
        Context     = 8192
    },
    [pscustomobject]@{
        Key         = 'allam-7b'
        Repo        = 'bartowski/ALLaM-AI_ALLaM-7B-Instruct-preview-GGUF'
        Quant       = 'Q4_K_M'
        ApproxGB    = 4.8
        Recommended = $false
        Title       = 'ALLaM 7B Instruct (SDAIA/HUMAIN)'
        Why         = 'Saudi Arabic model. Useful third opinion; skipped by default to keep the first run short.'
        Context     = 4096
    },
    [pscustomobject]@{
        Key         = 'jais-30b'
        Repo        = 'mradermacher/jais-family-30b-8k-chat-i1-GGUF'
        Quant       = 'i1-IQ2_XXS'
        ApproxGB    = 19.7
        Recommended = $false
        Title       = 'Jais family 30B 8k chat  [DOES NOT FIT - see note]'
        Why         = 'Jais 30B has a very large bilingual embedding matrix, so its quants are far bigger than parameter count suggests: Q4_K_M is 27.9 GB and even Q2_K is 21.7 GB. The 19.7 GB IQ2_XXS shown here is a 2-bit quant that leaves no room for OS or context on a 24 GB machine, and 2-bit badly degrades Arabic morphology. Listed for completeness only. Use -All -Only jais-30b if you want to try it anyway.'
        Context     = 2048
    }
)

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
function Write-Step { param([string]$Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Message) Write-Host "    [ok]   $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "    [warn] $Message" -ForegroundColor Yellow }
function Write-Info { param([string]$Message) Write-Host "    $Message" -ForegroundColor Gray }
function Write-Fail { param([string]$Message) Write-Host "    [FAIL] $Message" -ForegroundColor Red }

function Format-GB {
    param([double]$Bytes)
    if ($Bytes -ge 1GB) { '{0:N1} GB' -f ($Bytes / 1GB) }
    else                { '{0:N0} MB' -f ($Bytes / 1MB) }
}

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------
function Invoke-Preflight {
    param([double]$RequiredGB)

    Write-Step 'Preflight'

    $os = Get-CimInstance Win32_OperatingSystem
    Write-Info "$($os.Caption) (build $($os.BuildNumber))"
    if ([int]$os.BuildNumber -lt 17763) {
        throw "Windows 10 build 1809 (17763) or newer is required for winget. Found build $($os.BuildNumber)."
    }

    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    Write-Info "$($cpu.Name.Trim())  -  $($cpu.NumberOfCores)C/$($cpu.NumberOfLogicalProcessors)T"

    # LM Studio 0.4.20+ requires AVX2.
    $avx2 = $false
    try {
        $avx2 = [System.Runtime.Intrinsics.X86.Avx2]::IsSupported
    } catch {
        # .NET Framework PowerShell 5.1 has no Intrinsics namespace; infer instead.
        $avx2 = $cpu.Name -match 'Ryzen|Core\(TM\) i[3579]-[4-9]|Ultra|EPYC|Xeon'
        Write-Info 'AVX2 probed indirectly (PowerShell 5.1 has no intrinsics API).'
    }
    if ($avx2) { Write-Ok 'AVX2 available (required by LM Studio 0.4.20+)' }
    else       { Write-Warn 'Could not confirm AVX2. LM Studio 0.4.20+ will refuse to start without it.' }

    $ramGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
    Write-Info "Installed RAM: $ramGB GB (shared with the integrated GPU)"
    if ($ramGB -lt 15) {
        Write-Warn "Under 16 GB of RAM. Stick to models at or below 5 GB."
    }

    $drive = (Get-Item $ModelsRoot -ErrorAction SilentlyContinue)
    $root  = if ($drive) { $drive.PSDrive.Name } else { (Split-Path -Qualifier $ModelsRoot).TrimEnd(':') }
    $free  = (Get-PSDrive -Name $root).Free
    Write-Info "Free space on $($root): $(Format-GB $free)"

    $needed = $RequiredGB * 1GB * 1.05   # 5% headroom for partial files
    if ($free -lt $needed) {
        throw ("Need about {0:N1} GB free on drive {1} but only {2} is available." -f ($needed/1GB), $root, (Format-GB $free))
    }
    Write-Ok 'Preflight passed'
}

# ---------------------------------------------------------------------------
# 2. Engine: LM Studio + lms CLI
# ---------------------------------------------------------------------------
function Install-Engine {
    Write-Step 'LM Studio'

    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw 'winget not found. Install "App Installer" from the Microsoft Store, then re-run.'
    }

    $installed = winget list --id ElementLabs.LMStudio --exact 2>$null | Out-String
    if ($installed -match 'ElementLabs\.LMStudio') {
        Write-Ok 'LM Studio already installed'
    } else {
        Write-Info 'Installing ElementLabs.LMStudio via winget...'
        winget install --id ElementLabs.LMStudio --exact `
                       --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) {
            throw "winget exited with code $LASTEXITCODE. Install LM Studio manually from https://lmstudio.ai and re-run with -SkipEngine."
        }
        Write-Ok 'LM Studio installed'
    }

    # Bootstrap the `lms` CLI so the models directory and PATH entry exist.
    $lms = Join-Path $env:USERPROFILE '.lmstudio\bin\lms.exe'
    if (Test-Path $lms) {
        Write-Info 'Bootstrapping the lms CLI...'
        & $lms bootstrap 2>&1 | Out-Null
        Write-Ok "lms CLI ready ($lms)"
    } else {
        Write-Warn 'lms.exe not present yet. Launch LM Studio once, then re-run to enable the CLI.'
    }
}

# ---------------------------------------------------------------------------
# 3. Model resolution and download
# ---------------------------------------------------------------------------
function Resolve-ModelFile {
    <#
      Asks the Hugging Face API for the repo's file list and picks the GGUF
      matching the requested quant. Returns filename + exact byte size, so the
      download can be verified rather than assumed.
    #>
    param([string]$Repo, [string]$Quant)

    $api = "https://huggingface.co/api/models/$Repo" + '?blobs=true'
    try {
        $meta = Invoke-RestMethod -Uri $api -TimeoutSec 60
    } catch {
        throw "Could not reach the Hugging Face API for $Repo. $($_.Exception.Message)"
    }

    $candidates = @($meta.siblings | Where-Object {
        $_.rfilename -like '*.gguf' -and $_.rfilename -match [regex]::Escape($Quant)
    })

    if ($candidates.Count -eq 0) {
        $available = ($meta.siblings | Where-Object { $_.rfilename -like '*.gguf' } |
                      ForEach-Object { $_.rfilename }) -join ', '
        throw "No GGUF matching quant '$Quant' in $Repo. Available: $available"
    }

    # Prefer an exact stem match so Q4_K_M never resolves to Q4_K_M_something.
    $pick = $candidates | Where-Object { $_.rfilename -match "[.\-]$([regex]::Escape($Quant))\.gguf$" } |
            Select-Object -First 1
    if (-not $pick) { $pick = $candidates | Select-Object -First 1 }

    [pscustomobject]@{
        FileName = $pick.rfilename
        Size     = [long]$pick.size
        Url      = "https://huggingface.co/$Repo/resolve/main/$($pick.rfilename)"
    }
}

function Get-ModelFile {
    param([pscustomobject]$Model, [pscustomobject]$File)

    # LM Studio indexes <models root>\<publisher>\<repo>\<file>.gguf
    $publisher = $Model.Repo.Split('/')[0]
    $repoName  = $Model.Repo.Split('/')[1]
    $destDir   = Join-Path (Join-Path $ModelsRoot $publisher) $repoName
    $destPath  = Join-Path $destDir $File.FileName

    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }

    if (Test-Path $destPath) {
        $have = (Get-Item $destPath).Length
        if ($have -eq $File.Size) {
            Write-Ok "$($Model.Title) - already complete ($(Format-GB $have))"
            return $destPath
        }
        if ($have -gt $File.Size) {
            Write-Warn "Local file is larger than expected - discarding and restarting."
            Remove-Item $destPath -Force
        } else {
            Write-Info "Resuming at $(Format-GB $have) of $(Format-GB $File.Size)..."
        }
    } else {
        Write-Info "Downloading $(Format-GB $File.Size) -> $destPath"
    }

    # curl.exe, not the PowerShell alias. -C - resumes, --retry survives blips.
    & curl.exe --location --continue-at - --fail --retry 5 --retry-delay 3 `
               --output "$destPath" "$($File.Url)"
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "curl exited $LASTEXITCODE for $($Model.Key). Re-run the script to resume."
        return $null
    }

    $final = (Get-Item $destPath).Length
    if ($final -ne $File.Size) {
        Write-Fail ("Size mismatch for {0}: got {1}, expected {2}. Re-run to resume." -f `
                    $Model.Key, (Format-GB $final), (Format-GB $File.Size))
        return $null
    }

    Write-Ok "$($Model.Title) - verified $(Format-GB $final)"
    return $destPath
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
$selected = if ($Only) {
    $missing = $Only | Where-Object { $_ -notin $Catalogue.Key }
    if ($missing) { throw "Unknown model key(s): $($missing -join ', '). Valid: $($Catalogue.Key -join ', ')" }
    $Catalogue | Where-Object { $_.Key -in $Only }
} elseif ($All) {
    $Catalogue
} else {
    $Catalogue | Where-Object { $_.Recommended }
}

Write-Host ''
Write-Host '  Local Arabic LLM setup - LM Studio on Windows' -ForegroundColor White
Write-Host '  ---------------------------------------------' -ForegroundColor DarkGray

Write-Step 'Resolving models on Hugging Face'
$plan = foreach ($m in $selected) {
    $f = Resolve-ModelFile -Repo $m.Repo -Quant $m.Quant
    Write-Info ("{0,-14} {1,-42} {2}" -f $m.Key, $f.FileName, (Format-GB $f.Size))
    [pscustomobject]@{ Model = $m; File = $f }
}

# Explicit sum: Measure-Object -Property {scriptblock} is PowerShell 6+,
# and Windows 11 still ships Windows PowerShell 5.1 as `powershell.exe`.
$totalBytes = 0L
foreach ($p in $plan) { $totalBytes += $p.File.Size }
$totalGB = $totalBytes / 1GB
Write-Host ''
Write-Info ("Total download: {0:N1} GB into {1}" -f $totalGB, $ModelsRoot)

if ($DryRun) {
    Write-Host ''
    foreach ($p in $plan) {
        Write-Host "  $($p.Model.Title)" -ForegroundColor White
        Write-Host "    $($p.Model.Why)" -ForegroundColor DarkGray
    }
    Write-Host "`nDry run only - nothing downloaded or installed.`n" -ForegroundColor Yellow
    return
}

Invoke-Preflight -RequiredGB $totalGB
if (-not $SkipEngine) { Install-Engine } else { Write-Step 'LM Studio'; Write-Info 'Skipped (-SkipEngine)' }

Write-Step 'Downloading models'
$results = foreach ($p in $plan) {
    [pscustomobject]@{
        Model = $p.Model
        Path  = Get-ModelFile -Model $p.Model -File $p.File
    }
}

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
Write-Step 'Summary'
$ok     = @($results | Where-Object { $_.Path })
$failed = @($results | Where-Object { -not $_.Path })

foreach ($r in $ok) {
    Write-Host ''
    Write-Host "  $($r.Model.Title)" -ForegroundColor White
    Write-Host "    $($r.Model.Why)" -ForegroundColor DarkGray
    Write-Host "    Suggested context : $($r.Model.Context) tokens" -ForegroundColor Gray
    Write-Host "    GPU offload       : start at max, drop if you see stutter" -ForegroundColor Gray
}

if ($failed) {
    Write-Host ''
    Write-Warn "$($failed.Count) model(s) did not complete: $(($failed.Model.Key) -join ', ')"
    Write-Info 'Re-run this script - downloads resume from where they stopped.'
}

Write-Host ''
Write-Host '  Next steps' -ForegroundColor White
Write-Host '  ----------' -ForegroundColor DarkGray
Write-Info '1. Open LM Studio. The models appear under My Models automatically.'
Write-Info '2. Load ONE at a time - RAM is shared with the iGPU, so two large models will swap.'
Write-Info '3. For an OpenAI-compatible endpoint on http://localhost:1234/v1 :'
Write-Info '       lms server start'
Write-Info '4. Sanity-check Arabic output before trusting any of them for dialect work:'
Write-Info '       these models are all instruction-tuned toward MSA, not dialect.'
Write-Host ''
