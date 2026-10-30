// One of pixel-probe's worlds for tools/wallpaper.py: the world, its moons and
// rings and the probe, with nothing behind them, as raw RGBA on stdout. The
// picture is drawn over black and over white, and where the two differ is
// what shows through: the rings, the edge of the air.
//
//   node --import ./tools/ts-loader.mjs tools/layer.mjs <world> <width> <height> <seconds> <zoom> <pan x> <pan y> <craft> [<probe x> <probe y>]
import { CRAFT, drawCraft } from '../pixel-probe/hooks/craft.ts'
import { toFrame } from '../pixel-probe/hooks/frame.ts'
import { drawScene } from '../pixel-probe/hooks/scene.ts'

const [world, width, height, seconds, zoom, panX, panY, craftName, probeX, probeY] = process.argv.slice(2)
const [w, h] = [Number(width), Number(height)]
// Where the probe hangs instead, as fractions of the picture from its left and top.
const probeAt = probeX === undefined ? undefined : [Number(probeX), Number(probeY)]
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

// The scene always draws the probe on its orbit, so the probe can only be put
// elsewhere while that one is out of sight behind the world: drawn as another
// craft, the picture must not change.
if (probeAt) {
  const other = drawScene({ ...frame, craft: craft === 0 ? 1 : 0 }, w, h, 0x000000)
  if (other.color.some((color, i) => color !== black.color[i])) {
    console.error(`the probe still shows on its orbit at ${seconds} seconds: --probe-at needs it behind ${world}`)
    process.exit(1)
  }
  // As far from its middle to a wing's tip as the scene draws it (PROBE in scene.ts).
  const pose = { x: probeAt[0] * w, y: probeAt[1] * h, z: 1e9, size: Math.max(3, 0.1 * Math.min(w, h) * Number(zoom)), spin: frame.time * 1.5, shine: 1 }
  for (const canvas of [black, white]) drawCraft(canvas, CRAFT[craft], pose, frame.time)
}

const out = Buffer.alloc(w * h * 4)
for (let i = 0; i < w * h; i++) {
  const [b, l] = [black.color[i], white.color[i]]
  const channels = [16, 8, 0].map(shift => [(b >> shift) & 255, (l >> shift) & 255])
  const alpha = Math.max(0, Math.min(1, 1 - Math.max(...channels.map(([on, off]) => off - on)) / 255))
  channels.forEach(([on], k) => (out[i * 4 + k] = alpha > 0 ? Math.min(255, Math.round(on / alpha)) : 0))
  out[i * 4 + 3] = Math.round(alpha * 255)
}
process.stdout.write(out)
