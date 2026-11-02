const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { connect } = require('../rpc');
const { socketPath } = require('../transport');

test('terminal quick open routes directly to available Neovim picker with workspace cwd', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nvim-quick-'));
  const socket = socketPath(dir);
  const child = spawn('nvim', ['--clean', '--headless', '--listen', socket]);
  let c;
  try {
    c = await connect(socket, new AbortController().signal);
    const script = await fs.readFile(path.join(__dirname, '../lua/quick-open.lua'), 'utf8');
    assert.equal(await c.client.request('nvim_exec_lua', [script, [dir]]), false, 'no picker falls back safely');
    await c.client.request('nvim_exec_lua', ["package.loaded['snacks']={picker={files=function(opts) vim.g.quick_cwd=opts.cwd;vim.g.quick_picker='snacks' end}}", []]);
    assert.equal(await c.client.request('nvim_exec_lua', [script, [dir]]), true);
    assert.equal(await c.client.getVar('quick_cwd'), dir);
    assert.equal(path.normalize(await c.client.call('getcwd')), path.normalize(dir), 'workspace restored after startup/plugin cwd drift');
    assert.equal(await c.client.getVar('quick_picker'), 'snacks');
    await c.client.request('nvim_exec_lua', ["package.loaded['snacks']=nil;package.preload['snacks']=function() error('not installed') end;package.loaded['telescope.builtin']={find_files=function(opts) vim.g.quick_cwd=opts.cwd;vim.g.quick_picker='telescope' end}", []]);
    assert.equal(await c.client.request('nvim_exec_lua', [script, [dir]]), true);
    assert.equal(await c.client.getVar('quick_picker'), 'telescope');
  } finally { c?.dispose();const exited = new Promise(resolve => child.once('exit',resolve));child.kill();await exited;await fs.rm(dir,{recursive:true,force:true}); }
});
