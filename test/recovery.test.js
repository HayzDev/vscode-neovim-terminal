const { socketPath } = require('../transport');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Documents, hash } = require('../documents');
const { connect } = require('../rpc');

test('snapshots persist privately and recovery never overwrites a changed disk file', async () => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nvim-recovery-')));
  const file = path.join(directory, 'example.lua');
  await fs.writeFile(file, 'original\n');
  const context = { storageUri: { fsPath: path.join(directory, 'storage') },
    globalStorageUri: { fsPath: path.join(directory, 'global') }, subscriptions: [] };
  const noop = () => ({ dispose() {} });
  const vscode = { workspace: { onDidChangeTextDocument: noop, onDidSaveTextDocument: noop },
    window: { showWarningMessage: () => {} } };
  const documents = new Documents(vscode, context, error => { throw error; });
  documents.state.buffers[file] = { path: file, cwd: directory, modified: true,
    text: 'unsaved backup\nsecond line\n', diskHash: hash('original\n'), cursor: [2, 3] };
  documents.state.active[directory] = { path: file, cursor: [2, 3] };
  await documents.persist();
  if (process.platform !== 'win32') assert.equal((await fs.stat(documents.statePath)).mode & 0o777, 0o600);
  const loaded = new Documents(vscode, context, error => { throw error; });
  await loaded.load();
  assert.equal(loaded.state.buffers[file].text, 'unsaved backup\nsecond line\n');
  const socket = socketPath(directory);
  const child = spawn('nvim', ['--clean', '--headless', '--listen', socket, '--', file]);
  let connection;
  try {
    connection = await connect(socket, new AbortController().signal);
    await documents.restore({ cwd: directory, client: connection.client });
    const buffer = await connection.client.request('nvim_call_function', ['bufnr', [file]]);
    assert.deepEqual(await connection.client.request('nvim_buf_get_lines', [buffer, 0, -1, false]), ['unsaved backup', 'second line']);
    assert.equal(await connection.client.request('nvim_get_option_value', ['modified', { buf: buffer }]), true);
    assert.deepEqual(await connection.client.request('nvim_buf_get_mark', [buffer, '"']), [2, 3]);
    await fs.writeFile(file, 'external changes\n');
    // A fresh server after a crash has only disk contents. Verify recovery against it.
    await connection.client.request('nvim_buf_set_lines', [buffer, 0, -1, false, ['external changes']]);
    await connection.client.request('nvim_set_option_value', ['modified', false, { buf: buffer }]);
    await loaded.restore({ cwd: directory, client: connection.client });
    assert.equal(await fs.readFile(file, 'utf8'), 'external changes\n');
    const recovered = loaded.state.active[directory].path;
    assert.notEqual(recovered, file);
    assert.equal(await fs.readFile(recovered, 'utf8'), 'unsaved backup\nsecond line\n');
    if (process.platform !== 'win32') assert.equal((await fs.stat(recovered)).mode & 0o777, 0o600);
    assert.equal(loaded.state.buffers[file], undefined);
  } finally {
    connection?.dispose(); child.kill();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
