# Change history

## 0.1.10 — 2026-11-01

- Defer workspace restoration while native documents or restored tabs have unsaved changes, instead of opening a competing terminal and attempting to close them.
- Refresh stale clean Neovim buffers from disk without replacing newer native document contents or manufacturing dirty mirrors. Recheck live modified state before refreshing so newer edits survive.
- Check document dirtiness as well as tab dirtiness before closing a native editor after handoff.
- Add restoration, unloaded-dirty-tab, stale-snapshot, and live Neovim refresh regressions.

## 0.1.9 — 2026-11-01

- Correct Scratch/editor-like floating windows that map their content back to the main editor background. Align empty-line and default cursor-line surfaces with the popup while retaining plugin-specific title and selection mappings.
- Reapply floating surface mappings when plugins change window highlights after creation.

## 0.1.8 — 2026-11-01

- Check native document save results before acknowledging a saved Neovim mirror. Preserve a recovery copy on rejected/failed saves instead of falsely treating a conflict as saved.
- Retain dirty state if new native edits arrive while a save completes.

## 0.1.7 — 2026-11-01

- Reassert the VS Code workspace directory after Neovim startup or backend reattachment, preserving existing buffers.
- Resolve Ctrl+P's root from the edited file's VS Code workspace and validate/reassert it before opening a picker, preventing directory drift from searching the home folder.
- Add backend-reattachment and picker cwd regression checks.

## 0.1.6 — 2026-11-01

- Route terminal Ctrl+P / Cmd+P directly to an installed Neovim file picker, bypassing native editor creation and redirection. Prefer Snacks, fall back to Telescope, then native Quick Open when neither picker is installed.
- Add picker routing regressions and a local real-Snacks file-selection check.

## 0.1.5 — 2026-11-01

- Document the required `${sequence}` terminal-tab title template; `${process}` displays only `nvim` even when the TUI sends the correct filename.
- Run AutoHotkey files directly as VS Code process tasks with the configured interpreter, saved script path, and error output, avoiding a temporary native editor pane on Ctrl+F5.

## 0.1.4 — 2026-11-01

- Let the Neovim TUI update its own terminal title instead of pinning a static name or renaming the active VS Code terminal. Titles follow the edited filename and unsaved marker while ignoring temporary picker buffers.
- Switch file and cursor in one RPC, preserve unsaved buffers, reveal the terminal before closing the native editor tab, and keep optional theme/Telescope initialization off the opening path.
- Avoid redundant file checks for already displayed saved documents and discard superseded open requests during rapid navigation.
- Add real Neovim title/navigation regressions and an isolated native VS Code navigation test runner.

## 0.1.3 — 2026-11-01

- Keep reference column colors on the selected row: Telescope's selection is now background-only, and column colors meet contrast on both the selected and plain rows.
- Show reference folders as workspace- or `~`-relative paths trimmed from the left by whole segments instead of single-letter abbreviations; omit the folder column on narrow lists.
- Resolve reference column widths per picker size instead of caching the first picker's widths.
- Size the references window to the result count, drop the column-legend title, and shorten the preview title.
- Extend the real-Telescope check with selected-row highlight, folder, title, and compact-height assertions at three widths.

## 0.1.2 — 2026-11-01

- Replace stale shared terminal UI attachments so a hidden small view cannot constrain the active screen; retain the backend and unsaved buffers.
- Improve theme-aware popup surfaces, borders, titles, selections, and floating preview gutters while preserving the main editor gutter.
- Add optional Telescope LSP references formatting: colored filename/location/folder columns, trimmed code snippets, top-aligned results, and an adaptive side/bottom preview. Preserve complete search paths, navigation targets, and user picker overrides.
- Add real Neovim regression checks for UI replacement, gutter colors, and reference formatting, plus a local real-Telescope layout/navigation check.

## 0.1.1 — 2026-11-01

- Document installation, architecture, behavior, safety guarantees, limitations, and troubleshooting.
- Add Linux/macOS Bash and Windows PowerShell installers, including a prebuilt VSIX option.
- Add Windows named-pipe addresses for both shared and per-file sessions; reattach pipes without filesystem access checks.
- Normalize reported paths to VS Code URIs and support both stable and nightly modified-state events.
- Add installer/transport tests and a three-platform unit/RPC/packaging workflow.
- Publish source and packaged VSIX in the GitHub repository; retain the extension ID `xander-local.neovim-terminal` so existing installations upgrade normally.

## 0.1.0 — 2026-10-30

- One detached Neovim backend per workspace folder and a terminal remote UI; per-file mode remains available.
- Native VS Code dirty-document mirrors with bidirectional edits, saving, formatter results, and line-ending preservation.
- File, cursor, and unsaved-text snapshots; reattach surviving backends or restore after a crash.
- Preserve external disk changes by restoring conflicting text to a separate recovery file.
- Snapshot unnamed drafts, excluding plugin/help/terminal buffers.
- LSP mouse hover documentation after 400 ms and a cursor-based hover command.
- Carry VS Code navigation positions into Neovim and update terminal titles as buffers change.
- Add Restore Session and Close Safely commands, including Save All / Keep in Background / Cancel.
- Reject RPC calls after disconnection so pending operations do not hang indefinitely.

## 0.0.1–0.0.6 — 2026-10-29

- Create terminal-hosted real Neovim integration and install local VSIX builds in VS Code Insiders.
- Redirect clean file editors, reuse sessions, preserve unsaved/diff editors, and keep source tabs on failed startup.
- Follow VS Code theme changes dynamically, including JSONC, inherited themes, and user customizations.
- Synchronize common syntax/UI groups and lualine without replacing the user's sections.
- Route Shift+Left/Right to Home/End and Shift+Up/Down to existing visual syntax-node mappings.
- Save and run the current Neovim file with Ctrl+F5 through VS Code's Python or normal launch workflow.
- Report the current file in the status bar and through a command variable.
- Improve Flash hint contrast; distinguish the selected hint with magenta, keep hint backgrounds opaque, and make search-match backgrounds transparent.

Dates describe development in this workspace, rather than Marketplace publication. The extension has not been published to the VS Code Marketplace.
