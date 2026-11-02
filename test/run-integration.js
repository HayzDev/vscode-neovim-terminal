const { execFileSync } = require('node:child_process');
const { runTests } = require('@vscode/test-electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nvim-vscode-test-'));
  try {
    const workspace = path.join(directory, 'workspace');
    await fs.mkdir(path.join(workspace, '.vscode'), { recursive: true });
    // Use the real terminal process with a clean config so personal plugins cannot affect assertions.
    const executable = path.join(directory, 'nvim-clean');
    const nvim = execFileSync('which', ['nvim'], { encoding: 'utf8' }).trim();
    await fs.writeFile(executable, `#!/bin/sh\nexec '${nvim.replaceAll("'", "'\"'\"'")}' ${process.env.NVIM_TEST_FULL_CONFIG ? '' : '--clean'} "$@"\n`, { mode: 0o700 });
    await fs.mkdir(path.join(directory, 'profile/User'), { recursive: true });
    await fs.writeFile(path.join(directory, 'profile/User/settings.json'), JSON.stringify({
      'neovimTerminal.autoOpen': false,
      'neovimTerminal.sharedProcess': Boolean(process.env.NVIM_TEST_FEATURES),
      'neovimTerminal.restoreSession': Boolean(process.env.NVIM_TEST_FEATURES),
      'neovimTerminal.executable': executable,
      'security.workspace.trust.enabled': false,
      'python.defaultInterpreterPath': '/home/linuxbrew/.linuxbrew/bin/python3',
      'python.useEnvironmentsExtension': false,
      'python.experiments.enabled': false,
    }));
    const run = phase => runTests({
      vscodeExecutablePath: '/usr/share/code-insiders/code-insiders',
      extensionDevelopmentPath: [path.resolve(__dirname, '..'), ...(process.env.NVIM_TEST_PYTHON_EXTENSION ? [process.env.NVIM_TEST_PYTHON_EXTENSION] : [])],
      extensionTestsPath: path.join(__dirname, process.env.NVIM_TEST_FEATURES ? 'features.js' : 'integration.js'),
      extensionTestsEnv: { NVIM_TEST_PHASE: String(phase) },
      launchArgs: [workspace, '--user-data-dir', path.join(directory, 'profile'),
        '--extensions-dir', path.join(directory, 'extensions'), '--disable-extensions',
        '--disable-workspace-trust', '--ozone-platform=x11', '--no-sandbox', '--skip-welcome', '--skip-release-notes'],
    });
    await run(1);
    if (process.env.NVIM_TEST_FEATURES) { await run(2); await run(3); }
  } finally {
    const processes = execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' }).split('\n');
    for (const line of processes) {
      if (line.includes(directory + '/workspace') && /nvim .*--headless.*--listen/.test(line)) {
        try { process.kill(Number(line.trim().split(/\s+/)[0]), 'SIGKILL'); } catch {}
      }
    }
    if (process.env.NVIM_KEEP_TEST_DIR) console.log('Test directory:', directory);
    else await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
