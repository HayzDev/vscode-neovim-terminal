const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');
const { attach } = require('neovim');
const { PassThrough } = require('node:stream');

async function connect(socketPath, signal) {
  const deadline = Date.now() + 15000;
  while (!signal.aborted && Date.now() < deadline) {
    const socket = net.createConnection(socketPath);
    const connected = await new Promise(resolve => {
      socket.once('connect', () => resolve(true));
      socket.once('error', () => resolve(false));
    });
    if (connected) {
      // Keep the client's reader ending normally when a terminal is killed.
      const reader = new PassThrough();
      socket.pipe(reader);
      socket.once('close', () => reader.end());
      const client = attach({ reader, writer: socket, options: { logger: {
        debug() {}, info() {}, warn: console.warn.bind(console), error: console.error.bind(console),
      } } });
      let disconnected = false;
      const waiting = new Set();
      const detach = () => {
        disconnected = true;
        for (const reject of waiting) reject(new Error('Neovim disconnected. Reopen the file to reconnect.'));
        waiting.clear();
      };
      client.on('disconnect', detach);
      const request = client.request.bind(client);
      client.request = (method, args) => new Promise((resolve, reject) => {
        if (disconnected) { reject(new Error('Neovim disconnected. Reopen the file to reconnect.')); return; }
        waiting.add(reject);
        request(method, args).then(resolve, reject).finally(() => waiting.delete(reject));
      });
      const dispose = () => {
        detach();
        signal.removeEventListener('abort', dispose);
        socket.unpipe(reader);
        reader.end();
        socket.destroy();
      };
      signal.addEventListener('abort', dispose, { once: true });
      let timer;
      try {
        const ready = async () => {
          while (!(await client.request('nvim_eval', ['v:vim_did_enter']))) {
            await delay(50, undefined, { signal });
          }
        };
        await Promise.race([
          ready(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Neovim did not finish starting within 15 seconds.')),
              Math.max(1, deadline - Date.now()));
          }),
        ]);
        signal.throwIfAborted();
        return { client, dispose };
      } catch (error) {
        dispose();
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    socket.destroy();
    await delay(100, undefined, { signal });
  }
  signal.throwIfAborted();
  throw new Error('Could not connect to Neovim within 15 seconds. Check the executable path and terminal output.');
}

module.exports = { connect };
