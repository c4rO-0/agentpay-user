// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
// Controlled package fixture for independent User tests, not the official release source.
// Reference wrapper/ZIP writer are MIT; see REFERENCE-SKILL-LICENSE.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { normalizeServiceReference } from '@c4roa0/agentpay-protocol';
import { writeSkillZip } from './skill-zip.mjs';
export const RANDOM_SKILL_BUNDLE_VERSION = '1.2.0';
export function packSkillFiles(files) { return writeSkillZip(Object.entries(files)); }
export async function randomSkillBundle(identity) {
 const service = normalizeServiceReference({version:'agentpay.service-reference.v1',adapter:'agentpay.json.v1',
  skillId:identity.skillId,profileHash:identity.profileHash,profile:identity.profile});
 const manifest = {format:'agentpay.skill-bundle.v1',packageName:'agentpay-random',packageVersion:RANDOM_SKILL_BUNDLE_VERSION,
  entrypoint:'scripts/random.mjs',services:{main:service}};
 const files = {
  'random-skill/SKILL.md': await readFile(new URL('./random-skill/SKILL.md',import.meta.url)),
  'random-skill/agentpay.json': JSON.stringify(manifest,null,2)+'\n',
  'random-skill/scripts/random.mjs': await readFile(new URL('./random-skill/random.mjs',import.meta.url))
 };
 const bytes=packSkillFiles(files);
 return {bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
}
