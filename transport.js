const path = require('node:path');
const { randomUUID } = require('node:crypto');

function socketPath(directory, platform = process.platform) {
  return platform === 'win32' ? `\\\\.\\pipe\\vscode-nvim-${randomUUID()}` : path.join(directory, 'nvim.sock');
}

module.exports = { socketPath };
