const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { connect } = require('../rpc');
const { socketPath } = require('../transport');

test('file switch uses one RPC and terminal title follows edits while ignoring picker buffers', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nvim-nav-'));
  const first = path.join(dir, 'first file.txt'), second = path.join(dir, 'second file.txt');
  await fs.writeFile(first, 'one\n'); await fs.writeFile(second, 'two\nthree\n');
  const socket = socketPath(dir);
  const child = spawn('nvim', ['--clean', '--headless', '--listen', socket, '--', first]);
  let connection, ui;
  try {
    connection = await connect(socket, new AbortController().signal);
    ui = await connect(socket, new AbortController().signal);
    const titles = [];
    ui.client.on('notification', (method, events) => {
      if (method === 'redraw') for (const event of events) if (event[0] === 'set_title') for (const args of event.slice(1)) titles.push(args[0]);
    });
    await ui.client.request('nvim_ui_attach', [100, 40, { ext_linegrid: true }]);
    await connection.client.request('nvim_exec_lua', [await fs.readFile(path.join(__dirname, '../lua/current-file.lua'), 'utf8'), [await connection.client.channelId]]);
    await connection.client.request('nvim_buf_set_lines', [0, 0, -1, false, ['unsaved first']]);
    const { switchFile } = require('../navigation');
    let requests = 0;
    const counted = { request: (...args) => { requests++; return connection.client.request(...args); } };
    const info = await switchFile(counted, second, { line: 1, byteColumn: 2 });
    assert.equal(requests, 1);
    assert.equal(path.normalize(info.path), second);
    assert.deepEqual(await connection.client.request('nvim_win_get_cursor', [0]), [2, 2]);
    await connection.client.request('nvim_command', ['redraw!']);
    await connection.client.request('nvim_exec_lua', ['return true', []]);
    assert.equal(titles.at(-1), 'nvim: second file.txt');
    await connection.client.request('nvim_exec_lua', ["local b=vim.api.nvim_create_buf(false,true); vim.bo[b].buftype='prompt'; vim.api.nvim_set_current_buf(b); vim.cmd.redraw()", []]);
    await connection.client.request('nvim_exec_lua', ['return true', []]);
    assert.equal(titles.at(-1), 'nvim: second file.txt', 'picker must not rename terminal to No Name');
    await switchFile(connection.client, first);
    await connection.client.request('nvim_command', ['redraw!']);
    await connection.client.request('nvim_exec_lua', ['return true', []]);
    assert.equal(titles.at(-1), 'nvim: first file.txt *');
    assert.deepEqual(await connection.client.request('nvim_buf_get_lines', [0, 0, -1, false]), ['unsaved first']);
  } finally {
    ui?.dispose(); connection?.dispose(); child.kill();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
