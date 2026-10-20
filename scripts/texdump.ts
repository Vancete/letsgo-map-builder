import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseBntx, decodeTexture, formatName } from '../src/shared/formats/bntx.ts';
import { encodePng } from '../src/shared/formats/png.ts';
const dir = process.argv[2], out = process.argv[3];
mkdirSync(out, { recursive: true });
const fmts: Record<string, number> = {};
let n = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.bntx')) continue;
  for (const t of parseBntx(new Uint8Array(readFileSync(dir + '/' + f)))) {
    const fn = formatName(t.format); fmts[fn] = (fmts[fn] ?? 0) + 1;
    if (n++ < 400) {
      const img = decodeTexture(t);
      if (img) writeFileSync(`${out}/${t.name}_${fn}.png`, encodePng(img.width, img.height, img.rgba));
    }
  }
}
console.log(fmts);
