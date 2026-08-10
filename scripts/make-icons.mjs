/**
 * 產生 PWA 圖示。改了設計就重跑 `node scripts/make-icons.mjs`。
 * 產出的 PNG 會進版控，所以正常部署流程不需要跑這支。
 */
import { mkdir, writeFile } from 'node:fs/promises';

import sharp from 'sharp';

const BG = '#0b0d10';
const ACCENT = '#6ee7b7';

/**
 * @param {number} size
 * @param {number} inset 內縮比例。maskable 圖示會被系統裁成圓形，
 *                       圖案要縮在中間 80% 的安全區內才不會被切到。
 */
const svg = (size, inset) => {
  const c = size / 2;
  const r = (size / 2) * inset;
  const stroke = size * 0.055;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g stroke="${ACCENT}" stroke-width="${stroke}" fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M ${c} ${c - r} L ${c + r * 0.78} ${c} L ${c} ${c + r} L ${c - r * 0.78} ${c} Z"/>
    <path d="M ${c - r * 0.36} ${c} L ${c + r * 0.36} ${c}"/>
  </g>
</svg>`;
};

const OUT = new URL('../public/icons/', import.meta.url);

const targets = [
  { file: 'icon-192.png', size: 192, inset: 0.62 },
  { file: 'icon-512.png', size: 512, inset: 0.62 },
  { file: 'icon-maskable.png', size: 512, inset: 0.44 },
  // iOS 加到主畫面時抓的就是這張
  { file: 'apple-touch-icon.png', size: 180, inset: 0.62 },
];

await mkdir(OUT, { recursive: true });

for (const { file, size, inset } of targets) {
  const png = await sharp(Buffer.from(svg(size, inset))).png().toBuffer();
  await writeFile(new URL(file, OUT), png);
  console.log(`${file}  ${size}×${size}`);
}
