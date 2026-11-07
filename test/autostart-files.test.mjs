import test from 'node:test';
import assert from 'node:assert/strict';
import { autostartFiles } from '../src/autostart-files.mjs';

test('managed units can relocate code paths but not data scope or customized commands', async () => {
  const {isManagedUnit} = await import('../src/autostart-files.mjs');
  const original = autostartFiles({node:'/old/node',userDir:'/old/User path',dataDir:'/private/user'});
  for(const [name,body] of Object.entries(original)) {
    assert.equal(isManagedUnit(body,name,'/private/user'),true);
    assert.equal(isManagedUnit(body,name,'/other/user'),false);
    assert.equal(isManagedUnit(body+'ExecStartPost=/bin/extra\n',name,'/private/user'),false);
  }
});
