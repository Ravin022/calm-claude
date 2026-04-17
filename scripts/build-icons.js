const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'logo.png');
const BUILD = path.join(ROOT, 'build');

async function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(`Missing source logo at ${SOURCE}`);
  }
  fs.mkdirSync(BUILD, { recursive: true });

  const trimmedFull = await sharp(SOURCE).trim({ threshold: 10 }).png().toBuffer();
  const fullMeta = await sharp(trimmedFull).metadata();

  await sharp(trimmedFull)
    .resize({ width: 1024, fit: 'inside', withoutEnlargement: true })
    .toFile(path.join(BUILD, 'splash-full.png'));

  const topCropHeight = Math.round(fullMeta.height * 0.62);
  const topCrop = await sharp(trimmedFull)
    .extract({ left: 0, top: 0, width: fullMeta.width, height: topCropHeight })
    .trim({ threshold: 10 })
    .png()
    .toBuffer();
  const iconMeta = await sharp(topCrop).metadata();

  const side = Math.max(iconMeta.width, iconMeta.height);
  const padded = await sharp({
    create: {
      width: side,
      height: side,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{
      input: topCrop,
      left: Math.floor((side - iconMeta.width) / 2),
      top: Math.floor((side - iconMeta.height) / 2)
    }])
    .png()
    .toBuffer();

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const buffers = await Promise.all(
    sizes.map(s =>
      sharp(padded)
        .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    )
  );

  await sharp(padded)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toFile(path.join(BUILD, 'icon.png'));

  await sharp(padded)
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toFile(path.join(BUILD, 'icon-256.png'));

  const ico = await pngToIco(buffers);
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico);

  console.log('Icons generated in build/:');
  console.log('  icon.ico       (' + sizes.join(', ') + ')');
  console.log('  icon.png       (512x512)');
  console.log('  icon-256.png   (256x256)');
  console.log('  splash-full.png (1024 wide)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
