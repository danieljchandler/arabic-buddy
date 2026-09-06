#Requires -Version 5.1
<#
.SYNOPSIS
    Deploys an Arabic LLM to Runpod Serverless as an OpenAI-compatible endpoint.

.DESCRIPTION
    Creates a Runpod Serverless template + endpoint running the official vLLM
    worker, for models too large to run on a 24 GB laptop. Companion to
    setup-local-arabic-models.ps1: same catalogue idea, rented GPU instead of
    local RAM.

    Everything goes through Runpod's REST API (https://rest.runpod.io/v1), so
    no web console is needed:

      1. Preflight   - validates the API key, checks the model is reachable,
                       and refuses gated models without an HF token.
      2. Template    - POST /templates   (runpod/worker-v1-vllm image + env)
      3. Endpoint    - POST /endpoints   (GPU, autoscaling, idle timeout)
      4. Report      - prints the OpenAI base URL and a ready-to-run test call.

    NOTE ON ARTIFACTS: vLLM loads original safetensors, NOT the GGUF quants the
    local script downloads. Sizes here are bf16 weights, which is why the GPU
    tiers look large next to the local numbers.

    SPEND SAFETY: workersMin defaults to 0 so the endpoint scales to zero and
    costs nothing idle. Setting -WorkersMin above 0 keeps GPUs warm and BILLS
    CONTINUOUSLY; the script requires -IAcceptIdleCost to allow it.

.PARAMETER Model
    Catalogue key to deploy. Use -List to see them.

.PARAMETER ApiKey
    Runpod API key. Defaults to $env:RUNPOD_API_KEY. Create one at
    https://console.runpod.io/user/settings

.PARAMETER HfToken
    Hugging Face token, required for gated models (Jais 2). Defaults to
    $env:HF_TOKEN.

.PARAMETER GpuType
    Override the catalogue's GPU choice, e.g. "NVIDIA L40S". Must match
    Runpod's exact ID string.

.PARAMETER WorkersMin
    Warm workers. 0 (default) = scale to zero = no idle cost.

.PARAMETER Delete
    Tear down: deletes the endpoint (and its template) by name.

.PARAMETER DryRun
    Print the exact API request bodies and exit without creating anything.

.EXAMPLE
    $env:RUNPOD_API_KEY = "rpa_..."
    .\deploy-runpod-arabic-endpoint.ps1 -Model falcon-h1-7b

.EXAMPLE
    .\deploy-runpod-arabic-endpoint.ps1 -Model jais2-70b -HfToken hf_... -DryRun
#>
[CmdletBinding()]
param(
    [string] $Model,
    [string] $ApiKey     = $env:RUNPOD_API_KEY,
    [string] $HfToken    = $env:HF_TOKEN,
    [string] $GpuType,
    [int]    $WorkersMin = 0,
    [int]    $WorkersMax = 2,
    [int]    $IdleTimeout = 5,
    [switch] $IAcceptIdleCost,
    [switch] $List,
    [switch] $Delete,
    [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

# Windows PowerShell 5.1 still negotiates TLS 1.0/1.1 by default on some boxes,
# which modern APIs refuse. Force 1.2 before any HTTPS call.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RunpodApi   = 'https://rest.runpod.io/v1'
$WorkerImage = 'runpod/worker-v1-vllm:v2.26.0'   # verified on Docker Hub

# ---------------------------------------------------------------------------
# Catalogue
#
# DiskGb must hold the bf16 weights the worker downloads at cold start, plus
# room for the container itself. GpuType strings are Runpod's exact IDs, taken
# from the OpenAPI spec's enum - a near-miss like "L40s" is rejected.
# ---------------------------------------------------------------------------
$Catalogue = @(
    [pscustomobject]@{
        Key = 'falcon-h1-7b'; Repo = 'tiiuae/Falcon-H1-7B-Instruct'
        WeightsGb = 14.1; Gated = $false; GpuType = 'NVIDIA L40S'; GpuCount = 1
        DiskGb = 60; MaxLen = 8192
        Title = 'Falcon-H1 7B Instruct'
        Note  = 'Generic multilingual base, not the Arabic variant (TII published no Arabic weights). Hybrid Mamba/attention; vLLM supports FalconH1ForCausalLM natively.'
    },
    [pscustomobject]@{
        Key = 'falcon-h1-34b'; Repo = 'tiiuae/Falcon-H1-34B-Instruct'
        WeightsGb = 62.7; Gated = $false; GpuType = 'NVIDIA A100 80GB PCIe'; GpuCount = 1
        DiskGb = 140; MaxLen = 8192
        Title = 'Falcon-H1 34B Instruct'
        Note  = 'Same family, 34B. Fits one 80 GB card but leaves modest KV headroom - drop MaxLen if it OOMs on load.'
    },
    [pscustomobject]@{
        Key = 'fanar-9b'; Repo = 'QCRI/Fanar-1-9B-Instruct'
        WeightsGb = 16.4; Gated = $false; GpuType = 'NVIDIA L40S'; GpuCount = 1
        DiskGb = 60; MaxLen = 8192
        Title = 'Fanar 1 9B Instruct (QCRI)'
        Note  = 'Card claims MSA plus Gulf, Levantine and Egyptian - the only explicit Gulf claim in this catalogue. Same family already called through the QCRI API.'
    },
    [pscustomobject]@{
        Key = 'jais2-8b'; Repo = 'inception42/Jais-2-8B-Chat'
        WeightsGb = 15.1; Gated = $true; GpuType = 'NVIDIA L40S'; GpuCount = 1
        DiskGb = 60; MaxLen = 8192
        Title = 'Jais 2 8B Chat (MBZUAI/Inception/Cerebras)'
        Note  = 'Current Jais generation (2026, arXiv:2608.13580). Claims MSA, regional dialects and AR/EN code-switching. GATED - needs an HF token.'
    },
    [pscustomobject]@{
        Key = 'jais2-70b'; Repo = 'inception42/Jais-2-70B-Chat'
        WeightsGb = 134.2; Gated = $true; GpuType = 'NVIDIA H100 80GB HBM3'; GpuCount = 2
        DiskGb = 260; MaxLen = 8192
        Title = 'Jais 2 70B Chat'
        Note  = 'The reason to rent rather than run locally. Needs 2x80 GB with tensor parallelism. GATED. Cold starts are slow at this size - consider a network volume.'
    }
)

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
function Write-Step { param([string]$m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok   { param([string]$m) Write-Host "    [ok]   $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "    [warn] $m" -ForegroundColor Yellow }
function Write-Info { param([string]$m) Write-Host "    $m" -ForegroundColor Gray }

function Invoke-Runpod {
    <# Thin REST wrapper. PS 5.1 has no -SkipHttpErrorCheck, so error bodies are
       dug out of the exception stream to surface Runpod's actual message. #>
    param(
        [string]$Method,
        [string]$Path,
        [object]$Body
    )
    $headers = @{ Authorization = "Bearer $ApiKey"; 'Content-Type' = 'application/json' }
    $args = @{ Uri = "$RunpodApi$Path"; Method = $Method; Headers = $headers }
    if ($Body) { $args.Body = ($Body | ConvertTo-Json -Depth 10 -Compress) }

    try {
        return Invoke-RestMethod @args
    } catch {
        $detail = ''
        try {
            $resp = $_.Exception.Response
            if ($resp) {
                $reader = New-Object IO.StreamReader($resp.GetResponseStream())
                $detail = $reader.ReadToEnd()
            }
        } catch { }
        throw ("Runpod $Method $Path failed: $($_.Exception.Message)`n$detail")
    }
}

# ---------------------------------------------------------------------------
# List / resolve
# ---------------------------------------------------------------------------
if ($List -or -not $Model) {
    Write-Host "`n  Runpod Serverless - Arabic model catalogue" -ForegroundColor White
    Write-Host '  -----------------------------------------' -ForegroundColor DarkGray
    foreach ($m in $Catalogue) {
        $gate = if ($m.Gated) { ' [GATED]' } else { '' }
        Write-Host ("`n  {0,-14} {1}{2}" -f $m.Key, $m.Title, $gate) -ForegroundColor White
        Write-Host ("    {0}  |  bf16 ~{1} GB  |  {2} x{3}" -f $m.Repo, $m.WeightsGb, $m.GpuType, $m.GpuCount) -ForegroundColor DarkGray
        Write-Host ("    {0}" -f $m.Note) -ForegroundColor DarkGray
    }
    Write-Host "`n  Deploy with: -Model <key>`n" -ForegroundColor Gray
    return
}

$sel = $Catalogue | Where-Object { $_.Key -eq $Model }
if (-not $sel) { throw "Unknown model '$Model'. Valid keys: $($Catalogue.Key -join ', ')" }
if ($GpuType) { $sel.GpuType = $GpuType }

$endpointName = "arabic-$($sel.Key)"
$templateName = "arabic-$($sel.Key)-tmpl"

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
Write-Step 'Preflight'

if (-not $ApiKey) {
    throw 'No Runpod API key. Set $env:RUNPOD_API_KEY or pass -ApiKey. Create one at https://console.runpod.io/user/settings'
}
if ($sel.Gated -and -not $HfToken) {
    throw "$($sel.Repo) is a gated repo - an unauthenticated download returns 401. Accept its terms on Hugging Face, then set `$env:HF_TOKEN or pass -HfToken."
}
if ($WorkersMin -gt 0 -and -not $IAcceptIdleCost) {
    throw "WorkersMin=$WorkersMin keeps $WorkersMin GPU worker(s) warm and bills continuously, whether or not you send requests. Re-run with -IAcceptIdleCost if that is intended."
}

Write-Info "Model     : $($sel.Repo)"
Write-Info "GPU       : $($sel.GpuType) x$($sel.GpuCount)"
Write-Info "Workers   : min=$WorkersMin max=$WorkersMax  idleTimeout=${IdleTimeout}s"
if ($WorkersMin -eq 0) { Write-Ok 'Scales to zero - no cost while idle' }
else { Write-Warn "$WorkersMin worker(s) stay warm - BILLING CONTINUOUSLY" }

# ---------------------------------------------------------------------------
# Teardown
# ---------------------------------------------------------------------------
if ($Delete) {
    Write-Step "Deleting endpoint '$endpointName'"
    $eps = Invoke-Runpod -Method GET -Path '/endpoints'
    $victim = $eps | Where-Object { $_.name -eq $endpointName }
    if (-not $victim) { Write-Warn 'No endpoint with that name.'; return }

    # An endpoint must be scaled to zero before Runpod will delete it.
    Invoke-Runpod -Method PATCH -Path "/endpoints/$($victim.id)" -Body @{ workersMin = 0; workersMax = 0 } | Out-Null
    Invoke-Runpod -Method DELETE -Path "/endpoints/$($victim.id)" | Out-Null
    Write-Ok "Endpoint $($victim.id) deleted"

    $tmpls = Invoke-Runpod -Method GET -Path '/templates'
    $t = $tmpls | Where-Object { $_.name -eq $templateName }
    if ($t) {
        Invoke-Runpod -Method DELETE -Path "/templates/$($t.id)" | Out-Null
        Write-Ok "Template $($t.id) deleted"
    }
    return
}

# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------
$env_vars = @{
    MODEL_NAME             = $sel.Repo
    MAX_MODEL_LEN          = "$($sel.MaxLen)"
    GPU_MEMORY_UTILIZATION = '0.90'
}
if ($sel.GpuCount -gt 1) { $env_vars.TENSOR_PARALLEL_SIZE = "$($sel.GpuCount)" }
if ($HfToken)            { $env_vars.HF_TOKEN             = $HfToken }

$templateBody = @{
    name              = $templateName
    imageName         = $WorkerImage
    isServerless      = $true
    containerDiskInGb = $sel.DiskGb
    volumeInGb        = 0
    env               = $env_vars
}

$endpointBody = @{
    name        = $endpointName
    computeType = 'GPU'
    gpuTypeIds  = @($sel.GpuType)
    gpuCount    = $sel.GpuCount
    workersMin  = $WorkersMin
    workersMax  = $WorkersMax
    idleTimeout = $IdleTimeout
    flashboot   = $true
    scalerType  = 'QUEUE_DELAY'
    scalerValue = 4
}

if ($DryRun) {
    Write-Step 'Dry run - request bodies only'
    Write-Host "`n  POST $RunpodApi/templates" -ForegroundColor White
    $redacted = $templateBody.Clone()
    $redacted.env = $env_vars.Clone()
    if ($redacted.env.ContainsKey('HF_TOKEN')) { $redacted.env.HF_TOKEN = '<redacted>' }
    $redacted | ConvertTo-Json -Depth 10
    Write-Host "`n  POST $RunpodApi/endpoints  (templateId filled in from the response above)" -ForegroundColor White
    $endpointBody | ConvertTo-Json -Depth 10
    Write-Host "`nNothing created.`n" -ForegroundColor Yellow
    return
}

# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------
Write-Step 'Creating template'
$tmpl = Invoke-Runpod -Method POST -Path '/templates' -Body $templateBody
Write-Ok "Template $($tmpl.id)  ($WorkerImage)"

Write-Step 'Creating endpoint'
$endpointBody.templateId = $tmpl.id
$ep = Invoke-Runpod -Method POST -Path '/endpoints' -Body $endpointBody
Write-Ok "Endpoint $($ep.id)"

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
$baseUrl = "https://api.runpod.ai/v2/$($ep.id)/openai/v1"

Write-Step 'Ready'
Write-Host ''
Write-Host "  $($sel.Title)" -ForegroundColor White
Write-Host "    OpenAI base URL : $baseUrl" -ForegroundColor Gray
Write-Host "    Model name      : $($sel.Repo)" -ForegroundColor Gray
Write-Host "    Console         : https://console.runpod.io/serverless/$($ep.id)" -ForegroundColor Gray
Write-Host ''
Write-Host '  Test it:' -ForegroundColor White
Write-Host @"
    curl $baseUrl/chat/completions ``
      -H "Authorization: Bearer `$env:RUNPOD_API_KEY" ``
      -H "Content-Type: application/json" ``
      -d '{\"model\":\"$($sel.Repo)\",\"messages\":[{\"role\":\"user\",\"content\":\"شلونك؟\"}]}'
"@ -ForegroundColor DarkGray
Write-Host ''
Write-Warn 'First request cold-starts the worker: it downloads the weights before answering.'
Write-Info "At ~$($sel.WeightsGb) GB that can take minutes. Later requests reuse the warm worker until idleTimeout."
Write-Info "Tear down with:  .\deploy-runpod-arabic-endpoint.ps1 -Model $($sel.Key) -Delete"
Write-Host ''
