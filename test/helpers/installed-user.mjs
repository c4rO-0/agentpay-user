// Fixtures use the same public dependencies as this independent User checkout.
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
export async function installedUser(root) {
  const user = join(root,'user');
  await mkdir(user, {recursive:true});
  const source = fileURLToPath(new URL('../../', import.meta.url));
  const pkg = JSON.parse(await readFile(join(source,'package.json'),'utf8'));
  await writeFile(join(user,'package.json'), JSON.stringify(pkg));
  await writeFile(join(user,'package-lock.json'), '{}');
  await symlink(join(source,'node_modules'),join(user,'node_modules'),'dir');
  return user;
}
export function isolateState(t, root) {
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME=join(root,'state');
  t.after(() => {
    if(previous === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME=previous;
  });
}
