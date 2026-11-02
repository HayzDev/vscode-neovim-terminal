#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
code_cli=""
vsix=""
while (($#)); do
  case "$1" in
    --code|--vsix) (($# >= 2)) || { echo "Missing value for $1" >&2; exit 1; }; if [[ $1 == --code ]]; then code_cli=$2; else vsix=$2; fi; shift 2 ;;
    -h|--help) echo 'Usage: bash scripts/install.sh [--code code-insiders|code|/path/to/code] [--vsix /path/to/extension.vsix]'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
if [[ -z $code_cli ]]; then
  for candidate in code-insiders code; do
    if command -v "$candidate" >/dev/null 2>&1; then code_cli=$candidate; break; fi
  done
fi
[[ -n $code_cli ]] && command -v "$code_cli" >/dev/null 2>&1 || { echo 'Install VS Code and put code or code-insiders on PATH (or pass --code).' >&2; exit 1; }
command -v nvim >/dev/null 2>&1 || { echo 'Install Neovim 0.12+ and put nvim on PATH first.' >&2; exit 1; }
nvim_version="$(nvim --version)"
[[ $nvim_version =~ NVIM\ v([0-9]+)\.([0-9]+) ]] && ((BASH_REMATCH[1] > 0 || BASH_REMATCH[2] >= 12)) || { echo 'Neovim 0.12+ is required.' >&2; exit 1; }
if [[ -z $vsix ]]; then
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || { echo 'Building requires Node.js 22+ and npm. Alternatively pass --vsix.' >&2; exit 1; }
  node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || { echo 'Node.js 22+ is required for packaging.' >&2; exit 1; }
  cd "$root"
  npm ci
  npm run package
  version="$(node -p 'require("./package.json").version')"
  vsix="$root/neovim-terminal-$version.vsix"
fi
[[ -f $vsix ]] || { echo "VSIX not found: $vsix" >&2; exit 1; }
"$code_cli" --install-extension "$vsix" --force
echo 'Installed. Save existing work, then run Developer: Reload Window in VS Code.'
echo 'If GUI VS Code cannot find nvim, set neovimTerminal.executable to its full path.'
