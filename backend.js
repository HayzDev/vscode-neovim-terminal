const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { connect } = require('./rpc');
const { socketPath } = require('./transport');

async function backend(executable, uri, cwd, store) {
  const saved = store.state.backends[cwd];
  if (saved) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      if (process.platform !== 'win32') await fs.access(saved.socket);
      const connection = await connect(saved.socket, controller.signal);
      clearTimeout(timer);
      await connection.client.request('nvim_exec_lua', [
        'local cwd = ...; vim.api.nvim_set_current_dir(cwd); vim.g.neovim_terminal_workspace = cwd', [cwd],
      ]);
      return { ...saved, connection, reused: true };
    } catch { clearTimeout(timer); controller.abort(); }
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-nvim-'));
  await fs.chmod(directory, 0o700);
  const socket = socketPath(directory);
  const log = await fs.open(path.join(directory, 'server.log'), 'a', 0o600);
  const child = spawn(executable, ['-n', '--headless', '--listen', socket, '--', uri.fsPath], {
    cwd, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd],
  });
  const started = new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  try { await started; } finally { await log.close(); }
  child.unref();
  const connection = await connect(socket, new AbortController().signal);
  await connection.client.request('nvim_exec_lua', [
    'local cwd = ...; vim.api.nvim_set_current_dir(cwd); vim.g.neovim_terminal_workspace = cwd', [cwd],
  ]);
  const info = { directory, socket, pid: child.pid };
  store.state.backends[cwd] = info;
  await store.persist();
  return { ...info, connection, reused: false };
}

module.exports = { backend };
