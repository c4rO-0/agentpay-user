// Maintained test fixture using the installed Wallet's public CLI and real IPC.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { walletCliPath } from '../../src/wallet-package.mjs';
export async function startWalletServer(dataDir) {
  const child = spawn(process.execPath, [walletCliPath(), 'serve', dataDir], {stdio:['ignore','pipe','inherit']});
  async function close() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child,'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  try {
    await new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(Error('Wallet startup timed out')), 10000);
      child.once('error', e => {clearTimeout(timer);reject(e);});
      child.once('exit', () => {clearTimeout(timer);reject(Error('Wallet exited before ready'));});
      let text=''; child.stdout.on('data', chunk => {
        text += chunk;
        if(text.includes('"ready":true')) {clearTimeout(timer);resolve();}
      });
    });
    return {socketPath:join(dataDir,'wallet.sock'), close};
  } catch(e) {await close();throw e;}
}
