const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { connect } = require('../rpc');

async function until(check) {
  for (let i = 0; i < 180; i++) { if (await check()) return; await delay(100); }
  throw new Error('Timed out waiting for feature verification');
}

async function run() {
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const statePath = path.join(root, 'test-state.json');
  const first = vscode.Uri.file(path.join(root, 'first.lua'));
  const second = vscode.Uri.file(path.join(root, 'second.lua'));
  const phase = Number(process.env.NVIM_TEST_PHASE || 1);
  console.log('FEATURE PHASE', phase);
  await vscode.extensions.getExtension('xander-local.neovim-terminal').activate();
  if (phase === 1) {
    await fs.writeFile(first.fsPath, 'local café = 1\r\nlocal b = 2\r\nexample(café)\r\n');
    await fs.writeFile(second.fsPath, 'local second = 2\n');
    await vscode.commands.executeCommand('neovimTerminal.open', first);
  }
  await until(() => vscode.window.terminals.length > 0);
  let terminal = vscode.window.terminals[0];
  let args;
  await until(async () => {
    args = (await fs.readFile(`/proc/${await terminal.processId}/cmdline`, 'utf8')).split('\0');
    return args.includes('--remote-ui');
  });
  assert.ok(args.includes('--remote-ui'), 'terminal is a UI of the shared server');
  const socket = args[args.indexOf('--server') + 1];
  const connection = await connect(socket, new AbortController().signal);
  const client = connection.client;
  const pid = await client.request('nvim_call_function', ['getpid', []]);
  try {
    if (phase > 1) {
      const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
      assert.equal(pid === state.pid, phase === 2, 'reconnect to live backend or restart after crash');
      await until(async () => await client.request('nvim_buf_get_name', [0]) === second.fsPath);
      assert.deepEqual(await client.request('nvim_buf_get_lines', [0, 0, -1, false]), ['local recovered = 42', '-- cursor restore']);
      assert.equal(await client.request('nvim_get_option_value', ['modified', { buf: 0 }]), true);
      assert.deepEqual(await client.request('nvim_win_get_cursor', [0]), [2, 3]);
      assert.equal(await client.request('nvim_exec_lua', ["for _, b in ipairs(vim.api.nvim_list_bufs()) do if vim.api.nvim_buf_is_loaded(b) and vim.api.nvim_buf_get_lines(b, 0, 1, false)[1] == 'untitled draft survives' then return true end end; return false", []]), true, 'unnamed draft survives restart and crash');
      const document = await vscode.workspace.openTextDocument(second);
      await until(() => document.isDirty && document.getText().includes('recovered = 42'));
      if (phase === 2) {
        await vscode.commands.executeCommand('neovimTerminal.flush');
        process.kill(pid, 'SIGKILL');
        console.log('PASS: restart reconnects to same backend with dirty content and cursor; simulated backend crash');
      } else {
        await client.command('wall');
        await until(() => !document.isDirty);
        await client.command('qa!').catch(() => {});
        console.log('PASS: cold restore recovers unsaved text and cursor from persisted snapshot');
      }
      return;
    }
    await until(() => terminal.name.includes('first.lua'));
    const firstDoc = await vscode.workspace.openTextDocument(first);
    await client.request('nvim_buf_set_lines', [0, 0, 1, false, ['local mirrored = 3']]);
    await until(() => firstDoc.isDirty && firstDoc.getText().includes('mirrored = 3'));
    assert.ok((await fs.readFile(first.fsPath, 'utf8')).includes('café = 1'), 'mirroring does not save user edits');
    const formatter = vscode.languages.registerDocumentFormattingEditProvider('lua', {
      provideDocumentFormattingEdits: doc => [vscode.TextEdit.replace(new vscode.Range(0, 0, 0, doc.lineAt(0).text.length), doc.lineAt(0).text + ' -- formatted')],
    });
    await vscode.workspace.getConfiguration('editor').update('formatOnSave', true, vscode.ConfigurationTarget.Global);
    await firstDoc.save();
    await until(async () => !(await client.request('nvim_get_option_value', ['modified', { buf: 0 }])));
    await until(async () => (await client.request('nvim_buf_get_lines', [0, 0, 1, false]))[0].includes('-- formatted'));
    assert.equal(firstDoc.eol, vscode.EndOfLine.CRLF, 'CRLF is preserved through mirroring and formatting');
    formatter.dispose();
    await vscode.workspace.getConfiguration('editor').update('formatOnSave', false, vscode.ConfigurationTarget.Global);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(first, new vscode.Range(0, 0, 0, firstDoc.lineAt(0).text.length), 'local native = 4');
    await vscode.workspace.applyEdit(edit);
    await until(async () => (await client.request('nvim_get_current_line', [])).includes('native = 4'));
    console.log('FEATURE: native edits mirrored; writing from Neovim');
    await client.command('write');
    console.log('FEATURE: Neovim write returned');
    await until(() => !firstDoc.isDirty);
    const unnamed = await client.request('nvim_create_buf', [true, false]);
    await client.request('nvim_set_current_buf', [unnamed]);
    await client.request('nvim_buf_set_lines', [unnamed, 0, -1, false, ['untitled draft survives']]);
    await until(() => vscode.workspace.textDocuments.some(doc => doc.isUntitled && doc.isDirty && doc.getText().includes('untitled draft survives')));
    await vscode.commands.executeCommand('neovimTerminal.open', second);
    assert.equal(vscode.window.terminals.length, 1, 'two files share one terminal and server');
    assert.equal(await client.request('nvim_call_function', ['getpid', []]), pid);
    await until(() => terminal.name.includes('second.lua'));
    await vscode.workspace.getConfiguration('neovimTerminal').update('autoOpen', true, vscode.ConfigurationTarget.Workspace);
    const editor = await vscode.window.showTextDocument(first, { selection: new vscode.Range(2, 12, 2, 12) });
    await until(async () => await client.request('nvim_buf_get_name', [0]) === first.fsPath);
    await until(async () => (await client.request('nvim_win_get_cursor', [0]))[0] === 3);
    assert.equal((await client.request('nvim_win_get_cursor', [0]))[1], Buffer.byteLength(editor.document.lineAt(2).text.slice(0, 12)));

    await client.request('nvim_exec_lua', [`
      vim.api.nvim_win_set_cursor(0, { 3, 0 })
      for _, existing in ipairs(vim.lsp.get_clients({ bufnr = 0 })) do existing:stop(true) end
      vim.lsp.start({ name = 'hover-test', root_dir = vim.fn.getcwd(),
        cmd = function()
          return {
            request = function(method, params, callback)
              if method == 'initialize' then callback(nil, { capabilities = { hoverProvider = true, positionEncoding = 'utf-16' } })
              elseif method == 'textDocument/hover' then
                vim.g.hover_test_position = params.position
                callback(nil, { contents = { kind = 'markdown', value = 'Documentation from Neovim LSP' } })
              elseif method == 'shutdown' then callback(nil, nil) end
              return true, 1
            end,
            notify = function() return true end, is_closing = function() return false end, terminate = function() end,
          }
        end,
      })
    `, []]);
    await until(async () => await client.request('nvim_exec_lua', ["return #vim.lsp.get_clients({bufnr=0, method='textDocument/hover'}) > 0", []]));
    const screen = await client.request('nvim_exec_lua', ["return vim.fn.screenpos(0, 3, 1)", []]);
    terminal.show();
    await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', { text: `\x1b[<35;${screen.col};${screen.row}M` });
    await until(async () => await client.request('nvim_exec_lua', [`
      for _, win in ipairs(vim.api.nvim_list_wins()) do
        if vim.api.nvim_win_get_config(win).relative ~= '' then
          local lines = vim.api.nvim_buf_get_lines(vim.api.nvim_win_get_buf(win), 0, -1, false)
          if table.concat(lines, '\\n'):find('Documentation from Neovim LSP', 1, true) then return true end
        end
      end
      return false
    `, []]));
    console.log('PASS: real mouse escape sequence triggers debounced Neovim LSP hover');

    terminal.dispose();
    await until(() => vscode.window.terminals.length === 0);
    await vscode.commands.executeCommand('neovimTerminal.open', second);
    await until(() => vscode.window.terminals.length === 1);
    terminal = vscode.window.terminals[0];
    assert.equal(await client.request('nvim_call_function', ['getpid', []]), pid, 'closing UI does not kill server');
    await client.request('nvim_buf_set_lines', [0, 0, -1, false, ['local recovered = 42', '-- cursor restore']]);
    await client.request('nvim_win_set_cursor', [0, [2, 3]]);
    const secondDoc = await vscode.workspace.openTextDocument(second);
    await until(() => secondDoc.isDirty && secondDoc.getText().includes('recovered = 42'));
    await vscode.commands.executeCommand('neovimTerminal.flush');
    await fs.writeFile(statePath, JSON.stringify({ pid, socket }));
    console.log('PASS: shared process, native dirty/save sync, file navigation, dynamic titles, close survival; saved restart fixture');
  } finally { connection.dispose(); }
}
module.exports = { run };
