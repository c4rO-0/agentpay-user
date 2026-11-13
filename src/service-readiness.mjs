// SPDX-License-Identifier: MPL-2.0
// Authenticated local status, not an open port or systemctl's start result,
// establishes readiness. A locked Wallet and unfinished Order checks are normal.
import {localWalletAdmin} from './local-wallet-ipc.mjs';
import {readRuntimeStatus} from './runtime-status.mjs';
import {requireRunningSoftware} from './software-versions.mjs';

export async function waitForServiceReadiness(dataDir, {
  wallet = dir => localWalletAdmin(dir, 'status', {}, {timeoutMs:2500}),
  runtime = readRuntimeStatus,
  timeoutMs = 15000,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  let lastError;
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const [w,r] = await Promise.all([wallet(dataDir), runtime(dataDir)]);
      if (typeof w?.locked !== 'boolean' || r?.role !== 'user-runtime')
        throw Error('Invalid local service response.');
      requireRunningSoftware(w,r);
      return;
    } catch (error) {
      lastError=error;
      if (error.code === 'RUNNING_VERSION_UNVERIFIED') throw error;
      if (Date.now() >= deadline) break;
      await pause(300);
    }
  } while (Date.now() < deadline);
  throw Object.assign(Error('Wallet and Runtime readiness could not be confirmed. Default Skill access stays paused. Run agentpay status, then retry agentpay service start.'),{code:'SERVICE_READINESS_FAILED',cause:lastError});
}
