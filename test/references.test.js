const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { connect } = require('../rpc');
const { socketPath } = require('../transport');

test('optional references formatter separates fields and preserves navigation, search, and user options', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nvim-refs-'));
  const socket = socketPath(directory);
  const child = spawn('nvim', ['--clean', '--headless', '--listen', socket]);
  let connection;
  try {
    connection = await connect(socket, new AbortController().signal);
    const client = connection.client;
    const script = await fs.readFile(path.join(__dirname, '../lua/references.lua'), 'utf8');
    await client.request('nvim_exec_lua', [script, []]); // Telescope absent is harmless.
    await client.request('nvim_exec_lua', [`
      package.loaded['telescope.config'] = { pickers = { lsp_references = { include_declaration = false }, files = { sentinel = true } } }
      package.loaded['telescope.make_entry'] = { gen_from_quickfix = function() return function(item)
        local e=vim.deepcopy(item); e.ordinal=e.filename..' '..e.text; e.value=item; return e
      end end }
      package.loaded['telescope.state'] = { get_status = function() end }
      package.loaded['telescope.pickers.entry_display'] = { create = function(opts)
        return function(fields) return fields end
      end }
    `, []]);
    await client.request('nvim_exec_lua', [script, []]);
    const result = await client.request('nvim_exec_lua', [`
      local cfg=require('telescope.config').pickers
      local opts=cfg.lsp_references
      assert(opts.include_declaration == false and cfg.files.sentinel, 'preserve user settings and other pickers')
      assert(opts.sorting_strategy=='ascending' and opts.layout_strategy=='flex')
      assert(opts.layout_config.horizontal.prompt_position=='top')
      local e=opts.entry_maker({filename='/workspace/lib/Example.ahk',lnum=42,col=7,text='    call_target()  ',start={line=41},finish={line=42}})
      assert(e.filename=='/workspace/lib/Example.ahk' and e.lnum==42 and e.col==7)
      assert(e.ordinal:find('/workspace/lib/Example.ahk',1,true), 'full paths stay searchable')
      assert(e.start.line==41 and e.finish.line==42, 'retain LSP selection range')
      local fields=e.display(e)
      assert(fields[1][1]=='Example.ahk' and fields[1][2]=='NeovimTerminalReferenceFile')
      assert(fields[2][1]=='42:7' and fields[2][2]=='NeovimTerminalReferenceLocation')
      assert(fields[3][1]=='/workspace/lib' and fields[3][2]=='NeovimTerminalReferencePath' and fields[4]=='call_target()')
      assert(opts.results_title==false, 'no column legend title')
      return true
    `, []]);
    assert.equal(result, true);
    await client.request('nvim_exec_lua', ["require('telescope.config').pickers.lsp_references.entry_maker=function() return 'custom' end", []]);
    await client.request('nvim_exec_lua', [script, []]);
    assert.equal(await client.request('nvim_exec_lua', ["return require('telescope.config').pickers.lsp_references.entry_maker()", []]), 'custom');
  } finally {
    connection?.dispose(); child.kill();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
