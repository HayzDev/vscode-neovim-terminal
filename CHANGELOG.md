# Change history

## 0.1.1 — 2026-11-01

- Document installation, architecture, behavior, safety guarantees, limitations, and troubleshooting.
- Add Linux/macOS Bash and Windows PowerShell installers, including a prebuilt VSIX option.
- Add Windows named-pipe addresses for both shared and per-file sessions; reattach pipes without filesystem access checks.
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
