const { socketPath } = require('../transport');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { connect } = require('../rpc');

test('real Neovim RPC reads and saves a path containing shell metacharacters', async () => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nvim-test-')));
  const file = path.join(directory, 'space $(touch SHOULD_NOT_EXIST).txt');
  const socket = socketPath(directory);
  await fs.writeFile(file, 'original\n');
  const process = spawn('nvim', ['--clean', '--headless', '--listen', socket, '--', file]);
  const controller = new AbortController();
  let connection;
  try {
    connection = await connect(socket, controller.signal);
    assert.equal(path.normalize(await connection.client.request('nvim_buf_get_name', [0])), file);
    await connection.client.request('nvim_buf_set_lines', [0, 0, -1, false, ['saved through RPC']]);
    await connection.client.command('write');
    assert.equal(await fs.readFile(file, 'utf8'), 'saved through RPC\n');
    await assert.rejects(fs.stat(path.join(directory, 'SHOULD_NOT_EXIST')));
  } finally {
    connection?.dispose();
    controller.abort();
    process.kill();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('connection cancellation stops startup waiting', async () => {
  const controller = new AbortController();
  const connecting = connect(socketPath(os.tmpdir()), controller.signal);
  controller.abort();
  await assert.rejects(connecting, { name: 'AbortError' });
});
