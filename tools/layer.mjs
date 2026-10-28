// One of pixel-probe's worlds for tools/wallpaper.py: the world, its moons and
// rings and the probe, with nothing behind them, as raw RGBA on stdout. The
// picture is drawn over black and over white, and where the two differ is
// what shows through: the rings, the edge of the air.
//
//   node --import ./tools/ts-loader.mjs tools/layer.mjs <world> <width> <height> <seconds> <zoom> <pan x> <pan y> <craft>
import { CRAFT } from '../pixel-probe/hooks/craft.ts'
import { toFrame } from '../pixel-probe/hooks/frame.ts'
import { drawScene } from '../pixel-probe/hooks/scene.ts'

const [world, width, height, seconds, zoom, panX, panY, craftName] = process.argv.slice(2)
const [w, h] = [Number(width), Number(height)]
const craft = Math.max(0, CRAFT.findIndex(one => one.name.toLowerCase() === String(craftName).toLowerCase()))
const frame = toFrame({
  effort: null,
  working: false,
  work: 0,
  tasks: null,
  target: { phase: 'gone', since: 0, scene: 'orbit', born: 0 },
  helpers: {},
  world,
  craft,
  tick: Math.round(Number(seconds) * 10),
  view: { spin: 0, tip: 0, zoom: Number(zoom), pan: [Number(panX), Number(panY)] },
})
const black = drawScene(frame, w, h, 0x000000)
const white = drawScene(frame, w, h, 0xffffff)

const out = Buffer.alloc(w * h * 4)
for (let i = 0; i < w * h; i++) {
  const [b, l] = [black.color[i], white.color[i]]
  const channels = [16, 8, 0].map(shift => [(b >> shift) & 255, (l >> shift) & 255])
  const alpha = Math.max(0, Math.min(1, 1 - Math.max(...channels.map(([on, off]) => off - on)) / 255))
  channels.forEach(([on], k) => (out[i * 4 + k] = alpha > 0 ? Math.min(255, Math.round(on / alpha)) : 0))
  out[i * 4 + 3] = Math.round(alpha * 255)
}
process.stdout.write(out)
