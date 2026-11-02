const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { socketPath } = require('../transport');

test('transport uses local Unix sockets or unique Windows named pipes', () => {
  assert.equal(socketPath('/tmp/private', 'linux'), path.join('/tmp/private', 'nvim.sock'));
  assert.equal(socketPath('/tmp/private', 'darwin'), path.join('/tmp/private', 'nvim.sock'));
  const pipe = socketPath('C:\\Temp', 'win32');
  assert.ok(pipe.startsWith('\\\\.\\pipe\\vscode-nvim-'));
  assert.notEqual(pipe, socketPath('C:\\Temp', 'win32'));
});
