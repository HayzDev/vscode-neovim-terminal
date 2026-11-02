# Troubleshooting

- **`code` not found:** On macOS enable the CLI in the command palette. On any platform add its `bin` directory to PATH or pass `--code` / `-Code` with the CLI path. Installers prefer Insiders if both versions are on PATH.
- **`nvim` not found in GUI VS Code:** Set `neovimTerminal.executable` to the full executable path. It accepts an executable, not shell arguments. Restart/reload after installing prerequisites so VS Code inherits PATH.
- **Build fails:** Use Node.js 22+ and `npm ci`. A prebuilt VSIX can be installed without Node/npm. Corporate proxies may require npm configuration; scripts do not alter it.
- **File stays in a native editor:** Check workspace trust, `neovimTerminal.autoOpen`, and whether it is dirty, untitled, or part of a diff. Try the explicit Open File command. Read **Output → Neovim Terminal** for errors.
- **No mouse documentation:** Attach a Neovim language server supporting hover. Try `:NeovimTerminalHover`; lack of a response can be a server capability issue. Hover is not supplied by VS Code's Python extension.
- **Ctrl+F5 runs the wrong file or never reaches the extension:** Focus the managed terminal, inspect Keyboard Shortcuts for conflicting user bindings, and use the README's scoped binding. Include `neovimTerminal.run` in `terminal.integrated.commandsToSkipShell`. Python needs Microsoft's Python extension; other languages need a working VS Code launch configuration.
- **Node selection does not move:** Shift+Up/Down reuse your visual Shift+Tab/Tab mappings. A clean Neovim config has no syntax-node navigation to reuse. These mappings belong to your Neovim configuration.
- **Edits appear in native tabs or autosave:** That is the dirty-document mirror. Your existing VS Code autosave and format-on-save preferences apply.
- **Backend remains after a terminal closes:** Expected in shared mode. Reopen a file to reattach, use Close Safely for explicit save handling, or `:qa` to exit through Neovim's normal checks.
- **Recovery file has a private storage path:** Disk contents changed, or the draft had no name. Review it and use `:saveas` to keep it. The extension does not overwrite a changed original during recovery.
- **Theme looks approximate:** Common groups are mapped, but arbitrary plugin groups and language-specific semantic classifications may differ. Test with your theme and report its name and the affected highlight group.

Before reporting a problem, record OS, VS Code and Neovim versions, shared/per-file mode, relevant Output entries, and whether it reproduces with a minimal Neovim config. Remove secrets and source text from logs before sharing. Do not upload `session.json`: it can contain unsaved files.
