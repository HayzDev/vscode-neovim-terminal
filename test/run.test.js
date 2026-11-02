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

test('AutoHotkey runs as a process task without opening a native editor', async () => {
  const { runAutoHotkey } = require('../run');
  let task;
  const vscode = {
    workspace: { getConfiguration: () => ({ get: () => 'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey.exe' }), getWorkspaceFolder: () => undefined },
    TaskScope: { Workspace: 2 }, TaskRevealKind: { Always: 1 }, TaskPanelKind: { Dedicated: 2 },
    ProcessExecution: class { constructor(command, args, options) { Object.assign(this,{command,args,options}); } },
    Task: class { constructor(definition, scope, name, source, execution) { Object.assign(this,{definition,scope,name,source,execution}); } },
    tasks: { executeTask: async value => { task=value; return {}; } },
    window: { showTextDocument: () => { throw Error('must not open native editor'); } },
  };
  const file=path.resolve('script with spaces & chars.ahk');
  await runAutoHotkey(vscode,{fsPath:file});
  assert.equal(task.execution.args[1],file);
  assert.equal(task.execution.args[0],'/ErrorStdOut');
  assert.equal(task.presentationOptions.focus,false);
  assert.equal(task.execution.options.cwd,path.dirname(file));
});

test('installed AutoHotkey interpreter accepts direct script arguments', { skip: process.platform !== 'win32' }, async t => {
  const executable = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'AutoHotkey', 'v2', 'AutoHotkey.exe');
  try { await fs.access(executable); } catch { t.skip('AutoHotkey v2 is not installed'); return; }
  const file = path.join(os.tmpdir(), `nvim run ${require('node:crypto').randomUUID()}.ahk`);
  try {
    await fs.writeFile(file, '#Requires AutoHotkey v2.0\n#NoTrayIcon\nFileAppend("NVIM_DIRECT_RUN_OK", "*")\nExitApp()\n');
    const execFile = require('node:util').promisify(require('node:child_process').execFile);
    const { stdout } = await execFile(executable, ['/ErrorStdOut', file], { windowsHide: true, timeout: 10000 });
    assert.equal(stdout, 'NVIM_DIRECT_RUN_OK');
  } finally { await fs.rm(file, { force: true }); }
});
