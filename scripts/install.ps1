[CmdletBinding()]
param(
    [string]$Code = '',
    [string]$Vsix = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Code) {
    foreach ($candidate in @('code-insiders', 'code')) {
        if (Get-Command $candidate -ErrorAction SilentlyContinue) { $Code = $candidate; break }
    }
}
if (-not $Code -or -not (Get-Command $Code -ErrorAction SilentlyContinue)) {
    throw 'Install VS Code and put code or code-insiders on PATH (or pass -Code).'
}
if (-not (Get-Command nvim -ErrorAction SilentlyContinue)) {
    throw 'Install Neovim 0.12+ and put nvim on PATH first.'
}
$versionText = (& nvim --version | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or $versionText -notmatch 'NVIM v(\d+)\.(\d+)' -or ([int]$Matches[1] -eq 0 -and [int]$Matches[2] -lt 12)) {
    throw 'Neovim 0.12+ is required.'
}
if (-not $Vsix) {
    if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw 'Building requires Node.js 22+ and npm. Alternatively pass -Vsix.'
    }
    & node -e 'if (Number(process.versions.node.split(String.fromCharCode(46))[0]) < 22) process.exit(1)'
    if ($LASTEXITCODE -ne 0) { throw 'Node.js 22+ is required for packaging.' }
    Push-Location $root
    try {
        & npm ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
        & npm run package
        if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
        $version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
        $Vsix = Join-Path $root "neovim-terminal-$version.vsix"
    } finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath $Vsix -PathType Leaf)) { throw "VSIX not found: $Vsix" }
& $Code --install-extension $Vsix --force
if ($LASTEXITCODE -ne 0) { throw 'VS Code extension installation failed.' }
Write-Host 'Installed. Save existing work, then run Developer: Reload Window in VS Code.'
Write-Host 'If GUI VS Code cannot find nvim, set neovimTerminal.executable to its full path.'
