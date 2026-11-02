const { socketPath } = require('../transport');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Documents, hash } = require('../documents');
const { connect } = require('../rpc');

test('snapshots persist privately and recovery never overwrites a changed disk file', async () => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nvim-recovery-')));
  const file = path.join(directory, 'example.lua');
  await fs.writeFile(file, 'original\n');
  const context = { storageUri: { fsPath: path.join(directory, 'storage') },
    globalStorageUri: { fsPath: path.join(directory, 'global') }, subscriptions: [] };
  const noop = () => ({ dispose() {} });
  const vscode = { workspace: { onDidChangeTextDocument: noop, onDidSaveTextDocument: noop },
    window: { showWarningMessage: () => {} } };
  const documents = new Documents(vscode, context, error => { throw error; });
  documents.state.buffers[file] = { path: file, cwd: directory, modified: true,
    text: 'unsaved backup\nsecond line\n', diskHash: hash('original\n'), cursor: [2, 3] };
  documents.state.active[directory] = { path: file, cursor: [2, 3] };
  await documents.persist();
  if (process.platform !== 'win32') assert.equal((await fs.stat(documents.statePath)).mode & 0o777, 0o600);
  const loaded = new Documents(vscode, context, error => { throw error; });
  await loaded.load();
  assert.equal(loaded.state.buffers[file].text, 'unsaved backup\nsecond line\n');
  const socket = socketPath(directory);
  const child = spawn('nvim', ['--clean', '--headless', '--listen', socket, '--', file]);
  let connection;
  try {
    connection = await connect(socket, new AbortController().signal);
    await documents.restore({ cwd: directory, client: connection.client });
    const buffer = await connection.client.request('nvim_call_function', ['bufnr', [file]]);
    assert.deepEqual(await connection.client.request('nvim_buf_get_lines', [buffer, 0, -1, false]), ['unsaved backup', 'second line']);
    assert.equal(await connection.client.request('nvim_get_option_value', ['modified', { buf: buffer }]), true);
    assert.deepEqual(await connection.client.request('nvim_buf_get_mark', [buffer, '"']), [2, 3]);
    await fs.writeFile(file, 'external changes\n');
    // A fresh server after a crash has only disk contents. Verify recovery against it.
    await connection.client.request('nvim_buf_set_lines', [buffer, 0, -1, false, ['external changes']]);
    await connection.client.request('nvim_set_option_value', ['modified', false, { buf: buffer }]);
    await loaded.restore({ cwd: directory, client: connection.client });
    assert.equal(await fs.readFile(file, 'utf8'), 'external changes\n');
    const recovered = loaded.state.active[directory].path;
    assert.notEqual(recovered, file);
    assert.equal(await fs.readFile(recovered, 'utf8'), 'unsaved backup\nsecond line\n');
    if (process.platform !== 'win32') assert.equal((await fs.stat(recovered)).mode & 0o777, 0o600);
    assert.equal(loaded.state.buffers[file], undefined);
  } finally {
    connection?.dispose(); child.kill();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('failed native mirror save preserves recovery and never acknowledges a saved buffer', async () => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nvim-save-conflict-'));
  const file=path.join(directory,'example.txt');await fs.writeFile(file,'same text\n');
  const document={uri:{fsPath:file},isDirty:true,getText:()=> 'same text\n',save:async()=>false};
  const noop=()=>({dispose(){}});
  const vscode={workspace:{onDidChangeTextDocument:noop,onDidSaveTextDocument:noop,openTextDocument:async()=>document},
    Uri:{file:filename=>({fsPath:filename})},window:{showWarningMessage(){}}};
  const context={storageUri:{fsPath:path.join(directory,'state')},globalStorageUri:{fsPath:path.join(directory,'global')},subscriptions:[]};
  const docs=new Documents(vscode,context,error=>{throw error});
  const session={cwd:directory};
  docs.records.set(file,{session,buf:1,document,text:'same text\n'});
  let acknowledged=false;docs.toNeovim=async()=>{acknowledged=true};
  try {
    await assert.rejects(docs.mirror(session,{path:file,buf:1,buftype:'',text:'same text\n',modified:false,cursor:[1,0]}),/could not save|could not confirm/i);
    assert.equal(acknowledged,false);
    const copies=await fs.readdir(path.join(directory,'global','recovered'));
    assert.equal(copies.length,1);
    assert.equal(await fs.readFile(path.join(directory,'global','recovered',copies[0]),'utf8'),'same text\n');
    assert.equal(await fs.readFile(file,'utf8'),'same text\n');
  } finally {await fs.rm(directory,{recursive:true,force:true})}
});

test('clean stale snapshots do not dirty native documents with newer disk contents', async () => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nvim-stale-clean-'));
  const file=path.join(directory,'example.txt');await fs.writeFile(file,'new disk text\n');
  const noop=()=>({dispose(){}});
  let opened=0,refreshed=0;
  const vscode={workspace:{onDidChangeTextDocument:noop,onDidSaveTextDocument:noop,openTextDocument:async()=>{opened++;throw Error('stale clean content must not be mirrored')}},Uri:{file:f=>({fsPath:f})}};
  const context={storageUri:{fsPath:path.join(directory,'state')},globalStorageUri:{fsPath:path.join(directory,'global')},subscriptions:[]};
  const docs=new Documents(vscode,context,error=>{throw error});
  try {
    await docs.mirror({cwd:directory,client:{request:async()=>{refreshed++;return true}}},{path:file,buf:1,buftype:'',text:'old text\n',modified:false,cursor:[1,0]});
    assert.equal(opened,0);assert.equal(refreshed,1);
    assert.equal(await fs.readFile(file,'utf8'),'new disk text\n');
    assert.equal(docs.state.buffers[file],undefined,'do not persist stale clean state over newer contents');
  } finally {await fs.rm(directory,{recursive:true,force:true})}
});

test('startup restoration defers a workspace with dirty native documents even when snapshots match', () => {
  const noop=()=>({dispose(){}});
  const file=path.resolve('workspace','example.txt'),cwd=path.dirname(file);
  const document={uri:{fsPath:file,scheme:'file'},isDirty:true,getText:()=> 'saved snapshot'};
  const vscode={workspace:{textDocuments:[document],onDidChangeTextDocument:noop,onDidSaveTextDocument:noop}};
  const docs=new Documents(vscode,{globalStorageUri:{fsPath:os.tmpdir()},subscriptions:[]},()=>{});
  docs.state.buffers[file]={cwd,modified:true,text:'saved snapshot'};
  assert.equal(docs.canRestore(cwd),false);
  assert.equal(docs.canRestore(path.resolve('other-workspace')),true);
  document.isDirty=false;
  assert.equal(docs.canRestore(cwd),true);
});

test('startup also defers dirty restored tabs whose text model is not loaded yet', () => {
  const noop=()=>({dispose(){}});const file=path.resolve('workspace','background.txt');
  const vscode={workspace:{textDocuments:[],onDidChangeTextDocument:noop,onDidSaveTextDocument:noop},window:{tabGroups:{all:[{tabs:[{isDirty:true,input:{uri:{fsPath:file,scheme:'file'}}}]}]}}};
  const docs=new Documents(vscode,{globalStorageUri:{fsPath:os.tmpdir()},subscriptions:[]},()=>{});
  assert.equal(docs.canRestore(path.dirname(file)),false);
});

test('stale clean buffer refresh follows disk and never replaces edits made after its snapshot', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nvim-clean-refresh-'));
  const file=path.join(dir,'example.txt');await fs.writeFile(file,'old text\n');
  const socket=socketPath(dir);const child=spawn('nvim',['-n','--clean','--headless','--listen',socket,'--',file]);let c;
  const noop=()=>({dispose(){}});
  const docs=new Documents({workspace:{onDidChangeTextDocument:noop,onDidSaveTextDocument:noop,openTextDocument:async()=>{throw Error('must not dirty native model')}}},{globalStorageUri:{fsPath:path.join(dir,'state')},subscriptions:[]},error=>{throw error});
  try {
    c=await connect(socket,new AbortController().signal);
    const snapshot={path:file,buf:await c.client.request('nvim_get_current_buf',[]),text:'old text\n',buftype:'',modified:false};
    await fs.writeFile(file,'newer disk content\n');const future=new Date(Date.now()+2000);await fs.utimes(file,future,future);
    await docs.mirror({cwd:dir,client:c.client},snapshot);
    assert.deepEqual(await c.client.request('nvim_buf_get_lines',[snapshot.buf,0,-1,false]),['newer disk content']);
    await c.client.request('nvim_buf_set_lines',[snapshot.buf,0,-1,false,['unsaved work']]);
    await docs.mirror({cwd:dir,client:c.client},snapshot);
    assert.deepEqual(await c.client.request('nvim_buf_get_lines',[snapshot.buf,0,-1,false]),['unsaved work']);
    assert.equal(await c.client.request('nvim_get_option_value',['modified',{buf:snapshot.buf}]),true);
    assert.equal(await fs.readFile(file,'utf8'),'newer disk content\n');
  } finally {c?.dispose();const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;await fs.rm(dir,{recursive:true,force:true})}
});
