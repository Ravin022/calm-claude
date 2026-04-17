const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cacheDir = path.join(
  process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'),
  'electron-builder',
  'Cache',
  'winCodeSign'
);

const sevenZip = path.join(
  __dirname,
  '..',
  'node_modules',
  '7zip-bin',
  'win',
  'x64',
  '7za.exe'
);

if (!fs.existsSync(cacheDir)) {
  console.log('No cache dir yet — run a build first to create it.');
  process.exit(0);
}
if (!fs.existsSync(sevenZip)) {
  console.error('7za.exe not found at', sevenZip);
  process.exit(1);
}

const entries = fs.readdirSync(cacheDir);
const archives = entries.filter(e => e.endsWith('.7z'));

for (const arch of archives) {
  const archPath = path.join(cacheDir, arch);
  const targetDir = path.join(cacheDir, arch.replace(/\.7z$/, ''));
  const markerFile = path.join(targetDir, '.extracted-no-darwin');

  if (fs.existsSync(markerFile)) {
    console.log('skip (done):', arch);
    continue;
  }

  console.log('extracting:', arch, '→', targetDir);
  try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(targetDir, { recursive: true });

  try {
    execFileSync(sevenZip, ['x', '-bd', '-y', `-o${targetDir}`, '-x!darwin', archPath], {
      stdio: ['ignore', 'ignore', 'pipe']
    });
    fs.writeFileSync(markerFile, 'ok');
    console.log('  ok');
  } catch (err) {
    console.error('  failed:', err.message);
  }
}

console.log('done');
