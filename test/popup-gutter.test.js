const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { connect } = require('../rpc');
const { socketPath } = require('../transport');
const { palette } = require('../theme');

test('floating gutters match popup surfaces while main editor gutter retains theme color', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nvim-gutter-'));
  const socket = socketPath(directory);
  const child = spawn('nvim', ['--clean', '--headless', '--listen', socket]);
  let connection;
  try {
    connection = await connect(socket, new AbortController().signal);
    const client = connection.client;
    const theme = palette({ colors: { 'editor.background': '#1e1e1e', 'editorGutter.background': '#101010' } }, 'Test', false);
    const script = await fs.readFile(path.join(__dirname, '../lua/theme.lua'), 'utf8');
    await client.request('nvim_exec_lua', [script, [theme]]);
    const win = await client.request('nvim_exec_lua', [`local b=vim.api.nvim_create_buf(false,true); local w=vim.api.nvim_open_win(b,false,{relative='editor',row=1,col=1,width=20,height=5}); vim.wo[w].winhighlight='NormalFloat:Normal,FloatTitle:Special'; return w`, []]);
    const result = await client.request('nvim_exec_lua', [`local w=...; local mapped={}; for item in vim.wo[w].winhighlight:gmatch('[^,]+') do local a,b=item:match('([^:]+):(.+)'); mapped[a]=b end; return {mapped=mapped,main=vim.api.nvim_get_hl(0,{name='SignColumn',link=false}),float=vim.api.nvim_get_hl(0,{name=mapped.SignColumn or 'SignColumn',link=false})}`, [win]]);
    assert.equal(result.main.bg, 0x101010, 'main gutter unchanged');
    assert.equal(result.mapped.NormalFloat,'NormalFloat','scratch surface must not map back to editor');
    assert.equal(result.mapped.EndOfBuffer,'NeovimTerminalFloatEmpty','empty area must use popup background');
    assert.equal(result.mapped.FloatTitle,'Special','preserve unrelated popup highlight mappings');
    await client.request('nvim_set_option_value',['winhighlight','NormalFloat:Normal,FloatTitle:Special',{win}]);
    const reapplied = await client.request('nvim_get_option_value',['winhighlight',{win}]);
    assert.ok(reapplied.includes('NormalFloat:NormalFloat'),'plugin remapping after creation is corrected');
    assert.equal(result.float.bg, parseInt(theme.highlights.NormalFloat.bg.slice(1), 16), 'float gutter matches popup');
    for (const group of ['SignColumn', 'FoldColumn', 'CursorLineSign', 'CursorLineFold']) assert.equal(result.mapped[group], 'NeovimTerminalFloatGutter');
  } finally {
    connection?.dispose();
    child.kill();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
