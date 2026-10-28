// The picture as it is drawn: one 0xRRGGBB color a pixel, row by row, and
// how near each pixel's paint is to the eye, so what is nearer covers what
// is behind whatever order it is drawn in. Space fills every pixel, so none
// is ever left clear.
export type Canvas = { width: number; height: number; color: Uint32Array; depth: Float32Array }

// Nothing at all is this far away: the sky is drawn there.
export const FAR = -Infinity

export function canvas(width: number, height: number): Canvas {
  return { width, height, color: new Uint32Array(width * height), depth: new Float32Array(width * height).fill(FAR) }
}

// Paints pixel (x, y) at depth `z` unless something nearer is there already.
export function put(c: Canvas, x: number, y: number, color: number, z: number) {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return

  const i = y * c.width + x
  if (z < (c.depth[i] ?? FAR)) return
  c.color[i] = color
  c.depth[i] = z
}

// Paints over pixel (x, y) partway, as glass or haze does, leaving what is
// nearer than `z` alone; it hides nothing, so it never takes the depth.
export function blend(c: Canvas, x: number, y: number, color: number, alpha: number, z = Infinity) {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height || alpha <= 0) return

  const i = y * c.width + x
  if (z < (c.depth[i] ?? FAR)) return
  c.color[i] = mix(c.color[i] ?? 0, color, Math.min(1, alpha))
}

// Light added on top, as a flare or an engine's glow is.
export function glow(c: Canvas, x: number, y: number, light: number, amount: number, z = Infinity) {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height || amount <= 0) return

  const i = y * c.width + x
  if (z < (c.depth[i] ?? FAR)) return
  c.color[i] = brighten(c.color[i] ?? 0, light, amount)
}

// Scales each channel, clamped: below 1 darkens, above 1 lightens.
export function shade(color: number, factor: number): number {
  const channel = (shift: number) => Math.min(255, Math.round(((color >> shift) & 255) * factor))

  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

// Partway from one color to another: 0 keeps `from`, 1 is `to`.
export function mix(from: number, to: number, amount: number): number {
  const channel = (shift: number) => {
    const a = (from >> shift) & 255
    return Math.round(a + (((to >> shift) & 255) - a) * amount)
  }

  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

// Light added on, clamped.
export function brighten(color: number, light: number, amount: number): number {
  const channel = (shift: number) => Math.min(255, Math.round(((color >> shift) & 255) + ((light >> shift) & 255) * amount))

  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

// A 4x4 ordered dither, 0 to 1: shading stepped through it falls in the
// checkered bands pixel art draws by hand.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(n => (n + 0.5) / 16)

export const dither = (x: number, y: number) => BAYER[((y & 3) << 2) | (x & 3)] ?? 0.5

// The terminal packs two pixels into each cell with half blocks.
export const cellsOf = (c: Canvas) => ({ columns: c.width, rows: Math.ceil(c.height / 2) })

const DEFAULT = 0x01000000
const UPPER_HALF = 0x2580
const FULL = 0x2588

// RasterProps.cells: per cell, [codePoint, foreground, background] as little-endian u32s.
export function toCells(c: Canvas): string {
  const { columns, rows } = cellsOf(c)
  const words = new Uint32Array(columns * rows * 3)
  let at = 0

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const top = c.color[2 * y * columns + x] ?? 0
      const bottom = 2 * y + 1 < c.height ? (c.color[(2 * y + 1) * columns + x] ?? 0) : undefined
      words[at] = bottom === undefined ? UPPER_HALF : top === bottom ? FULL : UPPER_HALF
      words[at + 1] = top
      words[at + 2] = bottom === undefined || top === bottom ? DEFAULT : bottom
      at += 3
    }
  }

  return toBase64(new Uint8Array(words.buffer))
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const CODES = Uint8Array.from(ALPHABET, ch => ch.charCodeAt(0))
const PAD = '='.charCodeAt(0)

// The runtime's own encoder where it has one; else the letters' codes laid
// out in bytes and turned to text a slice at a time, never a letter at a
// time: an HD frame is near a million of them, ten times a second.
function toBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64
  if (typeof native === 'function') return native.call(bytes)

  const codes = new Uint8Array(Math.ceil(bytes.length / 3) * 4)
  for (let i = 0, o = 0; i < bytes.length; i += 3, o += 4) {
    const left = bytes.length - i
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    codes[o] = CODES[(n >> 18) & 63] ?? PAD
    codes[o + 1] = CODES[(n >> 12) & 63] ?? PAD
    codes[o + 2] = left > 1 ? (CODES[(n >> 6) & 63] ?? PAD) : PAD
    codes[o + 3] = left > 2 ? (CODES[n & 63] ?? PAD) : PAD
  }

  const slices: string[] = []
  // `apply`, not a spread: spreading a typed array walks it as an iterator, five times slower.
  for (let i = 0; i < codes.length; i += 8192) {
    slices.push(String.fromCharCode.apply(null, codes.subarray(i, i + 8192) as unknown as number[]))
  }

  return slices.join('')
}

// The same pixels as an Image's RGBA bytes, base64, every one opaque, each
// drawn `k` by `k` so the terminal's scaling keeps them square and sharp.
export function toRgba(c: Canvas, k = 1): string {
  const width = c.width * k
  const words = new Uint32Array(width * c.height * k)

  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const color = c.color[y * c.width + x] ?? 0
      // Little-endian: the bytes fall R, G, B, A.
      const rgba = (0xff000000 | ((color & 255) << 16) | (color & 0xff00) | ((color >> 16) & 255)) >>> 0
      for (let dy = 0; dy < k; dy++) words.fill(rgba, (y * k + dy) * width + x * k, (y * k + dy) * width + x * k + k)
    }
  }

  return toBase64(new Uint8Array(words.buffer))
}

// The most an Svg's source may run to.
export const SVG_LIMIT = 131072

// The same pixels for surfaces that draw SVG: one path per color, each run
// of it a one-pixel-high rectangle, `M x y h w v1 h-w z`. Each channel is
// rounded to `step` first, so a nebula's soft shades make long runs.
export function toSvg(c: Canvas, step = 1): string {
  const runs = new Map<number, string[]>()
  const round = (color: number) => {
    if (step <= 1) return color
    const channel = (shift: number) => Math.min(255, Math.round(((color >> shift) & 255) / step) * step)
    return (channel(16) << 16) | (channel(8) << 8) | channel(0)
  }

  for (let y = 0; y < c.height; y++) {
    let x = 0

    while (x < c.width) {
      const color = round(c.color[y * c.width + x] ?? 0)
      let end = x + 1
      while (end < c.width && round(c.color[y * c.width + end] ?? 0) === color) end++

      const width = end - x
      const run = `M${x} ${y}h${width}v1h-${width}z`
      const known = runs.get(color)
      if (known) known.push(run)
      else runs.set(color, [run])
      x = end
    }
  }

  const paths = [...runs].map(([color, drawn]) => `<path fill="${hex(color)}" d="${drawn.join('')}"/>`)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${c.width} ${c.height}" ` +
    `shape-rendering="crispEdges">${paths.join('')}</svg>`
  )
}

export const hex = (color: number) => '#' + color.toString(16).padStart(6, '0')
