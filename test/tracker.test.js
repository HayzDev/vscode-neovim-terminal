const { socketPath } = require('../transport');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { setTimeout: delay } = require('node:timers/promises');
const { connect } = require('../rpc');

test('buffer snapshots preserve empty files, CRLF, and missing final newlines', async () => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nvim-track-')));
  const file = path.join(directory, 'empty.txt');
  await fs.writeFile(file, '');
  const socket = socketPath(directory);
  const child = spawn('nvim', ['-n', '--clean', '--headless', '--listen', socket, '--', file]);
  let connection;
  try {
    connection = await connect(socket, new AbortController().signal);
    const snapshots = [];
    connection.client.on('notification', (name, args) => { if (name === 'neovim_terminal.buffer') snapshots.push(args[0]); });
    await connection.client.request('nvim_exec_lua', [await fs.readFile(path.join(__dirname, '../lua/current-file.lua'), 'utf8'), [await connection.client.channelId]]);
    for (const text of ['', '\n', '\r\n', 'one\r\ntwo\r\n', 'no final newline']) {
      const next = path.join(directory, `file-${snapshots.length}-${text.length}.txt`);
      await fs.writeFile(next, text);
      await connection.client.request('nvim_cmd', [{ cmd: 'edit', args: [next] }, {}]);
      let snapshot;
      for (let i = 0; i < 50; i++) {
        snapshot = snapshots.find(value => path.normalize(value.path) === next);
        if (snapshot) break;
        await delay(20);
      }
      assert.equal(snapshot?.text, text);
    }
    const previous = await connection.client.request('nvim_buf_get_name', [0]);
    await connection.client.request('nvim_win_set_cursor', [0, [1, 3]]);
    await connection.client.request('nvim_cmd', [{ cmd: 'edit', args: [file] }, {}]);
    await connection.client.request('nvim_exec_lua', ['_G.neovim_terminal_snapshot()', []]);
    assert.deepEqual(snapshots.findLast(value => value.path === previous).cursor, [1, 3], 'inactive buffer cursor columns survive a snapshot');
    connection.dispose();
    await assert.rejects(connection.client.request('nvim_get_current_line', []), /disconnected/);
  } finally { connection?.dispose(); child.kill(); await fs.rm(directory, { recursive: true, force: true }); }
});
