import type { ClientModule } from 'claude-code'

// Turning the probe's view with the pointer, laid over its picture: a drag
// with the left button spins and tips the world, a right click puts it back
// as it was. The hooks module (register.tsx) does the turning; this says
// what the pointer did, no oftener than every POST_MS, each redraw of the
// picture costing what it does. Each drag is numbered and says how far it
// has gone since it began, in fractions of the picture, so a post the next
// replaced loses nothing; numbered from a start of its own, so a fresh
// overlay's drags are never taken for an old one's. A right click mid-drag
// lets the drag go.
const POST_MS = 50

export type Steering = { drag: { n: number; across: number; down: number; isDone: boolean } } | { reset: true }

const Steer: ClientModule<null, true> = (_, surface) => {
  if (surface.state === undefined) {
    const drag = { n: Math.floor(Math.random() * 1e9), x: 0, y: 0, across: 0, down: 0, isDown: false, isSent: true }
    const send = () => {
      const steering: Steering = { drag: { n: drag.n, across: drag.across, down: drag.down, isDone: !drag.isDown } }
      surface.post(steering)
      drag.isSent = true
    }

    surface.onPointer(e => {
      const x = e.fine?.x ?? e.x + 0.5
      const y = e.fine?.y ?? e.y + 0.5
      if (e.type === 'down' && e.button === 'right') {
        Object.assign(drag, { isDown: false, isSent: true })
        const steering: Steering = { reset: true }
        surface.post(steering)
      } else if (e.type === 'down' && e.button === 'left') {
        Object.assign(drag, { n: drag.n + 1, x, y, across: 0, down: 0, isDown: true, isSent: false })
      } else if (drag.isDown && e.type === 'move') {
        drag.across = (x - drag.x) / Math.max(1, surface.columns)
        drag.down = (y - drag.y) / Math.max(1, surface.rows)
        drag.isSent = false
      } else if (drag.isDown && e.type === 'up' && e.button === 'left') {
        drag.isDown = false
        send()
      }
    })
    surface.every(POST_MS, () => {
      if (!drag.isSent) send()
    })
    surface.setState(true)
  }

  // Nothing drawn: the picture beneath shows through.
  return surface.elements.Box({})
}

export default Steer
