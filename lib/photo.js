import { createRequire } from 'node:module'
import { mkdirSync, copyFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
export async function recognize(file, dir) {
  const { createWorker } = require('tesseract.js')
  const langPath = join(dir, 'ocr')
  mkdirSync(langPath, { recursive: true })
  for (const lang of ['eng', 'chi_sim']) {
    const name = lang + '.traineddata.gz'
    copyFileSync(
      require.resolve('@tesseract.js-data/' + lang + '/4.0.0_best_int/' + name),
      join(langPath, name),
    )
  }
  const worker = await createWorker('chi_sim+eng', 1, {
    langPath,
    cacheMethod: 'none',
    errorHandler: () => {},
  })
  try {
    const { data } = await worker.recognize(file)
    if (!data.text.trim()) throw Error('图片未识别出文字，请核对原图并手动补充')
    return data.text.trim()
  } finally {
    await worker.terminate()
  }
}
export function preview(file, tile) {
  const buf = readFileSync(file)
  const jpeg = require('jpeg-js')
  const img =
    buf[0] === 255
      ? jpeg.decode(buf, { maxMemoryUsageInMB: 256 })
      : require('pngjs').PNG.sync.read(buf)
  const crop = tile >= 0,
    w = crop ? Math.ceil(img.width / 2) : img.width,
    h = crop ? Math.ceil(img.height / 2) : img.height
  const left = crop && tile % 2 ? img.width - w : 0,
    top = crop && tile >= 2 ? img.height - h : 0
  for (const limit of [720, 480, 320, 200, 120]) {
    const scale = Math.min(1, limit / Math.max(w, h))
    const width = Math.max(1, Math.round(w * scale)),
      height = Math.max(1, Math.round(h * scale))
    const data = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const pos =
          ((top + Math.floor(y / scale)) * img.width +
            left +
            Math.floor(x / scale)) *
          4
        img.data.copy(data, (y * width + x) * 4, pos, pos + 4)
      }
    const out = jpeg.encode({ width, height, data }, 65).data
    if (out.length < 16000)
      return 'data:image/jpeg;base64,' + out.toString('base64')
  }
  throw Error('此图无法预览')
}
