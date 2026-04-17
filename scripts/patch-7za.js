const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const binDir = path.resolve(__dirname, '..', 'node_modules', '7zip-bin', 'win', 'x64');
const realExe = path.join(binDir, '7za.exe');
const origExe = path.join(binDir, '7za-orig.exe');
const sourceCs = path.join(__dirname, '7za-wrapper.cs');

const csc = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
].find(p => fs.existsSync(p));

if (!csc) {
  console.error('csc.exe not found. Install .NET Framework 4.x.');
  process.exit(1);
}
if (!fs.existsSync(realExe)) {
  console.error('7za.exe not found at', realExe);
  process.exit(1);
}
if (!fs.existsSync(sourceCs)) {
  console.error('Wrapper source not found at', sourceCs);
  process.exit(1);
}

const curSize = fs.statSync(realExe).size;
const WRAPPER_MAX = 50 * 1024;
const isCurrentlyWrapper = curSize < WRAPPER_MAX;

if (!isCurrentlyWrapper) {
  fs.copyFileSync(realExe, origExe);
  console.log(`Backed up real 7za.exe → 7za-orig.exe (${curSize} bytes)`);
} else if (!fs.existsSync(origExe)) {
  console.error('Current 7za.exe is a wrapper but no 7za-orig.exe backup found. Reinstall node_modules.');
  process.exit(1);
} else {
  console.log('7za.exe already appears to be the wrapper; re-building it.');
}

const tmpExe = path.join(binDir, '7za-wrapper.exe');
try { fs.unlinkSync(tmpExe); } catch {}

execFileSync(csc, [
  '/nologo',
  '/target:exe',
  '/platform:anycpu',
  `/out:${tmpExe}`,
  sourceCs
], { stdio: 'inherit' });

fs.copyFileSync(tmpExe, realExe);
try { fs.unlinkSync(tmpExe); } catch {}

console.log('Wrapper installed at', realExe);
console.log('Original kept at', origExe);
