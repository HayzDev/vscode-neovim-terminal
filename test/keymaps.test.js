const { socketPath } = require('../transport');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { connect } = require('../rpc');

test('shift arrows use Home/End and reuse visual Tab mappings from normal and visual modes', async () => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nvim-keys-')));
  const socket = socketPath(directory);
  const child = spawn('nvim', ['-n', '--clean', '--headless', '--listen', socket]);
  let connection;
  try {
    connection = await connect(socket, new AbortController().signal);
    const script = await fs.readFile(path.join(__dirname, '../lua/keymaps.lua'), 'utf8');
    await connection.client.request('nvim_exec_lua', [script, []]);
    await connection.client.request('nvim_exec_lua', [`
      vim.api.nvim_buf_set_lines(0, 0, -1, false, { '  alpha beta' })
      local function keys(input)
        vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(input, true, false, true), 'xt', false)
      end
      vim.api.nvim_win_set_cursor(0, { 1, 6 })
      keys('<S-Left>')
      assert(vim.api.nvim_win_get_cursor(0)[2] == 0, 'Home in normal mode')
      keys('<S-Right>')
      assert(vim.api.nvim_win_get_cursor(0)[2] == 11, 'End in normal mode')
      keys('i<S-Left>X<Esc>')
      assert(vim.api.nvim_get_current_line() == 'X  alpha beta', 'Home in insert mode')
      keys('i<S-Right>Y<Esc>')
      assert(vim.api.nvim_get_current_line() == 'X  alpha betaY', 'End in insert mode')
      vim.keymap.set('x', '<Tab>', function() vim.g.node_move = 'next' end)
      vim.keymap.set('x', '<S-Tab>', function() vim.g.node_move = 'previous' end)
      keys('<S-Down>')
      assert(vim.g.node_move == 'next', 'normal to visual next node')
      keys('<S-Up>')
      assert(vim.g.node_move == 'previous', 'visual previous node')
      keys('<Esc><S-Up>')
      assert(vim.g.node_move == 'previous', 'normal to visual previous node')
    `, []]);
  } finally {
    connection?.dispose();
    child.kill();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
