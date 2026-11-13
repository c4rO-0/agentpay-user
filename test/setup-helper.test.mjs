// SPDX-License-Identifier: MPL-2.0
// Actual child processes: diagnostic framing, private-error suppression and
// preserving a child's durable request on failure. No payment or chain calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureNode } from '../src/anvil-onboarding.mjs';
import { formatSetupFailure } from '../src/setup-diagnostics.mjs';

test('captured helper retains meaningful safe diagnostics and original state', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'setup-helper-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const script = join(dir, 'helper.mjs'), record = join(dir, 'request.json');
  for (const [code, expected] of [['ECONNREFUSED', 'NETWORK_UNAVAILABLE'], ['ENOENT', 'LOCAL_SETTINGS_MISSING'], ['REQUEST_CONFLICT', 'REQUEST_CONFLICT'], ['WALLET_LOCKED', 'LOCAL_SERVICE_UNAVAILABLE'], ['SERVICE_MAINTENANCE', 'SERVICE_MAINTENANCE'], ['ORDER_ALREADY_SETTLED', 'ORDER_ALREADY_SETTLED'], ['UNREVIEWED_SECRET_CODE', 'STEP_FAILED']]) {
    await writeFile(script, `import {writeFile} from 'node:fs/promises';
      await writeFile(process.argv[2], 'original-request');
      throw Object.assign(Error('DO_NOT_SHARE https://user:password@example.com private input'), {code:${JSON.stringify(code)}});`);
    await assert.rejects(captureNode(script, [record]), e => {
      const output = formatSetupFailure(e);
      assert.match(output, new RegExp('Code: ' + expected));
      assert.doesNotMatch(output, /DO_NOT_SHARE|password|UNREVIEWED_SECRET_CODE|message above/);
      assert.match(output, /do not create a replacement/);
      return true;
    });
    assert.equal(await readFile(record, 'utf8'), 'original-request');
  }
  await writeFile(script, `console.log(JSON.stringify({ok:true,value:7}));`);
  assert.deepEqual(await captureNode(script, []), {ok:true,value:7});
  await writeFile(script, `console.log(JSON.stringify({ok:false,error:{code:'LOCKED',message:'DO_NOT_SHARE'}}));process.exitCode=1;`);
  await assert.rejects(captureNode(script, []), e => {
    assert.match(formatSetupFailure(e), /LOCAL_SERVICE_UNAVAILABLE/);
    assert.doesNotMatch(formatSetupFailure(e), /DO_NOT_SHARE/);
    return true;
  });
});
