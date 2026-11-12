import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeSkillZip} from './fixtures/skill-zip.mjs';
import {bundleDigest,installSkillBundle,inspectSavedSkillBundle} from '../src/skill-bundle.mjs';

test('saved package verifies actual files and preserves edited, missing and substituted content', async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'saved-skill-'));
 t.after(()=>rm(dataDir,{recursive:true,force:true}));
 await mkdir(join(dataDir,'runtime'),{mode:0o700});
 const bytes=writeSkillZip([['example/SKILL.md','Instructions'],['example/agentpay.json',JSON.stringify({packageName:'example',packageVersion:'1.0.0'})]]);
 const pin={name:'example',version:'1.0.0',sha256:bundleDigest(bytes)};
 assert.equal((await inspectSavedSkillBundle(dataDir,pin)).status,'download_required');
 const {directory}=await installSkillBundle({dataDir,bytes,source:'controlled fixture'});
 assert.equal((await inspectSavedSkillBundle(dataDir,pin)).status,'ready');
 const file=join(directory,'example/SKILL.md');
 await writeFile(file,'Edited');
 assert.equal((await inspectSavedSkillBundle(dataDir,pin)).status,'local_edits');
 await rm(file);
 assert.equal((await inspectSavedSkillBundle(dataDir,pin)).status,'local_edits');
 await symlink(join(directory,'publisher.zip'),file);
 assert.equal((await inspectSavedSkillBundle(dataDir,pin)).status,'local_edits');
 await writeFile(join(directory,'publisher.zip'),'Substituted archive');
 assert.equal((await inspectSavedSkillBundle(dataDir,pin)).status,'download_required');
});
