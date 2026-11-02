const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { connect } = require('../rpc');
const { socketPath } = require('../transport');
const { backend } = require('../backend');

test('reattaching a workspace backend corrects changed cwd without changing its buffer', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nvim-root-'));
  const workspace=path.join(root,'workspace'), elsewhere=path.join(root,'elsewhere');
  await fs.mkdir(workspace);await fs.mkdir(elsewhere);
  const file=path.join(workspace,'example.txt');await fs.writeFile(file,'original\n');
  const socket=socketPath(root);
  const child=spawn('nvim',['--clean','--headless','--listen',socket,'--',file],{cwd:elsewhere});
  let control,reused;
  try {
    control=await connect(socket,new AbortController().signal);
    await control.client.request('nvim_buf_set_lines',[0,0,-1,false,['unsaved']]);
    const store={state:{backends:{[workspace]:{socket,pid:child.pid,directory:root}}}};
    reused=await backend('nvim',{fsPath:file},workspace,store);
    assert.equal(reused.reused,true);
    assert.equal(path.normalize(await reused.connection.client.call('getcwd')),workspace);
    assert.equal(await reused.connection.client.getVar('neovim_terminal_workspace'),workspace);
    assert.deepEqual(await reused.connection.client.request('nvim_buf_get_lines',[0,0,-1,false]),['unsaved']);
  } finally {
    reused?.connection.dispose();control?.dispose();
    const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;
    await fs.rm(root,{recursive:true,force:true});
  }
});
