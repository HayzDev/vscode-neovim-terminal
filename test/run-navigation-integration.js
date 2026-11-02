const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');
(async () => {
  delete process.env.ELECTRON_RUN_AS_NODE;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nvim-native-nav-'));
  const profile = path.join(dir, 'profile');
  const workspace = path.join(dir, 'workspace');
  await fs.mkdir(path.join(profile, 'User'), { recursive: true });
  await fs.mkdir(workspace);
  await fs.writeFile(path.join(profile, 'User', 'settings.json'), JSON.stringify({
    'neovimTerminal.autoOpen': true, 'neovimTerminal.restoreSession': false,
    'neovimTerminal.executable': process.env.NVIM_NAV_EXECUTABLE || 'nvim',
    'security.workspace.trust.enabled': false,
    'terminal.integrated.fontFamily': "'Mononoki Nerd Font Mono', monospace",
    'terminal.integrated.tabs.title': '${sequence}',
  }));
  console.log('Native navigation fixture: ' + dir);
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_NAV_EXECUTABLE,
    extensionDevelopmentPath: path.resolve(__dirname, '..'),
    extensionTestsPath: path.join(__dirname, 'navigation-integration.js'),
    extensionTestsEnv: { NVIM_APPNAME: 'neovim-terminal-nav-test', NVIM_NAV_PROFILE: profile },
    launchArgs: [workspace, '--user-data-dir', profile, '--extensions-dir', path.join(dir, 'extensions'),
      '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
