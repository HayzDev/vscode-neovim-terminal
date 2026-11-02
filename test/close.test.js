const { test } = require('node:test');
const assert = require('node:assert/strict');
const { closeSession } = require('../close');

test('safe close cancels, saves, or detaches without forcing writes', async () => {
  for (const choice of [undefined, 'Save All and Close', 'Keep in Background']) {
    let closed = false, saved = false;
    const session = { shared: true, terminal: { dispose: () => { closed = true; } },
      client: { command: async command => { assert.equal(command, 'wall'); saved = true; } } };
    const documents = { flush: async () => {}, records: new Map([['file', { session, document: { isDirty: true } }]]) };
    await closeSession({ window: { showWarningMessage: async () => choice } }, session, documents);
    assert.equal(closed, Boolean(choice));
    assert.equal(saved, choice === 'Save All and Close');
  }
  let closed = false;
  const session = { shared: true, terminal: { dispose: () => { closed = true; } },
    client: { command: async () => { throw new Error('write failed'); } } };
  const documents = { flush: async () => {}, records: new Map([['file', { session, document: { isDirty: true } }]]) };
  await assert.rejects(closeSession({ window: { showWarningMessage: async () => 'Save All and Close' } }, session, documents), /write failed/);
  assert.equal(closed, false);
});
