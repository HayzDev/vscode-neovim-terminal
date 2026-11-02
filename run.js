const path = require('node:path');

async function saveCurrentFile(vscode, client, ownsDocument = () => false) {
  const file = await client.request('nvim_exec_lua', [`
    local buf = vim.api.nvim_get_current_buf()
    return { buf = buf, path = vim.api.nvim_buf_get_name(buf), buftype = vim.bo[buf].buftype, filetype = vim.bo[buf].filetype }
  `, []]);
  if (file.buftype !== '' || !path.isAbsolute(file.path)) {
    throw new Error('Open a named file in Neovim before running it.');
  }
  const uri = vscode.Uri.file(file.path);
  if (vscode.workspace.textDocuments.some(document => document.uri.toString() === uri.toString() && document.isDirty && !ownsDocument(document))) {
    throw new Error('This file has unsaved edits in VS Code. Save or discard those edits before running from Neovim.');
  }
  await client.request('nvim_exec_lua', [`
    local buf, name = ...
    assert(vim.api.nvim_buf_is_valid(buf) and vim.api.nvim_buf_get_name(buf) == name, 'The Neovim file changed; try running again.')
    vim.api.nvim_buf_call(buf, function() vim.cmd('update') end)
    assert(not vim.bo[buf].modified, 'Neovim could not save this file.')
  `, [file.buf, file.path]]);
  return { uri, filetype: file.filetype };
}

async function runAutoHotkey(vscode, uri) {
  const executable = vscode.workspace.getConfiguration('AutoHotkey2', uri).get('InterpreterPath') || 'AutoHotkey.exe';
  const task = new vscode.Task(
    { type: 'neovim-terminal', file: uri.fsPath },
    vscode.workspace.getWorkspaceFolder(uri) || vscode.TaskScope.Workspace,
    `Run ${path.basename(uri.fsPath)}`, 'Neovim Terminal',
    new vscode.ProcessExecution(executable, ['/ErrorStdOut', uri.fsPath], { cwd: path.dirname(uri.fsPath) }),
  );
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, focus: false, clear: true };
  return vscode.tasks.executeTask(task);
}

module.exports = { saveCurrentFile, runAutoHotkey };
