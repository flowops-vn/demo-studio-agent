import { spawn } from 'node:child_process';

// Run a command, resolve stdout, reject with stderr on non-zero exit.
export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '', err = '';
    p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve(out) : reject(new Error(cmd + ' exited ' + code + ': ' + err.slice(-800)))));
  });
}
