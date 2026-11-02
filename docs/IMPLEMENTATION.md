# Implementation and validation record

## Scope and design

This is a terminal integration, distinct from the `vscode-neovim` extension that uses native VS Code text editors. It runs the user's actual Neovim config. It does not edit standalone Neovim configuration, install language servers, or bundle Xander's personal dotfiles.

VS Code's public terminal API provides dimensions in rows/columns, not arbitrary pixel geometry for terminal text. Hover therefore uses Neovim's mouse coordinates and floating windows, rather than a VS Code overlay. It requests hover from an attached Neovim LSP client; it does not bridge VS Code language servers into Neovim.

## Files and responsibilities

| File | Responsibility |
| --- | --- |
| `extension.js` | Activation, trusted-workspace checks, file redirection, selection conversion, session maps, terminal lifecycle, commands, status, titles, dynamic theme updates |
| `backend.js` | Reattach stored backend or start detached headless Neovim; private temporary logs and persisted backend metadata |
| `transport.js` | Unix socket or unique Windows named-pipe address |
| `rpc.js` | MsgPack-RPC connection, readiness deadline, cancellation, disconnect rejection, orderly reader shutdown |
| `documents.js` | Native text-document mirrors, edit/save synchronization, durable snapshots, recovery conflicts, unnamed drafts |
| `run.js` | Validate and save the current Neovim file before running |
| `close.js` | Save-aware closing without forced writes |
| `theme.js`, `lua/theme.lua` | Read theme JSONC/includes/customizations; map common syntax/UI groups; contrast and Flash styling |
| `lua/current-file.lua` | Report current buffer/cursor; attach buffer-change tracking; collect regular-buffer snapshots |
| `lua/hover.lua` | Debounced mouse hover, byte/encoding conversion, LSP request, nonfocusable Markdown float |
| `lua/keymaps.lua` | Managed-session Shift-arrow mappings using existing syntax-node selection mappings |
| `scripts/install.*` | Build or use a VSIX and install via VS Code's CLI without editing user preferences |
| `test/` | Unit tests, real Neovim RPC checks, isolated VS Code integration suites |

## Session lifecycle

By default, workspace-folder path keys the session. A detached `nvim -n --headless --listen ADDRESS -- FILE` loads the usual config. A terminal runs `nvim --server ADDRESS --remote-ui`. File navigation loads buffers into that server instead of starting another plugin/LSP stack. Closing the frontend leaves the server alive. Multiple independent remote UIs are avoided because they share Neovim's screen state.

With `sharedProcess: false`, each file gets a terminal process with `-n --listen`. Source text tabs close only after startup succeeds and only while clean. Diff and unmanaged unsaved editors are excluded. Native UTF-16 selection columns convert to Neovim byte columns.

The backend and snapshots can outlive the VS Code process. Extension deactivation flushes snapshots and disconnects RPC; it does not kill shared backends. `:qa` exits normally, with Neovim's unsaved-change checks.

## Saving and data protection

Neovim reports full regular-buffer snapshots, coalescing change events. VS Code uses real text documents and workspace edits so native dirty protection, autosave, and formatter preferences apply. Pending native text guards prevent older snapshots overwriting later edits. Save synchronization refreshes Neovim disk timestamps with `checktime` so its next write does not stop at a spurious external-change prompt.

Line endings, final-newline state, truly empty files, and cursor byte columns are retained. Unnamed modified buffers get associated untitled mirrors and private snapshot paths. On cold recovery these may become named storage buffers; use `:saveas`.

Session state is a real `session.json` file in workspace storage (global storage fallback), rather than VS Code's memento state. Writes serialize, write a fresh temporary file, fsync it, and rename atomically. Unix directories/files use modes 0700/0600. Windows relies on the current user's inherited storage ACLs; it does not enforce Unix permission bits or encrypt snapshots. Snapshots contain unsaved source text and absolute file paths and must not be committed or shared.

Snapshots store the base disk hash. If disk contents changed, restored text goes into a separate recovery file, preserving the original. Managed processes disable swap files with `-n` to prevent stale E325 prompts after cold recovery; standalone instances retain their swap behavior.

## UI and execution details

- Theme sync runs at connection and when the active theme or relevant customizations change; existing sessions update.
- Colors approximate common Neovim groups. TextMate stacks, semantic modifiers, XML themes, and arbitrary plugin groups are not fully translated.
- Search text is foreground-only with at least 4.5:1 contrast. Flash hint chips keep opaque backgrounds and distinct yellow/magenta targets, with measured text/background contrast.
- Hover waits 400 ms, uses the first attached client supporting hover, and cancels stale responses. It closes on editing, movement, scrolling, or leaving the buffer.
- Ctrl+F5 saves, flushes mirrors, and calls Python's dedicated-terminal command with the actual file URI. Other languages use a temporary clean preview and VS Code's normal Run Without Debugging command. Existing launch configurations still determine execution.
- Dynamic titles use VS Code's terminal rename command; OSC titles alone did not reliably update its tab labels.

## Validation completed locally

Before 0.1.0 installation, 11 tests passed, as did the Linux Insiders integration suites with the user's full Neovim config. The feature suite launched three separate VS Code processes and verified shared buffers, bidirectional saves, formatter output, CRLF, Unicode navigation, dynamic titles, actual terminal mouse reporting into a deterministic LSP hover server, reattachment to the same backend PID, and cold recovery after killing an isolated backend. Named and unnamed unsaved text and cursors survived.

0.1.1 adds transport-address and installer argument/error checks, including both prebuilt and source-install PowerShell paths. The Linux suite passes 13 tests with the Windows-only check skipped; GitHub-hosted Linux, macOS, and Windows runners have also passed the unit/RPC checks. The full-config Linux regression and three-launch restart/crash suites passed again after the portability fixes. Current CI status is available in [GitHub Actions](https://github.com/HayzDev/vscode-neovim-terminal/actions); a configured workflow is not itself evidence that a platform passed. macOS/Windows physical keyboard, terminal UI, permissions, and restart/crash flows still need native VS Code validation, beyond the headless CI checks. Full-buffer performance and simultaneous windows for the same workspace have not been stress-tested.

## Local integration adjustments made during development

On Xander's machine, Insiders was configured with the absolute Neovim executable, `neovimTerminal.run` was appended to `terminal.integrated.commandsToSkipShell`, and the existing global Ctrl+F5 Python binding was scoped away from managed Neovim terminals. Those are machine-specific preferences; installers preserve them and do not overwrite settings/keybindings. Ordinary question prompts in chat replaced unusable interactive question-widget controls in tmux/Kitty; no Codex keybindings were changed.

Personal Neovim changes are documented separately in [HayzDev/dotfiles](https://github.com/HayzDev/dotfiles), under `.config/nvim/README.md`.

## Reference documentation

- [Neovim remote UI and server addresses](https://neovim.io/doc/user/remote/)
- [Neovim channels and RPC](https://neovim.io/doc/user/channel/)
- [VS Code command-line installation](https://code.visualstudio.com/docs/configure/command-line)
