async function closeSession(vscode, session, documents) {
  if (!session) return false;
  await documents.flush();
  const dirty = [...documents.records.values()].filter(record => record.session === session && record.document.isDirty);
  if (dirty.length) {
    const choices = ['Save All and Close', ...(session.shared ? ['Keep in Background'] : [])];
    const choice = await vscode.window.showWarningMessage(`${dirty.length} unsaved Neovim file(s).`, { modal: true }, ...choices);
    if (!choice) return false;
    if (choice === 'Save All and Close') {
      await session.client.command('wall');
      await documents.flush();
    }
  }
  session.terminal.dispose();
  return true;
}
module.exports = { closeSession };
