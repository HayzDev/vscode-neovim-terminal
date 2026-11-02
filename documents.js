const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

class Documents {
  constructor(vscode, context, report) {
    this.vscode = vscode;
    this.context = context;
    this.report = report;
    this.state = { buffers: {}, backends: {}, active: {} };
    this.statePath = path.join((context.storageUri || context.globalStorageUri).fsPath, 'session.json');
    this.records = new Map();
    this.queues = new Map();
    this.applying = new Set();
    this.writes = Promise.resolve();
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        if (!event.contentChanges.length || this.applying.has(event.document.uri.fsPath)) return;
        const record = this.records.get(event.document.uri.fsPath);
        if (record) void this.toNeovim(record, event.document.getText(), false).catch(report);
      }),
      vscode.workspace.onDidSaveTextDocument(document => {
        if (this.applying.has(document.uri.fsPath)) return;
        const record = this.records.get(document.uri.fsPath);
        if (record) void this.toNeovim(record, document.getText(), true).catch(report);
      }),
    );
  }

  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      if (!data.buffers || !data.backends || !data.active) throw new Error(`Invalid session snapshot: ${this.statePath}`);
      this.state = data;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  persist() {
    const snapshot = JSON.stringify(this.state);
    this.writes = this.writes.catch(this.report).then(async () => {
      const directory = path.dirname(this.statePath);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.chmod(directory, 0o700);
      const temporary = this.statePath + '.' + crypto.randomUUID() + '.tmp';
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(snapshot); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, this.statePath);
    });
    return this.writes;
  }

  // shortcut: snapshots copy whole buffers; use incremental patches if large files make typing slow.
  receive(session, snapshot) {
    if (snapshot.buftype !== '' || typeof snapshot.text !== 'string') return Promise.resolve();
    if (snapshot.path) snapshot = { ...snapshot, path: this.vscode.Uri.file(snapshot.path).fsPath };
    if (!snapshot.path) {
      if (!snapshot.modified) return Promise.resolve();
      const id = session.backendPid || hash(session.key).slice(0, 12);
      snapshot = { ...snapshot, unnamed: true,
        path: path.join(path.dirname(this.statePath), 'untitled', `${id}-${snapshot.buf}.txt`) };
      if (session.file?.buf === snapshot.buf) this.state.active[session.cwd] = { path: snapshot.path, cursor: snapshot.cursor };
    }
    if (!path.isAbsolute(snapshot.path)) return Promise.resolve();
    const previous = this.queues.get(snapshot.path) || Promise.resolve();
    const next = previous.catch(this.report).then(() => this.mirror(session, snapshot));
    this.queues.set(snapshot.path, next);
    return next;
  }

  async mirror(session, snapshot) {
    const vscode = this.vscode;
    const file = snapshot.path;
    if (snapshot.unnamed) await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    let disk;
    try { disk = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; disk = ''; }
    const known = this.records.get(file);
    if (known?.pendingText !== undefined && known.pendingText !== snapshot.text) return;
    const old = this.state.buffers[file];
    this.state.buffers[file] = { path: file, cwd: session.cwd, cursor: snapshot.cursor, unnamed: Boolean(snapshot.unnamed),
      modified: snapshot.modified, ...(snapshot.modified ? { text: snapshot.text } : {}),
      diskHash: snapshot.modified && old?.modified ? old.diskHash : hash(disk) };
    await this.persist();
    const exists = await fs.access(file).then(() => true, () => false);
    const document = await vscode.workspace.openTextDocument(exists ? vscode.Uri.file(file) : vscode.Uri.file(file).with({ scheme: 'untitled' }));
    let record = this.records.get(file);
    if (!record) {
      if (document.isDirty && document.getText() !== snapshot.text && !(!exists && document.getText() === '')) {
        await this.recover(file, snapshot.text);
        throw new Error(`Unsaved VS Code edits conflict with Neovim: ${file}. A separate recovery copy was saved.`);
      }
      record = { session, buf: snapshot.buf, document, text: document.getText() };
      this.records.set(file, record);
    }
    if (record.pendingText !== undefined && record.pendingText !== snapshot.text) return;
    record.pendingText = undefined;
    record.document = document;
    record.session = session;
    record.buf = snapshot.buf;
    this.applying.add(file);
    try {
      if (document.getText() !== snapshot.text) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), snapshot.text);
        const eol = snapshot.fileformat === 'dos' ? vscode.EndOfLine.CRLF : vscode.EndOfLine.LF;
        if (document.eol !== eol) edit.set(document.uri, [...edit.get(document.uri), vscode.TextEdit.setEndOfLine(eol)]);
        if (!await vscode.workspace.applyEdit(edit)) throw new Error(`Could not mirror Neovim edits: ${file}`);
      }
      record.text = document.getText();
      // Neovim already wrote these exact bytes; mark the matching VS Code copy clean.
      if (!snapshot.modified && document.isDirty && disk === snapshot.text) {
        await document.save();
        await this.toNeovim(record, document.getText(), true);
      }
    } finally { this.applying.delete(file); }
  }

  async toNeovim(record, text, saved) {
    if (record.text === text && !saved) return;
    record.text = text;
    record.pendingText = text;
    const entry = this.state.buffers[record.document?.uri.fsPath];
    if (entry) { entry.text = text; entry.modified = !saved; void this.persist().catch(this.report); }
    await record.session.client.request('nvim_exec_lua', [`
      local buf, text, saved, format = ...
      if not vim.api.nvim_buf_is_valid(buf) then return end
      local eol = text:sub(-1) == '\\n'
      if eol then text = text:sub(1, -2) end
      local lines = vim.split(text, '\\n', { plain = true })
      vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
      vim.bo[buf].endofline = eol
      vim.bo[buf].fileformat = format
      if saved then
        vim.bo[buf].modified = false
        vim.bo[buf].autoread = true
        vim.api.nvim_buf_call(buf, function() vim.cmd('checktime') end)
      end
    `, [record.buf, text.replace(/\r\n/g, '\n'), saved, text.includes('\r\n') ? 'dos' : 'unix']]);
  }

  async recover(original, text) {
    const directory = path.join(this.context.globalStorageUri.fsPath, 'recovered');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const target = path.join(directory, `${Date.now()}-${crypto.randomUUID()}-${path.basename(original)}`);
    await fs.writeFile(target, text, { mode: 0o600, flag: 'wx' });
    void this.vscode.window.showWarningMessage(`Recovered unsaved Neovim content to ${target}. The original file was left unchanged.`);
    return target;
  }

  async restore(session, onlyPath) {
    const entries = Object.values(this.state.buffers).filter(file => file.cwd === session.cwd && (!onlyPath || file.path === onlyPath));
    for (const entry of entries) {
      let file = entry.path;
      let disk;
      try { disk = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; disk = ''; }
      if (entry.modified && hash(disk) !== entry.diskHash) {
        file = await this.recover(file, entry.text);
        delete this.state.buffers[entry.path];
        if (this.state.active[session.cwd]?.path === entry.path) this.state.active[session.cwd].path = file;
      }
      const buf = await session.client.request('nvim_call_function', ['bufadd', [file]]);
      await session.client.request('nvim_call_function', ['bufload', [buf]]);
      if (entry.modified && file === entry.path) {
        await this.toNeovim({ session, buf }, entry.text, false);
      }
      if (entry.cursor) {
        const count = await session.client.request('nvim_buf_line_count', [buf]);
        const row = Math.max(1, Math.min(entry.cursor[0], count));
        await session.client.request('nvim_buf_set_mark', [buf, '"', row, entry.cursor[1], {}]);
      }
    }
    await this.persist();
  }

  async flush() { await Promise.allSettled(this.queues.values()); await this.persist(); }
}

module.exports = { Documents, hash };
