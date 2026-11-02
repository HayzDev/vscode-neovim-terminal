const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('Unix installer installs a VSIX with spaces and propagates CLI errors', { skip: process.platform === 'win32' }, async () => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nvim-installer-')));
  try {
    const cli = path.join(directory, 'fake code');
    const vsix = path.join(directory, 'extension with spaces.vsix');
    const log = path.join(directory, 'arguments.json');
    await fs.writeFile(vsix, 'fixture');
    await fs.writeFile(cli, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.INSTALL_LOG, JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.INSTALL_EXIT || 0));\n`, { mode: 0o700 });
    const script = path.resolve(__dirname, '../scripts/install.sh');
    const run = (extra = {}) => spawnSync('bash', [script, '--code', cli, '--vsix', vsix], { encoding: 'utf8', env: { ...process.env, INSTALL_LOG: log, ...extra } });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await fs.readFile(log, 'utf8')), ['--install-extension', vsix, '--force']);
    assert.equal(run({ INSTALL_EXIT: '7' }).status, 7);
    assert.notEqual(spawnSync('bash', [script, '--code'], { encoding: 'utf8' }).status, 0);
    assert.notEqual(spawnSync('bash', [script, '--code', cli, '--vsix', path.join(directory, 'missing.vsix')], { encoding: 'utf8' }).status, 0);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('Windows installer handles VSIX paths with spaces and CLI failures', { skip: process.platform !== 'win32' }, async () => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nvim-installer-')));
  try {
    const cli = path.join(directory, 'fake code.cmd');
    const vsix = path.join(directory, 'extension with spaces.vsix');
    const log = path.join(directory, 'arguments.txt');
    await fs.writeFile(vsix, 'fixture');
    await fs.writeFile(cli, '@echo off\r\necho %* > "%INSTALL_LOG%"\r\nexit /b %INSTALL_EXIT%\r\n');
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(__dirname, '../scripts/install.ps1'), '-Code', cli, '-Vsix', vsix];
    const run = code => spawnSync('powershell.exe', args, { encoding: 'utf8', env: { ...process.env, INSTALL_LOG: log, INSTALL_EXIT: String(code) } });
    const result = run(0);
    assert.equal(result.status, 0, result.stderr);
    const received = await fs.readFile(log, 'utf8');
    assert.ok(received.includes('--install-extension'));
    assert.ok(received.includes(vsix));
    assert.ok(received.includes('--force'));
    assert.notEqual(run(7).status, 0);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
