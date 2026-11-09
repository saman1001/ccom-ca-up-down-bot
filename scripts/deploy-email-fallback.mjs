import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadDotEnv } from '../src/config.js';

// Deploy only the standalone email formatter, with no bot restart or mail send.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotEnv(path.join(root, '.env.deploy'));
const target = process.env.EMAIL_FALLBACK_DEPLOY_TARGET;
if (!/^[a-z_][a-z0-9_-]*@[a-z0-9.-]+$/i.test(target || '')) {
  throw new Error('Set EMAIL_FALLBACK_DEPLOY_TARGET=user@host in private .env.deploy');
}
const sourcePath = path.join(root, 'scripts/nmr-email-fallback.mjs');
const checked = spawnSync(process.execPath, ['--check', sourcePath], { stdio: 'inherit' });
if (checked.error || checked.status !== 0) throw new Error('Local syntax validation failed');
const source = fs.readFileSync(sourcePath, 'utf8').replaceAll('\r\n', '\n');
const expected = 'cb4e85d5be7bca50e45996b05c021921004d17c0b81f121b04d963a64813ba09';
const digest = createHash('sha256').update(source).digest('hex');
const remote = `
import base64, hashlib, os, pathlib, subprocess, datetime
root = pathlib.Path('/opt/ccom-ca-up-down-bot')
target = root / 'scripts/nmr-email-fallback.mjs'
assert target.resolve() == target, 'Unexpected target path or symlink'
payload = base64.b64decode('${Buffer.from(source).toString('base64')}')
original = target.read_bytes()
checksum = lambda data: hashlib.sha256(data).hexdigest()
assert checksum(payload) == '${digest}', 'Payload checksum mismatch'
if checksum(original) == '${digest}':
    print('Email fallback already matches the requested version.')
else:
    assert checksum(original) == '${expected}', 'Server version changed. Review before deploying.'
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup_dir = root / 'backups' / ('email-format-' + stamp)
    backup_dir.mkdir(parents=True, mode=0o700)
    backup = backup_dir / 'nmr-email-fallback.mjs'
    with backup.open('xb') as file:
        file.write(original)
    backup.chmod(0o600)
    assert checksum(backup.read_bytes()) == '${expected}', 'Backup verification failed'
    candidate = backup_dir / 'nmr-email-fallback.new.mjs'
    with candidate.open('xb') as file:
        file.write(payload)
    subprocess.run(['/usr/bin/node', '--check', str(candidate)], check=True)
    stat = target.stat()
    candidate.chmod(stat.st_mode & 0o777)
    os.chown(candidate, stat.st_uid, stat.st_gid)
    assert target.read_bytes() == original, 'Server file changed during validation'
    os.replace(candidate, target)
    assert checksum(target.read_bytes()) == '${digest}', 'Installed checksum mismatch'
    print('Backup: ' + str(backup))
    print('Installed email fallback SHA256: ${digest}')
`;
const result = spawnSync('ssh', [
  '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
  target, 'python3 -'
], { input: remote, encoding: 'utf8', timeout: 60000 });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error || result.status !== 0) throw new Error('Email fallback deployment failed');
