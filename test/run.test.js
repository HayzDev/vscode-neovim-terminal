const { socketPath } = require('../transport');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { connect } = require('../rpc');
const { saveCurrentFile } = require('../run');

test('run saves the current Neovim buffer and blocks conflicting or unnamed buffers', async () => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nvim-run-')));
  const first = path.join(directory, 'first.py');
  const second = path.join(directory, 'second file.py');
  await fs.writeFile(first, 'print(1)\n');
  await fs.writeFile(second, 'print(2)\n');
  const socket = socketPath(directory);
  const child = spawn('nvim', ['--clean', '--headless', '--listen', socket, '--', first]);
  const vscode = { Uri: { file: file => ({ fsPath: path.normalize(file), toString: () => pathToFileURL(file).href }) }, workspace: { textDocuments: [] } };
  let connection;
  try {
    connection = await connect(socket, new AbortController().signal);
    const client = connection.client;
    await client.request('nvim_cmd', [{ cmd: 'edit', args: [second] }, {}]);
    await client.request('nvim_buf_set_lines', [0, 0, -1, false, ['print(3)']]);
    const result = await saveCurrentFile(vscode, client);
    assert.equal(result.uri.fsPath, second);
    assert.equal(await fs.readFile(second, 'utf8'), 'print(3)\n');
    assert.equal(await fs.readFile(first, 'utf8'), 'print(1)\n');
    await client.request('nvim_buf_set_lines', [0, 0, -1, false, ['print(4)']]);
    vscode.workspace.textDocuments.push({ uri: vscode.Uri.file(second), isDirty: true });
    await assert.rejects(saveCurrentFile(vscode, client), /unsaved edits in VS Code/);
    assert.equal(await fs.readFile(second, 'utf8'), 'print(3)\n');
    vscode.workspace.textDocuments.length = 0;
    await client.request('nvim_set_option_value', ['readonly', true, { buf: 0 }]);
    await assert.rejects(saveCurrentFile(vscode, client), /readonly/);
    await client.request('nvim_set_current_buf', [await client.request('nvim_create_buf', [false, true])]);
    await assert.rejects(saveCurrentFile(vscode, client), /named file/);
  } finally {
    connection?.dispose();
    child.kill();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
