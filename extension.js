const vscode = require('vscode');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { connect } = require('./rpc');
const { socketPath } = require('./transport');
const { loadPalette } = require('./theme');
const { saveCurrentFile } = require('./run');
const { backend } = require('./backend');
const { Documents } = require('./documents');
const { closeSession } = require('./close');
let activeDocuments;

async function activate(context) {
  const sessions = new Map();
  const terminals = new Map();
  let preparingRun = false;
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'neovimTerminal.run';
  context.subscriptions.push(status);
  const updateTerminalContext = () => {
    const session = terminals.get(vscode.window.activeTerminal);
    void vscode.commands.executeCommand('setContext', 'neovimTerminal.active', Boolean(session));
    const file = session?.file;
    if (file?.buftype === '') {
      const filename = file.path ? path.basename(file.path) : '[No Name]';
      status.text = `$(edit) ${filename}${file.modified ? ' *' : ''}`;
      status.tooltip = `Neovim: ${file.path}\nCtrl+F5: save and run in VS Code`;
      status.show();
      const title = `nvim: ${filename}${file.modified ? ' *' : ''}`;
      if (session.terminal && !session.closed && session.title !== title) {
        session.title = title;
        void vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name: title });
      }
    } else status.hide();
  };
  const output = vscode.window.createOutputChannel('Neovim Terminal');
  context.subscriptions.push(output);
  const documents = new Documents(vscode, context, error => report(error));
  activeDocuments = documents;
  await documents.load();
  const hoverScript = fs.readFile(path.join(context.extensionPath, 'lua/hover.lua'), 'utf8');
  const fileScript = fs.readFile(path.join(context.extensionPath, 'lua/current-file.lua'), 'utf8');
  const singleUiScript = fs.readFile(path.join(context.extensionPath, 'lua/single-ui.lua'), 'utf8');
  const referencesScript = fs.readFile(path.join(context.extensionPath, 'lua/references.lua'), 'utf8');
  const keymapsScript = fs.readFile(path.join(context.extensionPath, 'lua/keymaps.lua'), 'utf8');
  const themeScript = fs.readFile(path.join(context.extensionPath, 'lua/theme.lua'), 'utf8');
  let themeQueue = Promise.resolve();
  async function applyTheme(client) {
    await client.request('nvim_exec_lua', [await themeScript, [await loadPalette(vscode)]]);
  }
  const syncThemes = () => {
    themeQueue = themeQueue.then(async () => {
      const results = await Promise.allSettled([...sessions.values()].map(async pending => {
        const session = await pending;
        if (!session.disposed) await applyTheme(session.client);
      }));
      for (const result of results) if (result.status === 'rejected') output.appendLine(`Theme sync: ${result.reason}`);
    }).catch(error => output.appendLine(`Theme sync: ${error}`));
  };
  const config = uri => vscode.workspace.getConfiguration('neovimTerminal', uri);
  const report = error => {
    output.appendLine(error.stack || String(error));
    console.warn('Neovim Terminal:', error.message || String(error));
    void vscode.window.showErrorMessage(`Neovim Terminal: ${error.message}`);
  };

  function showTerminal(session, viewColumn) {
    if (!session.closed && session.terminal) { session.terminal.show(); return; }
    const terminal = vscode.window.createTerminal({
      name: `nvim: ${path.basename(session.file?.path || session.uri.fsPath)}`,
      shellPath: config(session.uri).get('executable', 'nvim'),
      shellArgs: session.shared ? ['--server', session.socket, '--remote-ui']
        : ['-n', '--listen', session.socket, '--', session.uri.fsPath],
      cwd: session.cwd,
      location: { viewColumn: viewColumn || vscode.ViewColumn.Active },
      isTransient: true,
    });
    session.terminal = terminal;
    session.closed = false;
    terminals.set(terminal, session);
    terminal.show();
    updateTerminalContext();
    const listener = vscode.window.onDidCloseTerminal(item => {
      if (item !== terminal) return;
      listener.dispose();
      terminals.delete(terminal);
      session.closed = true;
      void documents.flush().catch(report);
      updateTerminalContext();
      if (!session.shared) {
        sessions.delete(session.key);
        session.disposed = true;
        session.controller.abort();
        session.connection?.dispose();
        void fs.rm(session.directory, { recursive: true, force: true }).catch(report);
      }
    });
    context.subscriptions.push(listener);
  }

  async function start(uri, viewColumn, key, shared, cwd) {
    const session = { uri, key, shared, cwd, closed: true, controller: new AbortController() };
    let reused = false;
    try {
      if (shared) {
        const result = await backend(config(uri).get('executable', 'nvim'), uri, cwd, documents);
        session.directory = result.directory;
        session.socket = result.socket;
        session.connection = result.connection;
        session.backendPid = result.pid;
        reused = result.reused;
      } else {
        session.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-nvim-'));
        await fs.chmod(session.directory, 0o700);
        session.socket = socketPath(session.directory);
        showTerminal(session, viewColumn);
        session.connection = await connect(session.socket, session.controller.signal);
      }
      session.client = session.connection.client;
      if (shared) await session.client.request('nvim_exec_lua', [await singleUiScript, []]);
      session.client.on('disconnect', () => {
        session.disposed = true;
        sessions.delete(session.key);
        terminals.delete(session.terminal);
        updateTerminalContext();
      });
      if (shared && !reused) {
        await documents.restore(session);
        session.restoredTarget = documents.state.active[cwd]?.path;
      }
      if (!shared && documents.state.buffers[uri.fsPath]?.modified) await documents.restore(session, uri.fsPath);
      session.client.on('notification', (method, args) => {
        if (method === 'neovim_terminal.file') {
          session.file = args[0];
          if (session.file.path) session.file.path = vscode.Uri.file(session.file.path).fsPath;
          if (session.file.buftype === '') {
            const tracked = [...documents.records.entries()].find(([, record]) => record.session === session && record.buf === session.file.buf)?.[0];
            const filename = session.file.path || tracked;
            if (filename) {
              documents.state.active[cwd] = { path: filename, cursor: session.file.cursor };
              const entry = documents.state.buffers[filename];
              if (entry) entry.cursor = session.file.cursor;
            }
          }
          updateTerminalContext();
        }
        if (method === 'neovim_terminal.buffer') void documents.receive(session, args[0]).catch(report);
      });
      await session.client.request('nvim_exec_lua', [await fileScript, [await session.client.channelId]]);
      await session.client.request('nvim_exec_lua', [await keymapsScript, []]);
      await session.client.request('nvim_exec_lua', [await hoverScript, []]);
      await applyTheme(session.client).catch(error => output.appendLine(`Theme sync: ${error.message}`));
      await session.client.request('nvim_exec_lua', [await referencesScript, [config(uri).get('improveReferences', true)]])
        .catch(error => output.appendLine(`Telescope references: ${error.message}`));
      if (shared) showTerminal(session, viewColumn);
      context.subscriptions.push({ dispose: () => {
        session.disposed = true;
        session.controller.abort();
        session.connection.dispose();
      } });
      output.appendLine(`Connected: ${uri.fsPath}${shared ? ' (shared workspace backend)' : ''}`);
      return session;
    } catch (error) {
      session.controller.abort();
      session.connection?.dispose();
      throw error;
    }
  }

  async function open(uri, editor, restoring = false, restoreCwd) {
    if (!vscode.workspace.isTrusted) return;
    if (!uri || uri.scheme !== 'file') {
      throw new Error('Choose a saved file to open in Neovim.');
    }
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (!(stat.type & vscode.FileType.File)) throw new Error('Choose a file, not a folder.');
    } catch (error) {
      if (!(restoring && documents.state.buffers[uri.fsPath]?.modified && error.code === 'FileNotFound')) throw error;
    }
    const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
    const restored = restoring && document && documents.state.buffers[uri.fsPath]?.text === document.getText();
    if (document?.isDirty && !restored && !documents.records.has(uri.fsPath)) throw new Error('Save this file in VS Code before opening it in Neovim.');
    const fileKey = uri.toString();
    const cwd = restoreCwd || vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath || path.dirname(uri.fsPath);
    const shared = config(uri).get('sharedProcess', true);
    const key = shared ? cwd : fileKey;
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const sourceTab = tab?.input instanceof vscode.TabInputText && tab.input.uri.toString() === fileKey ? tab : undefined;
    if (!sessions.has(key)) sessions.set(key, start(uri, editor?.viewColumn, key, shared, cwd));
    const pending = sessions.get(key);
    let session;
    try {
      session = await pending;
    } catch (error) {
      if (sessions.get(key) === pending) sessions.delete(key);
      throw error;
    }
    const restoredTarget = session.restoredTarget || documents.state.active[cwd]?.path;
    if (restoring && restoredTarget && restoredTarget !== uri.fsPath) uri = vscode.Uri.file(restoredTarget);
    session.restoredTarget = undefined;
    // Users may start typing while Neovim's config loads. Never close those edits.
    if (document?.isDirty && !restored && !documents.records.has(uri.fsPath)) return;
    if (await session.client.request('nvim_buf_get_name', [0]) !== uri.fsPath) {
      await session.client.request('nvim_exec_lua', ["local file = ...; local buf = vim.fn.bufadd(file); vim.fn.bufload(buf); vim.api.nvim_set_current_buf(buf)", [uri.fsPath]]);
    }
    if (editor) {
      await session.client.request('nvim_win_set_cursor', [0, [editor.selection.active.line + 1,
        Buffer.byteLength(editor.document.lineAt(editor.selection.active.line).text.slice(0, editor.selection.active.character))]]);
    }
    if (sourceTab && !sourceTab.isDirty) await vscode.window.tabGroups.close(sourceTab, true);
    showTerminal(session, editor?.viewColumn);
  }

  let running = false;
  async function runCurrentFile() {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before running code.');
    const session = terminals.get(vscode.window.activeTerminal);
    if (!session?.client) throw new Error('Focus a ready Neovim terminal before running.');
    if (running) return;
    running = true;
    try {
      const { uri, filetype } = await saveCurrentFile(vscode, session.client, document => documents.records.has(document.uri.fsPath));
      await session.client.request('nvim_exec_lua', ['if _G.neovim_terminal_snapshot then _G.neovim_terminal_snapshot() end', []]);
      await documents.flush();
      if (filetype === 'python' || path.extname(uri.fsPath).toLowerCase() === '.py') {
        await vscode.commands.executeCommand('python.execInDedicatedTerminal', uri);
      } else {
        // Generic VS Code runners resolve ${file} through an actual text editor.
        preparingRun = true;
        const existingTabs = new Set(vscode.window.tabGroups.all.flatMap(group => group.tabs));
        let runTab;
        try {
          const document = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(document, { preview: true });
          runTab = vscode.window.tabGroups.activeTabGroup.activeTab;
          await vscode.commands.executeCommand('workbench.action.debug.run');
        } finally {
          try {
            if (runTab && !existingTabs.has(runTab) && !runTab.isDirty) await vscode.window.tabGroups.close(runTab, true);
          } finally { preparingRun = false; }
        }
      }
    } finally { running = false; }
  }

  const autoOpen = editor => {
    if (preparingRun || !editor || !config(editor.document.uri).get('autoOpen', true)) return;
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (!(tab?.input instanceof vscode.TabInputText) || editor.document.uri.scheme !== 'file'
      || (editor.document.isDirty && !documents.records.has(editor.document.uri.fsPath)) || editor.document.isUntitled) return;
    void open(editor.document.uri, editor).catch(report);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('neovimTerminal.open', uri => {
      const editor = vscode.window.activeTextEditor;
      return open(uri || editor?.document.uri,
        !uri || uri.toString() === editor?.document.uri.toString() ? editor : undefined).catch(report);
    }),
    vscode.commands.registerCommand('neovimTerminal.run', () => runCurrentFile().catch(report)),
    vscode.commands.registerCommand('neovimTerminal.currentFile', () => terminals.get(vscode.window.activeTerminal)?.file?.path || ''),
    vscode.commands.registerCommand('neovimTerminal.close', async () => {
      const session = terminals.get(vscode.window.activeTerminal);
      if (session?.client) await session.client.request('nvim_exec_lua', ['if _G.neovim_terminal_snapshot then _G.neovim_terminal_snapshot() end', []]);
      return closeSession(vscode, session, documents).catch(report);
    }),
    vscode.commands.registerCommand('neovimTerminal.restore', async () => {
      const entries = config().get('sharedProcess', true) ? Object.entries(documents.state.active)
        : Object.values(documents.state.buffers).map(entry => [entry.cwd, entry]);
      for (const [cwd, entry] of entries) {
        const uri = vscode.Uri.file(entry.path);
        await open(uri, undefined, true, cwd);
        const session = await sessions.get(config(uri).get('sharedProcess', true) ? cwd : uri.toString());
        if (entry.cursor) {
          const count = await session.client.request('nvim_buf_line_count', [0]);
          await session.client.request('nvim_win_set_cursor', [0, [Math.max(1, Math.min(entry.cursor[0], count)), entry.cursor[1]]]);
        }
      }
    }),
    vscode.commands.registerCommand('neovimTerminal.flush', async () => {
      for (const pending of sessions.values()) {
        const session = await pending;
        if (!session.disposed) await session.client.request('nvim_exec_lua', ['if _G.neovim_terminal_snapshot then _G.neovim_terminal_snapshot() end', []]);
      }
      await documents.flush();
    }),
    vscode.window.onDidChangeActiveTextEditor(autoOpen),
    vscode.window.onDidChangeActiveTerminal(updateTerminalContext),
    vscode.window.onDidChangeActiveColorTheme(syncThemes),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (['workbench.colorTheme', 'workbench.colorCustomizations', 'editor.tokenColorCustomizations',
        'editor.semanticTokenColorCustomizations'].some(key => event.affectsConfiguration(key))) syncThemes();
    }),
  );
  if (vscode.workspace.isTrusted && config().get('restoreSession', true)) {
    void vscode.commands.executeCommand('neovimTerminal.restore').catch(report);
  }
  autoOpen(vscode.window.activeTextEditor);
}

module.exports = { activate, deactivate: () => activeDocuments?.flush() };
