// Gera o logótipo do FuturePal (SVG) e todos os ícones da app a partir dele:
// lojas (1024), Windows, Android (normal, redondo e adaptativo), iPhone, ecrãs de arranque, favicon e site.
// Uso: node scripts/brand-icons.mjs   (precisa do Playwright/Chromium já instalado no projeto)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = path.resolve(ROOT, '..', 'website');
const BG = '#0b1416';

// ---------------------------------------------------------------- desenho (512×512)
const defs = `
  <defs>
    <linearGradient id="w" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#14b8c4"/><stop offset="1" stop-color="#2fd27f"/></linearGradient>
    <linearGradient id="a" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#7cf0b5"/><stop offset="1" stop-color="#e3fff0"/></linearGradient>
    <radialGradient id="g" cx=".7" cy=".22" r=".8"><stop offset="0" stop-color="#2fd27f" stop-opacity=".3"/><stop offset="1" stop-color="#17c3c9" stop-opacity="0"/></radialGradient>
    <mask id="s"><rect width="512" height="512" fill="#fff"/><rect x="300" y="290" width="150" height="84" rx="34" fill="#000"/></mask>
  </defs>`;
const glyph = `
  <path d="M128 236 L214 166 L268 204 L372 112" fill="none" stroke="url(#a)" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M320 108 H376 V164" fill="none" stroke="#e3fff0" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="100" y="236" width="312" height="184" rx="44" fill="url(#w)" mask="url(#s)"/>
  <circle cx="346" cy="332" r="14" fill="#2fd27f"/>`;
// centra o desenho (que está ligeiramente acima do meio) e permite reduzi-lo
const centered = (scale = 1) => `<g transform="translate(256 256) scale(${scale}) translate(-256 -266)">${glyph}</g>`;

const svg = (body, { rounded = true, background = true } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}` +
  (background ? `<rect width="512" height="512" ${rounded ? 'rx="116"' : ''} fill="${BG}"/><rect width="512" height="512" ${rounded ? 'rx="116"' : ''} fill="url(#g)"/>` : '') +
  (background && rounded ? `<rect x="1.5" y="1.5" width="509" height="509" rx="114.5" fill="none" stroke="#2fd2a8" stroke-opacity=".25" stroke-width="3"/>` : '') +
  body + `</svg>`;

const ICON_ROUNDED = svg(centered(1));                                   // Windows, favicon, site
const ICON_SQUARE = svg(centered(0.92), { rounded: false });             // lojas e iPhone (o sistema arredonda)
const FOREGROUND = svg(centered(0.66), { background: false });           // Android adaptativo (zona segura)

// ---------------------------------------------------------------- render
const browser = await chromium.launch();
const page = await browser.newPage();
async function png(svgText, size, out, { bg = 'transparent' } = {}) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${bg}">${svgText.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: bg === 'transparent', clip: { x: 0, y: 0, width: size, height: size } });
}
async function splash(w, h, out) {
  const s = Math.round(Math.min(w, h) * 0.32);
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;background:${BG};display:grid;place-items:center">${ICON_ROUNDED.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: w, height: h } });
}

// ficheiros-mestre
const brand = path.join(SITE, 'brand');
// ficheiros .svg com tamanho declarado (sem isto, um <img> assume 300×150)
const sized = (t) => t.replace('<svg ', '<svg width="512" height="512" ');
mkdirSync(brand, { recursive: true });
writeFileSync(path.join(brand, 'futurepal-icon.svg'), sized(ICON_ROUNDED));
writeFileSync(path.join(brand, 'futurepal-icon-square.svg'), sized(ICON_SQUARE));
writeFileSync(path.join(ROOT, 'public', 'favicon.svg'), sized(ICON_ROUNDED));
writeFileSync(path.join(SITE, 'favicon.svg'), sized(ICON_ROUNDED));
await png(ICON_SQUARE, 1024, path.join(brand, 'futurepal-store-1024.png'), { bg: BG });
await png(ICON_SQUARE, 512, path.join(brand, 'futurepal-play-512.png'), { bg: BG });
await png(ICON_ROUNDED, 1024, path.join(brand, 'futurepal-icon-1024.png'));
await png(ICON_ROUNDED, 180, path.join(SITE, 'apple-touch-icon.png'));

// Windows (o electron-builder converte o PNG em .ico)
await png(ICON_ROUNDED, 1024, path.join(ROOT, 'build', 'icon.png'));

// Android
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  await png(ICON_ROUNDED, Math.round(48 * k), path.join(RES, `mipmap-${d}`, 'ic_launcher.png'));
  await png(svg(`<circle cx="256" cy="256" r="256" fill="${BG}"/><circle cx="256" cy="256" r="256" fill="url(#g)"/>` + centered(0.8), { background: false }), Math.round(48 * k), path.join(RES, `mipmap-${d}`, 'ic_launcher_round.png'));
  await png(FOREGROUND, Math.round(108 * k), path.join(RES, `mipmap-${d}`, 'ic_launcher_foreground.png'));
}
writeFileSync(path.join(RES, 'values', 'ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG.toUpperCase()}</color>\n</resources>\n`);
for (const dir of readdirSync(RES).filter((d) => d.startsWith('drawable'))) {
  const f = path.join(RES, dir, 'splash.png');
  if (!existsSync(f)) continue;
  const [w, h] = execFileSync('python', ['-I', '-c', 'import sys;from PIL import Image;print(*Image.open(sys.argv[1]).size)', f]).toString().trim().split(' ').map(Number);
  await splash(w, h, f);
}

// iPhone
const IOS = path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets');
await png(ICON_SQUARE, 1024, path.join(IOS, 'AppIcon.appiconset', 'AppIcon-512@2x.png'), { bg: BG });
for (const n of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) await splash(2732, 2732, path.join(IOS, 'Splash.imageset', n));

await browser.close();
console.log('ok');
