const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { connect } = require('../rpc');
const { socketPath } = require('../transport');

test('replacement UI releases stale small screen without losing unsaved buffers', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nvim-ui-'));
  const socket = socketPath(directory);
  const child = spawn('nvim', ['--clean', '--headless', '--listen', socket]);
  const connections = [];
  try {
    const open = async () => {
      const c = await connect(socket, new AbortController().signal);
      connections.push(c);
      return c.client;
    };
    const control = await open();
    await control.request('nvim_buf_set_lines', [0, 0, -1, false, ['unsaved work']]);
    const old = await open();
    await old.request('nvim_ui_attach', [24, 30, { ext_linegrid: true }]);
    const current = await open();
    await current.request('nvim_ui_attach', [98, 43, { ext_linegrid: true }]);
    assert.equal(await control.request('nvim_eval', ['&columns']), 24, 'reproduces smallest UI constraint');
    const script = await fs.readFile(path.join(__dirname, '../lua/single-ui.lua'), 'utf8');
    await control.request('nvim_exec_lua', [script, []]);
    assert.equal(await control.request('nvim_eval', ['&columns']), 98, 'existing stale UI released');
    const next = await open();
    await next.request('nvim_ui_attach', [120, 50, { ext_linegrid: true }]);
    await control.request('nvim_exec_lua', ['return true', []]);
    assert.equal(await control.request('nvim_eval', ['&columns']), 120, 'new attachment replaces previous UI');
    await next.request('nvim_ui_try_resize', [110, 40]);
    assert.equal(await control.request('nvim_eval', ['&columns']), 110, 'normal resizing still works');
    assert.equal((await control.request('nvim_list_uis', [])).length, 1);
    assert.deepEqual(await control.request('nvim_buf_get_lines', [0, 0, -1, false]), ['unsaved work']);
    assert.equal(await control.request('nvim_get_option_value', ['modified', { buf: 0 }]), true);
  } finally {
    for (const c of connections) c.dispose();
    child.kill();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
