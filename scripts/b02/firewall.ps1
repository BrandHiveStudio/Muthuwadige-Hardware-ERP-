<#
.SYNOPSIS
    Muthuwadige Hardware ERP - B02 Native Network Isolation Helper
    Deterministic Windows Defender Firewall per-program boundary for Electron probe.

.DESCRIPTION
    Strictly scoped, fail-closed firewall orchestration helper designed for B02 Electron isolation.
    Manages exactly two external egress block rules under the dedicated group
    'MuthuwadigeERP-B02-Electron-Isolation':
      1. MuthuwadigeERP-B02-Block-IPv4-External: drops non-loopback IPv4 ranges
         (0.0.0.0-126.255.255.255, 128.0.0.0-255.255.255.255).
      2. MuthuwadigeERP-B02-Block-IPv6-All: drops all IPv6 (::/0).
    Loopback IPv4 (127.0.0.0/8) is intentionally unblocked at the firewall level to permit
    the harness-owned disposable probe server, while intra-loopback session filtering is
    enforced by Chromium session controls.

    Supported Actions:
      - Inspect : Read-only audit of privileges, firewall service, and current B02 rules.
      - Install : Preflight check, stale rule purge, rule creation, WFP verification, attestation.
      - Remove  : Strict cleanup of B02-owned rules, verification of zero remaining rules.

.NOTES
    EXECUTION PROHIBITED during static review tasks.
    A35 unchanged; D01 pending; Tax frozen/removed; B03 locked.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Inspect', 'Install', 'Remove')]
    [string]$Action,

    [Parameter(Mandatory = $false)]
    [string]$ProgramPath,

    [Parameter(Mandatory = $false)]
    [string]$AttestationPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# CONSTANTS - Hardcoded B02 Ownership Boundary
# ---------------------------------------------------------------------------
$RULE_GROUP         = 'MuthuwadigeERP-B02-Electron-Isolation'
$RULE_NAME_IPV4     = 'MuthuwadigeERP-B02-Block-IPv4-External'
$RULE_NAME_IPV6     = 'MuthuwadigeERP-B02-Block-IPv6-All'
$DISPLAY_NAME_IPV4  = 'Muthuwadige ERP B02 Isolated Probe - Block External IPv4'
$DISPLAY_NAME_IPV6  = 'Muthuwadige ERP B02 Isolated Probe - Block All IPv6'
$IPV4_BLOCK_RANGES  = @('0.0.0.0-126.255.255.255', '128.0.0.0-255.255.255.255')
$IPV6_BLOCK_RANGE   = '::/0'
$EXPECTED_COUNT     = 2
$SCHEMA_VERSION     = '1.0.0'

# ---------------------------------------------------------------------------
# HELPER FUNCTIONS - Validation & System Checks
# ---------------------------------------------------------------------------

function Get-ProjectRoot {
    $scriptDir = $PSScriptRoot
    if ([string]::IsNullOrWhiteSpace($scriptDir)) {
        $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    }
    $resolved = (Resolve-Path (Join-Path $scriptDir '../..')).ProviderPath
    return $resolved
}

function Test-IsElevated {
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-FirewallServiceRunning {
    $svc = Get-Service -Name 'mpssvc' -ErrorAction SilentlyContinue
    return ($null -ne $svc -and $svc.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Running)
}

function Validate-ProgramPathInput([string]$Path, [string]$ProjectRoot) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "ProgramPath is required for action $Action."
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "ProgramPath does not exist or is not a regular file: $Path"
    }
    $resolved = (Resolve-Path -LiteralPath $Path).ProviderPath
    $fileName = [System.IO.Path]::GetFileName($resolved)
    if ($fileName -ne 'electron.exe') {
        throw "ProgramPath must point to 'electron.exe', found: '$fileName'"
    }

    # Verify path is inside project node_modules/electron/dist/electron.exe
    $expectedRelative = [System.IO.Path]::Combine($ProjectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
    if (-not (Test-Path -LiteralPath $expectedRelative -PathType Leaf)) {
        throw "Expected project Electron executable does not exist at: $expectedRelative"
    }
    $resolvedExpected = (Resolve-Path -LiteralPath $expectedRelative).ProviderPath
    if (-not [string]::Equals($resolved, $resolvedExpected, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "ProgramPath does not match the project's expected Electron binary.`nSupplied: $resolved`nExpected: $resolvedExpected"
    }

    return $resolved
}

function Validate-AttestationPathInput([string]$Path, [string]$ProjectRoot) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "AttestationPath is required for action $Action."
    }
    $dir = [System.IO.Path]::GetDirectoryName($Path)
    if ([string]::IsNullOrWhiteSpace($dir) -or -not (Test-Path -LiteralPath $dir -PathType Container)) {
        throw "AttestationPath directory does not exist or is not a container: $dir"
    }
    $resolvedDir = (Resolve-Path -LiteralPath $dir).ProviderPath
    # Immediate parent must be the canonical system temporary directory
    $parentDir = [System.IO.Path]::GetDirectoryName($resolvedDir)
    if ([string]::IsNullOrWhiteSpace($parentDir) -or -not (Test-Path -LiteralPath $parentDir -PathType Container)) {
        throw "AttestationPath parent directory is invalid: $parentDir"
    }
    $resolvedParent = (Resolve-Path -LiteralPath $parentDir).ProviderPath
    $tempBase = (Resolve-Path -LiteralPath ([System.IO.Path]::GetTempPath())).ProviderPath

    if (-not [string]::Equals($resolvedParent.TrimEnd('\'), $tempBase.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "AttestationPath directory must reside immediately beneath the system temporary directory ($tempBase): $resolvedDir"
    }

    # Directory name must conform to B01/B02 disposable root format: erp-b01-b02-*
    $dirName = [System.IO.Path]::GetFileName($resolvedDir)
    if ($dirName -notmatch '^erp-b01-b02-[a-zA-Z0-9_-]+$') {
        throw "AttestationPath directory name must match pattern 'erp-b01-b02-*', found: '$dirName'"
    }

    # Must NOT reside inside project root
    $normalizedProject = $ProjectRoot.TrimEnd('\')
    if ($resolvedDir.Equals($normalizedProject, [System.StringComparison]::OrdinalIgnoreCase) -or `
        $resolvedDir.StartsWith($normalizedProject + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "AttestationPath cannot reside within the project root: $resolvedDir"
    }

    # Explicitly reject real ERP application data target(s)
    $erpAppTargets = @()
    if (-not [string]::IsNullOrWhiteSpace($env:APPDATA)) {
        $erpAppTargets += [System.IO.Path]::Combine($env:APPDATA, 'Muthuwadige Hardware ERP')
    }
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $erpAppTargets += [System.IO.Path]::Combine($env:LOCALAPPDATA, 'Muthuwadige Hardware ERP')
    }
    $userProfile = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::UserProfile)
    if (-not [string]::IsNullOrWhiteSpace($userProfile)) {
        $erpAppTargets += [System.IO.Path]::Combine($userProfile, 'AppData', 'Roaming', 'Muthuwadige Hardware ERP')
        $erpAppTargets += [System.IO.Path]::Combine($userProfile, 'AppData', 'Local', 'Muthuwadige Hardware ERP')
    }
    foreach ($erpTarget in $erpAppTargets) {
        $normalizedTarget = [System.IO.Path]::GetFullPath($erpTarget).TrimEnd('\')
        if ($resolvedDir.Equals($normalizedTarget, [System.StringComparison]::OrdinalIgnoreCase) -or `
            $resolvedDir.StartsWith($normalizedTarget + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "AttestationPath cannot reside within the ERP application data directory: $resolvedDir"
        }
    }

    # File name must conform to expected pattern
    $fileName = [System.IO.Path]::GetFileName($Path)
    if ($fileName -notmatch '^firewall-[a-zA-Z0-9_-]+\.json$') {
        throw "AttestationPath filename must match 'firewall-*.json', found: '$fileName'"
    }

    return [System.IO.Path]::Combine($resolvedDir, $fileName)
}

function Write-AttestationFile([string]$TargetFile, [hashtable]$Data) {
    $json = $Data | ConvertTo-Json -Depth 6
    $tmpFile = $TargetFile + '.tmp'
    try {
        [System.IO.File]::WriteAllText($tmpFile, $json, [System.Text.Encoding]::UTF8)
        Move-Item -LiteralPath $tmpFile -Destination $TargetFile -Force
    } catch {
        if (Test-Path -LiteralPath $tmpFile) {
            Remove-Item -LiteralPath $tmpFile -Force -ErrorAction SilentlyContinue
        }
        throw "Failed to write atomic attestation file to $TargetFile : $_"
    }
}

function Get-B02Rules {
    return @(Get-NetFirewallRule -Group $RULE_GROUP -ErrorAction SilentlyContinue)
}

function Remove-B02RulesSafely {
    $rules = @(Get-B02Rules)
    if ($rules.Count -eq 0) {
        return @()
    }
    # Validate that every rule in the group matches known B02 rule names
    $removedNames = @()
    foreach ($rule in $rules) {
        if ($rule.Name -notin @($RULE_NAME_IPV4, $RULE_NAME_IPV6)) {
            throw "Unexpected rule '$($rule.Name)' found in group '$RULE_GROUP'. Refusing broad deletion."
        }
    }
    # Remove verified B02 rules by exact name
    foreach ($rule in $rules) {
        Remove-NetFirewallRule -Name $rule.Name -ErrorAction Stop
        $removedNames += $rule.Name
    }
    # Verify cleanup: exactly zero rules must remain
    $remaining = @(Get-B02Rules)
    if ($remaining.Count -ne 0) {
        throw "Stale rule cleanup could not be verified; $($remaining.Count) rules still present in group '$RULE_GROUP'."
    }
    return $removedNames
}

# ---------------------------------------------------------------------------
# MAIN ACTION DISPATCHER
# ---------------------------------------------------------------------------

$projectRoot = Get-ProjectRoot
$timestampIso = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

$attestation = [ordered]@{
    schemaVersion     = $SCHEMA_VERSION
    action            = $Action
    success           = $false
    timestamp         = $timestampIso
    programPath       = $null
    ruleGroup         = $RULE_GROUP
    isElevated        = (Test-IsElevated)
    serviceRunning    = (Test-FirewallServiceRunning)
    expectedRuleCount = $EXPECTED_COUNT
    observedRuleCount = 0
    rules             = @()
    cleanupVerified   = $false
    errors            = @()
}

$validatedProgram = $null
$validatedAttestation = $null

try {
    # -----------------------------------------------------------------------
    # ACTION: INSPECT (Read-Only)
    # -----------------------------------------------------------------------
    if ($Action -eq 'Inspect') {
        if (-not [string]::IsNullOrWhiteSpace($ProgramPath)) {
            $validatedProgram = Validate-ProgramPathInput -Path $ProgramPath -ProjectRoot $projectRoot
            $attestation.programPath = $validatedProgram
        }
        $existingRules = @(Get-B02Rules)
        $attestation.observedRuleCount = $existingRules.Count

        $inspectedRules = @()
        foreach ($r in $existingRules) {
            $addrFilter = Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $r -ErrorAction SilentlyContinue
            $appFilter  = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $r -ErrorAction SilentlyContinue
            $inspectedRules += [ordered]@{
                name            = $r.Name
                displayName     = $r.DisplayName
                direction       = $r.Direction.ToString()
                action          = $r.Action.ToString()
                enabled         = ($r.Enabled -eq [Microsoft.PowerShell.Cmdletization.GeneratedTypes.NetSecurity.Enabled]::True -or $r.Enabled -eq 'True')
                program         = if ($appFilter) { $appFilter.Program } else { $null }
                remoteAddresses = if ($addrFilter) { @($addrFilter.RemoteAddress) } else { @() }
            }
        }
        $attestation.rules = $inspectedRules
        $attestation.success = $true

        if (-not [string]::IsNullOrWhiteSpace($AttestationPath)) {
            $validatedAttestation = Validate-AttestationPathInput -Path $AttestationPath -ProjectRoot $projectRoot
            Write-AttestationFile -TargetFile $validatedAttestation -Data $attestation
        }

        $attestation | ConvertTo-Json -Depth 6
        exit 0
    }

    # -----------------------------------------------------------------------
    # ACTION: REMOVE
    # -----------------------------------------------------------------------
    if ($Action -eq 'Remove') {
        if (-not $attestation.isElevated) {
            throw "Administrator elevation is required to remove Windows Firewall rules."
        }
        if (-not $attestation.serviceRunning) {
            throw "Windows Defender Firewall service (mpssvc) is not running."
        }

        $removed = @(Remove-B02RulesSafely)
        $attestation.cleanupVerified = $true
        $attestation.observedRuleCount = 0
        $attestation.success = $true

        if (-not [string]::IsNullOrWhiteSpace($AttestationPath)) {
            $validatedAttestation = Validate-AttestationPathInput -Path $AttestationPath -ProjectRoot $projectRoot
            Write-AttestationFile -TargetFile $validatedAttestation -Data $attestation
        }

        $attestation | ConvertTo-Json -Depth 6
        exit 0
    }

    # -----------------------------------------------------------------------
    # ACTION: INSTALL
    # -----------------------------------------------------------------------
    if ($Action -eq 'Install') {
        # 1. Input validation
        $validatedProgram = Validate-ProgramPathInput -Path $ProgramPath -ProjectRoot $projectRoot
        $validatedAttestation = Validate-AttestationPathInput -Path $AttestationPath -ProjectRoot $projectRoot
        $attestation.programPath = $validatedProgram

        # 2. Elevation & service prerequisites
        if (-not $attestation.isElevated) {
            throw "Administrator elevation is required to install Windows Firewall rules."
        }
        if (-not $attestation.serviceRunning) {
            throw "Windows Defender Firewall service (mpssvc) is not running."
        }

        # 3. Pre-flight stale rule check and safe purge
        $initialRules = @(Get-B02Rules)
        if ($initialRules.Count -gt 0) {
            Write-Verbose "Stale B02 rules detected ($($initialRules.Count)). Purging before installation."
            [void](Remove-B02RulesSafely)
        }

        # 4. Create Rule A: IPv4 non-loopback block
        New-NetFirewallRule `
            -Name $RULE_NAME_IPV4 `
            -DisplayName $DISPLAY_NAME_IPV4 `
            -Group $RULE_GROUP `
            -Direction Outbound `
            -Action Block `
            -Enabled True `
            -Program $validatedProgram `
            -RemoteAddress $IPV4_BLOCK_RANGES `
            -Protocol Any `
            -InterfaceType Any `
            -Profile Any `
            -Description 'Muthuwadige ERP B02 isolated probe outbound IPv4 external block (excludes 127.0.0.0/8)' `
            -ErrorAction Stop | Out-Null

        # 5. Create Rule B: IPv6 all block
        New-NetFirewallRule `
            -Name $RULE_NAME_IPV6 `
            -DisplayName $DISPLAY_NAME_IPV6 `
            -Group $RULE_GROUP `
            -Direction Outbound `
            -Action Block `
            -Enabled True `
            -Program $validatedProgram `
            -RemoteAddress $IPV6_BLOCK_RANGE `
            -Protocol Any `
            -InterfaceType Any `
            -Profile Any `
            -Description 'Muthuwadige ERP B02 isolated probe outbound IPv6 all block' `
            -ErrorAction Stop | Out-Null

        # 6. Post-install query and strict verification
        $installedRules = @(Get-B02Rules)
        $attestation.observedRuleCount = $installedRules.Count

        if ($installedRules.Count -ne $EXPECTED_COUNT) {
            throw "Post-install verification failed: expected $EXPECTED_COUNT rules, observed $($installedRules.Count)."
        }

        $recordedRules = @()
        foreach ($expectedName in @($RULE_NAME_IPV4, $RULE_NAME_IPV6)) {
            $rule = $installedRules | Where-Object { $_.Name -eq $expectedName }
            if ($null -eq $rule) {
                throw "Post-install verification failed: rule '$expectedName' was not found in active WFP table."
            }
            if ($rule.Direction.ToString() -ne 'Outbound') {
                throw "Rule '$expectedName' has unexpected Direction: $($rule.Direction)"
            }
            if ($rule.Action.ToString() -ne 'Block') {
                throw "Rule '$expectedName' has unexpected Action: $($rule.Action)"
            }
            $isEnabled = ($rule.Enabled -eq [Microsoft.PowerShell.Cmdletization.GeneratedTypes.NetSecurity.Enabled]::True -or $rule.Enabled -eq 'True')
            if (-not $isEnabled) {
                throw "Rule '$expectedName' is not Enabled."
            }

            $appFilter = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule -ErrorAction Stop
            if (-not [string]::Equals($appFilter.Program, $validatedProgram, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Rule '$expectedName' Program filter mismatch.`nExpected: $validatedProgram`nObserved: $($appFilter.Program)"
            }

            $addrFilter = Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule -ErrorAction Stop
            $observedAddresses = @($addrFilter.RemoteAddress)

            if ($expectedName -eq $RULE_NAME_IPV4) {
                foreach ($expectedRange in $IPV4_BLOCK_RANGES) {
                    if ($observedAddresses -notcontains $expectedRange) {
                        throw "Rule '$expectedName' missing expected IPv4 address range: $expectedRange"
                    }
                }
            } elseif ($expectedName -eq $RULE_NAME_IPV6) {
                if ($observedAddresses -notcontains $IPV6_BLOCK_RANGE) {
                    throw "Rule '$expectedName' missing expected IPv6 address range: $IPV6_BLOCK_RANGE"
                }
            }

            $recordedRules += [ordered]@{
                name            = $rule.Name
                displayName     = $rule.DisplayName
                direction       = $rule.Direction.ToString()
                action          = $rule.Action.ToString()
                enabled         = $true
                program         = $appFilter.Program
                remoteAddresses = $observedAddresses
            }
        }

        $attestation.rules = $recordedRules
        $attestation.success = $true

        # Write atomic attestation file
        Write-AttestationFile -TargetFile $validatedAttestation -Data $attestation
        $attestation | ConvertTo-Json -Depth 6
        exit 0
    }

} catch {
    $attestation.success = $false
    $attestation.errors += $_.Exception.Message

    # Fail closed: If Install failed mid-way, attempt safe rollback
    if ($Action -eq 'Install' -and $attestation.isElevated) {
        try {
            Write-Warning "Installation failed. Attempting fail-closed rollback of B02 rules."
            [void](Remove-B02RulesSafely)
            $attestation.cleanupVerified = $true
        } catch {
            $attestation.cleanupVerified = $false
            $attestation.errors += "Rollback cleanup failed: $($_.Exception.Message)"
        }
    }

    # If attestation path was validated, attempt to record the failure attestation
    if ($null -ne $validatedAttestation) {
        try {
            Write-AttestationFile -TargetFile $validatedAttestation -Data $attestation
        } catch {
            # Best-effort file write during failure
        }
    }

    $attestation | ConvertTo-Json -Depth 6
    [Console]::Error.WriteLine("B02 Firewall Helper Error: $($_.Exception.Message)")
    exit 1
}
