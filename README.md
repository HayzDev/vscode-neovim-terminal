# Neovim Terminal

Edit files in real Neovim terminals inside VS Code, using your normal Neovim config and the active VS Code theme.

## Install and use

Requires VS Code 1.100+, Neovim 0.12+ on PATH, and a trusted local workspace. Install VS Code and Neovim first; the scripts do not change your Neovim config or install system packages. Building also requires Git, Node.js 22+, and npm.

Clone this repository (authenticate with GitHub first if it is private):

```sh
git clone https://github.com/HayzDev/vscode-neovim-terminal.git
cd vscode-neovim-terminal
```

**Linux / macOS:**

```sh
bash scripts/install.sh
# Choose Stable instead of the default preference for Insiders:
bash scripts/install.sh --code code
```

**Windows PowerShell:**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
# Choose Stable:
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Code code
```

The scripts run `npm ci`, package a VSIX, and install it using the selected VS Code CLI. `ExecutionPolicy Bypass` applies only to that PowerShell process. If you already downloaded a release VSIX, skip Node/npm and building with `--vsix /path/to/file.vsix` or `-Vsix C:\path\file.vsix`. Paths with spaces are supported. To choose a CLI outside PATH, pass its full path via `--code` or `-Code`. On macOS, run **Shell Command: Install 'code' command in PATH** in VS Code first if needed.

Download a prebuilt VSIX from [Releases](https://github.com/HayzDev/vscode-neovim-terminal/releases/latest) while signed into an account with repository access. With GitHub CLI, use `gh release download --repo HayzDev/vscode-neovim-terminal --pattern '*.vsix'`.

Alternatively use **Extensions: Install from VSIX…**. Save existing work, then run **Developer: Reload Window** after an update. Open a saved file to check that Neovim starts. If GUI VS Code cannot find it, set `neovimTerminal.executable` to the absolute Neovim executable path. You can update by pulling the repository and rerunning the installer.

Platform status: Linux has passed the real VS Code Insiders integration suites. macOS uses Unix sockets and Windows uses local named pipes; native end-to-end validation is still pending. GitHub-hosted unit/RPC checks pass on all three platforms; the workflow also packages VSIX builds. Native macOS/Windows VS Code terminal/recovery flows still need testing. Windows filesystem permissions use inherited ACLs, rather than Unix owner-only mode bits.

Opening a saved file redirects it to Neovim. Explorer opens, search results, diagnostics, and definition links carry their file/line/column through the normal editor-opening path. Diff editors and unrelated unsaved VS Code edits stay in VS Code. **Neovim Terminal: Open File** is also available in the command palette and file context menus.

The default is **one shared Neovim backend per workspace folder**, with a lightweight terminal frontend. Files share buffers, plugins, registers, and language servers. Use normal Neovim buffer navigation (`:ls`, `:buffer`, `:bnext`). The terminal tab follows the current filename and shows `*` for unsaved changes. Multiple independent terminal views of one backend are deliberately avoided because Neovim remote UIs share a screen.

## References and popup readability

When Telescope is installed, `lsp_references` (including a user mapping such as `gR`) shows separate colored filename, line/column, abbreviated folder, and trimmed code columns. Complete paths remain searchable and navigation/quickfix targets retain their original locations. The prompt and results start at the top; narrower windows place the preview below the list. Existing per-picker options take precedence. The extension does not install Telescope or replace keybindings. Set `neovimTerminal.improveReferences` to `false` before starting a new Neovim backend to opt out.

Floating popups use theme colors with visible borders and a subtle surface tint. Preview sign/fold gutters match that surface while the main editor gutter keeps its theme color.

## Hover documentation

Pause the mouse over code for 400 ms to request documentation from the buffer's Neovim language server. It appears in a floating Markdown window without moving the editing cursor. Moving away, editing, or scrolling dismisses it. A language server supporting hover must be attached. `:NeovimTerminalHover` shows the same documentation at the cursor if mouse reporting is unavailable.

## Saving, closing, and recovery

Edits to regular file buffers are mirrored into real VS Code text documents. Dirty indicators, Save/Save All, normal close protection, and hot-exit handling can therefore see them. Native edits and formatter results synchronize back to Neovim. Your VS Code autosave/format-on-save preferences still apply to these documents. Mirrored dirty editor tabs may remain open to provide native protection.

**Neovim Terminal: Close Safely** offers Save All, Keep in Background, or Cancel when there are unsaved buffers. It does not force writes. The ordinary terminal close button uses VS Code's terminal confirmation; closing the shared frontend leaves the backend and its edits alive. `:qa` exits the backend through Neovim's normal unsaved-change checks. Background backends can continue using memory and running language servers after the UI closes.

Files and cursor positions restore when the workspace reopens. A surviving backend is reattached. After a backend crash or OS restart, private snapshots restore unsaved text. Snapshots are atomically written with owner-only permissions to `session.json` in this extension's workspace storage. If disk content changed since a snapshot, recovery creates a separate file under the extension's global-storage `recovered` directory and leaves the original unchanged.

Unnamed drafts also receive snapshots and native untitled mirrors. After a cold restart they may appear as named recovery buffers inside private extension storage; use `:saveas /your/intended/path` to give them their final filename. Plugin, help, and terminal buffers are not mirrored. Managed instances use `-n` to avoid stale swap-file prompts; the private snapshots provide their recovery mechanism. Standalone Neovim keeps its normal swap settings.

Snapshots currently copy full buffers. Very large files and simultaneous VS Code windows editing the same workspace have not been stress-tested. Recovery is a safety net, not a replacement for saving or version control.

## Running code

**Ctrl+F5** saves and runs the current Neovim file through VS Code. Python uses **Python: Run File in Dedicated Terminal**, including its selected interpreter. Other languages temporarily open the file in a VS Code preview and invoke **Run Without Debugging** with the normal launch configuration. The temporary preview is then cleaned up.

The status bar shows the current file and its full path on hover; clicking it also saves and runs. `neovimTerminal.currentFile` returns the active file path for command-variable integrations. Unnamed/plugin buffers, failed writes, and conflicting unmanaged VS Code edits stop the run.

For shortcut routing, add `neovimTerminal.run` to the existing `terminal.integrated.commandsToSkipShell` list. Scope any existing global Ctrl+F5 binding with `!terminalFocus || !neovimTerminal.active`. An existing user keybinding can override the extension default; the installer preserves your settings and keybindings. For example:

```jsonc
// settings.json: append to your existing array
"terminal.integrated.commandsToSkipShell": ["neovimTerminal.run"]

// keybindings.json: add this when an existing Ctrl+F5 binding wins
{ "key": "ctrl+f5", "command": "neovimTerminal.run",
  "when": "terminalFocus && neovimTerminal.active" }
```

## Shift-arrow shortcuts

These apply only in managed Neovim terminals:

- **Shift+Left** → Home; **Shift+Right** → End.
- **Shift+Up** → visual Shift+Tab; **Shift+Down** → visual Tab.

Up/down reuse your existing syntax-node mappings. From normal mode they enter visual selection first. Left/right also work in insert, visual, operator-pending, and command-line modes. No Neovim window-management keys are overridden.

## Theme synchronization

Theme changes and color/token customizations update open Neovim sessions automatically. JSON/JSONC themes and inherited themes are supported. Common syntax groups, selections, line numbers, diagnostics, completion menus, floating windows, and lualine's palette follow VS Code. Existing lualine sections are preserved.

Flash hint chips remain opaque: ordinary hints use theme yellow and the targeted hint uses theme magenta. Hint text has at least 4.5:1 contrast against its chip, and chips have at least 3:1 contrast against the editor. Search matches have no background and at least 4.5:1 text contrast. Syntax classifications differ between the editors, so language-specific TextMate stacks, modifier-specific semantic rules, plugin-specific colors, and legacy XML `.tmTheme` files are not fully translated. Alpha colors are blended to RGB.

## Settings

```json
{
  "neovimTerminal.autoOpen": true,
  "neovimTerminal.sharedProcess": true,
  "neovimTerminal.restoreSession": true,
  "neovimTerminal.executable": "nvim"
}
```

Set `sharedProcess` to `false` to retain separate per-file processes. Set `restoreSession` to `false` to disable automatic restoration; snapshots remain available. `executable` is a user/machine setting accepting a path, not shell arguments. The default searches PATH for `nvim`.

Tested locally on Linux with VS Code Insiders and Neovim 0.12.2. The extension runs on the workspace host; Remote SSH, WSL, and containers require Neovim on that host and are not covered by the integration tests. Your standalone Neovim configuration is not modified. See [implementation notes](docs/IMPLEMENTATION.md), [the change history](CHANGELOG.md), and [troubleshooting](docs/TROUBLESHOOTING.md).

## Development

```sh
npm ci
npm test
xvfb-run -a npm run test:integration
NVIM_TEST_FEATURES=1 xvfb-run -a npm run test:integration
npm run package
```

The integration runner uses installed Linux VS Code Insiders and temporary profiles. The default suite checks legacy per-file behavior and existing shortcuts/theme/run features. `NVIM_TEST_FEATURES=1` runs three launches to verify shared buffers, mirroring, formatting, titles, navigation, mouse hover, reconnect, and recovery after a backend crash. Set `NVIM_TEST_FULL_CONFIG=1` to use your normal Neovim config instead of `--clean`. Set `NVIM_TEST_PYTHON_EXTENSION` to an installed Python extension directory to exercise that actual runner.
