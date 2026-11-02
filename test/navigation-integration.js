const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { connect } = require('../rpc');
async function until(check, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await delay(20); }
  throw Error('Timed out: ' + label);
}
async function run() {
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const first = vscode.Uri.file(path.join(root, 'first.txt'));
  const second = vscode.Uri.file(path.join(root, 'second.txt'));
  await fs.writeFile(first.fsPath, 'first\n'); await fs.writeFile(second.fsPath, 'second\n');
  await vscode.extensions.getExtension('xander-local.neovim-terminal').activate();
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(first));
  await until(() => vscode.window.terminals.some(t => t.name === 'nvim: first.txt'), 'first terminal title');
  const terminal = vscode.window.terminals.find(t => t.name === 'nvim: first.txt');
  const store = path.join(process.env.NVIM_NAV_PROFILE, 'User', 'workspaceStorage');
  let socket;
  await until(async () => {
    for (const directory of await fs.readdir(store)) {
      try {
        const state = JSON.parse(await fs.readFile(path.join(store, directory, 'xander-local.neovim-terminal', 'session.json'), 'utf8'));
        socket = Object.values(state.backends)[0]?.socket;
        if (socket) return true;
      } catch {}
    }
  }, 'test backend socket');
  const c = await connect(socket, new AbortController().signal);
  let other;
  try {
    const started = performance.now();
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(second));
    await until(() => terminal.name === 'nvim: second.txt' && vscode.window.activeTerminal === terminal, 'warm redirect/title');
    console.log('WARM OPEN ms=' + Math.round(performance.now() - started));
    assert.equal(path.normalize(await c.client.request('nvim_buf_get_name', [0])), second.fsPath);
    other = vscode.window.createTerminal({ name: 'leave this title alone' });
    other.show();
    await until(() => vscode.window.activeTerminal === other, 'unrelated terminal focus');
    await c.client.request('nvim_cmd', [{ cmd: 'buffer', args: [first.fsPath] }, {}]);
    await until(() => terminal.name === 'nvim: first.txt', 'background terminal title');
    assert.equal(other.name, 'leave this title alone');
    await c.client.request('nvim_buf_set_lines', [0, 0, -1, false, ['unsaved first']]);
    await until(() => terminal.name === 'nvim: first.txt *', 'modified title');
    await c.client.request('nvim_command', ['write']);
    await until(() => terminal.name === 'nvim: first.txt', 'saved title');
    for (const uri of [first, second, first, second]) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    await until(async () => terminal.name === 'nvim: second.txt' && path.normalize(await c.client.request('nvim_buf_get_name', [0])) === second.fsPath, 'latest open wins');
    console.log('PASS native VS Code: foreground/background titles, dirty/save title, warm redirect, rapid opens');
  } finally {
    other?.dispose();
    await c.client.command('qa!').catch(() => {}); c.dispose();
    terminal.dispose();
  }
}
module.exports = { run };
