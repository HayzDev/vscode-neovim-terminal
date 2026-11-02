const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { connect } = require('../rpc');

async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error('Timed out waiting for VS Code / Neovim');
}

async function run() {
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const uri = vscode.Uri.file(path.join(root, 'file with spaces.txt'));
  const other = vscode.Uri.file(path.join(root, 'other.txt'));
  await fs.writeFile(uri.fsPath, 'hello\n');
  await fs.writeFile(other.fsPath, 'world\n');
  await vscode.extensions.getExtension('xander-local.neovim-terminal').activate();
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  const original = vscode.window.tabGroups.activeTabGroup.activeTab;
  await vscode.commands.executeCommand('neovimTerminal.open');
  assert.equal(vscode.window.terminals.length, 1);
  assert.equal(vscode.window.terminals[0].name, 'nvim: file with spaces.txt');
  assert.ok(!vscode.window.tabGroups.all.some(group => group.tabs.includes(original)));
  const terminal = vscode.window.terminals[0];
  const marker = path.join(root, 'rpc-ready.txt');
  terminal.sendText(`:call writefile([expand('%:p')], '${marker}')`, true);
  await until(async () => {
    try { return (await fs.readFile(marker, 'utf8')).trim() === uri.fsPath; } catch { return false; }
  });
  const keyArgs = (await fs.readFile(`/proc/${await terminal.processId}/cmdline`, 'utf8')).split('\0');
  const keyConnection = await connect(keyArgs[keyArgs.indexOf('--listen') + 1], new AbortController().signal);
  const client = keyConnection.client;
  const originalBuffer = await client.request('nvim_get_current_buf', []);
  const scratch = await client.request('nvim_create_buf', [false, true]);
  const bindings = require('../package.json').contributes.keybindings;
  const press = async key => {
    terminal.show();
    await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', bindings.find(binding => binding.key === key).args);
  };
  try {
    await client.request('nvim_set_current_buf', [scratch]);
    await client.request('nvim_buf_set_lines', [scratch, 0, -1, false, ['  alpha beta']]);
    await client.request('nvim_win_set_cursor', [0, [1, 6]]);
    await press('shift+left');
    await until(async () => (await client.request('nvim_win_get_cursor', [0]))[1] === 0);
    await press('shift+right');
    await until(async () => (await client.request('nvim_win_get_cursor', [0]))[1] === 11);
    const hasNodeMapping = await client.request('nvim_exec_lua', ["return type(vim.fn.maparg('<Tab>', 'x', false, true).callback) == 'function'", []]);
    if (hasNodeMapping) {
      await client.request('nvim_buf_set_lines', [scratch, 0, -1, false, ['foo(first, second, third)']]);
      await client.request('nvim_set_option_value', ['filetype', 'lua', { buf: scratch }]);
      await client.request('nvim_win_set_cursor', [0, [1, 4]]);
      const selection = () => client.request('nvim_exec_lua', ["return vim.fn.getregion(vim.fn.getpos('v'), vim.fn.getpos('.'), {type='v'})[1]", []]);
      await press('shift+down');
      await until(async () => await selection() === 'second');
      await press('shift+down');
      await until(async () => await selection() === 'third');
      await press('shift+up');
      await until(async () => await selection() === 'second');
      console.log('PASS: real syntax sibling navigation through terminal escape sequences');
    } else {
      await client.request('nvim_exec_lua', ["vim.keymap.set('x', '<Tab>', function() vim.g.key_move = 'next' end); vim.keymap.set('x', '<S-Tab>', function() vim.g.key_move = 'previous' end)", []]);
      await press('shift+down');
      await until(async () => await client.request('nvim_eval', ["get(g:, 'key_move', '')"]) === 'next');
      await press('shift+up');
      await until(async () => await client.request('nvim_eval', ["get(g:, 'key_move', '')"]) === 'previous');
    }
  } finally {
    await client.request('nvim_input', ['<Esc>']);
    await client.request('nvim_set_current_buf', [originalBuffer]);
    await client.request('nvim_buf_delete', [scratch, { force: true }]);
    keyConnection.dispose();
  }
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  await vscode.commands.executeCommand('neovimTerminal.open');
  assert.equal(vscode.window.terminals.length, 1, 'reopening reuses terminal');

  const dirty = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(other));
  await dirty.edit(edit => edit.insert(new vscode.Position(0, 0), 'unsaved '));
  const dirtyTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  // Error notifications are intentionally nonblocking; the dirty editor must remain open.
  await vscode.commands.executeCommand('neovimTerminal.open');
  assert.equal(vscode.window.terminals.length, 1);
  assert.ok(dirty.document.isDirty);
  assert.ok(vscode.window.tabGroups.all.some(group => group.tabs.includes(dirtyTab)));
  await dirty.document.save();

  await vscode.workspace.getConfiguration('neovimTerminal').update('autoOpen', true, vscode.ConfigurationTarget.Workspace);
  await vscode.commands.executeCommand('vscode.diff', uri, other, 'Test diff');
  await delay(300);
  assert.equal(vscode.window.terminals.length, 1, 'diff does not redirect');
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(other));
  await until(() => vscode.window.terminals.filter(item => item.name.startsWith('nvim:')).length === 2);
  await until(() => !vscode.window.tabGroups.all.some(group => group.tabs.some(tab =>
    tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === other.toString())));
  assert.equal(await fs.readFile(other.fsPath, 'utf8'), 'unsaved world\n');
  const connections = [];
  for (const item of vscode.window.terminals) {
    const args = (await fs.readFile(`/proc/${await item.processId}/cmdline`, 'utf8')).split('\0');
    connections.push(await connect(args[args.indexOf('--listen') + 1], new AbortController().signal));
  }
  const workbench = vscode.workspace.getConfiguration('workbench');
  try {
    await workbench.update('colorTheme', 'Light Modern', vscode.ConfigurationTarget.Global);
    await until(async () => (await connections[0].client.request('nvim_get_var', ['neovim_terminal_theme'])).name === 'Light Modern');
    const assertHints = async () => {
      const { contrast } = require('../theme');
      const hex = value => '#' + value.toString(16).padStart(6, '0');
      const normal = await connections[0].client.request('nvim_get_hl', [0, { name: 'Normal', link: false }]);
      for (const group of ['FlashLabel', 'FlashCurrentLabel']) {
        const hint = await connections[0].client.request('nvim_get_hl', [0, { name: group, link: false }]);
        assert.ok(contrast(hex(hint.fg), hex(hint.bg)) >= 4.5, `${group} text contrast`);
        assert.ok(contrast(hex(hint.bg), hex(normal.bg)) >= 3, `${group} background contrast`);
        assert.equal(hint.nocombine, true);
      }
      for (const group of ['Search', 'IncSearch', 'CurSearch', 'FlashCurrent', 'FlashMatch']) {
        const match = await connections[0].client.request('nvim_get_hl', [0, { name: group, link: false }]);
        assert.equal(match.bg, undefined, `${group} has no background`);
        assert.ok(contrast(hex(match.fg), hex(normal.bg)) >= 4.5, `${group} text contrast`);
      }
      if (process.env.NVIM_TEST_FULL_CONFIG) {
        const group = await connections[0].client.request('nvim_exec_lua', ["return require('flash.config').label.format({match={label='a'}, hl_group='FlashCurrent'})[1][2]", []]);
        assert.equal(group, 'FlashCurrentLabel', 'current hint keeps its chip');
        const selected = await connections[0].client.request('nvim_exec_lua', [`
          local format = require('flash.config').label.format
          local state = { target = { win = 1, pos = { 3, 4 } } }
          return {
            format({ state = state, match = { label = 'a', win = 1, pos = { 3, 4 } }, hl_group = 'FlashLabel' })[1][2],
            format({ state = state, match = { label = 'b', win = 1, pos = { 3, 9 } }, hl_group = 'FlashLabel' })[1][2],
          }
        `, []]);
        assert.deepEqual(selected, ['FlashCurrentLabel', 'FlashLabel'], 'selected result has a distinct hint for any match length');

      }
    };
    await assertHints();

    assert.equal((await connections[0].client.request('nvim_get_hl', [0, { name: 'Normal', link: false }])).bg, 0xffffff);
    await workbench.update('colorTheme', 'Dark+', vscode.ConfigurationTarget.Global);
    await until(async () => (await connections[0].client.request('nvim_get_var', ['neovim_terminal_theme'])).name === 'Dark+');
    assert.equal((await connections[0].client.request('nvim_get_hl', [0, { name: 'Normal', link: false }])).bg, 0x1e1e1e);
    await workbench.update('colorTheme', 'Monokai', vscode.ConfigurationTarget.Global);
    await until(async () => (await connections[0].client.request('nvim_get_var', ['neovim_terminal_theme'])).name === 'Monokai');
    assert.equal((await connections[0].client.request('nvim_get_hl', [0, { name: 'Normal', link: false }])).bg, 0x272822);
    await assertHints();
    await workbench.update('colorCustomizations', { 'editor.background': '#123456' }, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('editor').update('tokenColorCustomizations', { comments: '#559955' }, vscode.ConfigurationTarget.Global);
    for (const connection of connections) {
      await until(async () => (await connection.client.request('nvim_get_hl', [0, { name: 'Normal', link: false }])).bg === 0x123456);
      await until(async () => (await connection.client.request('nvim_get_hl', [0, { name: 'Comment', link: false }])).fg === 0x559955);
      assert.equal((await connection.client.request('nvim_get_hl', [0, { name: 'NormalFloat', link: false }])).bg > 0, true);
    }
    assert.equal(vscode.window.terminals.length, 2, 'theme changes update existing processes');
    const runFile = vscode.Uri.file(path.join(root, 'run current file.py'));
    const resultFile = path.join(root, 'ran.txt');
    await fs.writeFile(runFile.fsPath, 'raise Exception("stale file was run")\n');
    const runClient = connections[0].client;
    terminal.show();
    await until(() => vscode.window.activeTerminal === terminal);
    await runClient.request('nvim_cmd', [{ cmd: 'edit', args: [runFile.fsPath] }, {}]);
    await runClient.request('nvim_buf_set_lines', [0, 0, -1, false, [
      'from pathlib import Path', `Path(${JSON.stringify(resultFile)}).write_text("ran latest Neovim buffer")`,
    ]]);
    await until(async () => await vscode.commands.executeCommand('neovimTerminal.currentFile') === runFile.fsPath);
    let runner;
    if (!process.env.NVIM_TEST_PYTHON_EXTENSION) {
      runner = vscode.commands.registerCommand('python.execInDedicatedTerminal', async file => {
        assert.equal(file.fsPath, runFile.fsPath, 'runner receives actual current buffer URI');
        const { execFile } = require('node:child_process');
        const { promisify } = require('node:util');
        await promisify(execFile)('python3', [file.fsPath]);
      });
    }
    try {
      await vscode.commands.executeCommand('neovimTerminal.run');
      await until(async () => {
        try { return await fs.readFile(resultFile, 'utf8') === 'ran latest Neovim buffer'; } catch { return false; }
      });
      assert.ok((await fs.readFile(runFile.fsPath, 'utf8')).includes('write_text'));
      console.log('PASS: current buffer switch, save, explicit file URI, real Python execution');
    } finally { runner?.dispose(); }
    const jsFile = vscode.Uri.file(path.join(root, 'run-current.js'));
    const jsResult = path.join(root, 'ran-javascript.txt');
    await fs.writeFile(jsFile.fsPath, `require('node:fs').writeFileSync(${JSON.stringify(jsResult)}, 'ran current JavaScript');\n`);
    await fs.writeFile(path.join(root, '.vscode/launch.json'), JSON.stringify({
      version: '0.2.0', configurations: [{ name: 'Run current file', type: 'node', request: 'launch',
        program: '${file}', runtimeExecutable: '/home/linuxbrew/.linuxbrew/bin/node', console: 'internalConsole' }],
    }));
    terminal.show();
    await until(() => vscode.window.activeTerminal === terminal);
    await runClient.request('nvim_cmd', [{ cmd: 'edit', args: [jsFile.fsPath] }, {}]);
    await vscode.commands.executeCommand('neovimTerminal.run');
    await until(async () => {
      try { return await fs.readFile(jsResult, 'utf8') === 'ran current JavaScript'; } catch { return false; }
    });
    assert.ok(!vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === jsFile.toString())), 'temporary run preview is cleaned up');
    console.log('PASS: generic Run Without Debugging resolves ${file} to current Neovim file');
    terminal.show();
    await until(() => vscode.window.activeTerminal === terminal);
    await runClient.request('nvim_cmd', [{ cmd: 'edit', args: [uri.fsPath] }, {}]);

  } finally {
    for (const connection of connections) connection.dispose();
  }

  terminal.dispose();
  await until(() => vscode.window.terminals.filter(item => item.name.startsWith('nvim:')).length === 1);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  await until(() => vscode.window.terminals.filter(item => item.name.startsWith('nvim:')).length === 2);
  await until(() => !vscode.window.tabGroups.all.some(group => group.tabs.some(tab =>
    tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString())));

  await vscode.workspace.getConfiguration('neovimTerminal').update('autoOpen', false, vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.getConfiguration('neovimTerminal').update('executable', '/nonexistent/nvim', vscode.ConfigurationTarget.Global);
  const failure = vscode.Uri.file(path.join(root, 'startup-failure.txt'));
  await fs.writeFile(failure.fsPath, 'keep me\n');
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(failure));
  const failureTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  await vscode.commands.executeCommand('neovimTerminal.open');
  assert.ok(vscode.window.tabGroups.all.some(group => group.tabs.includes(failureTab)), 'failed startup preserves source tab');
  assert.equal(await fs.readFile(failure.fsPath, 'utf8'), 'keep me\n');
  for (const item of vscode.window.terminals) item.dispose();
  console.log('PASS: real editor terminal, file path, reuse, dirty protection, diff exclusion, automatic redirection, close/reopen, failed startup, live theme and customization sync across two instances');
}

module.exports = { run };
