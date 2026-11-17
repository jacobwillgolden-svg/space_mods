import type { EngineInterface, Register } from 'claude-code'

import { SCRIPT, followed } from './aura'

// The choice is all this keeps. The dashboard's jukebox reads it from the
// store (mc-rice's aura_on()) and Aura's file itself; nothing writes to Aura.
async function answer($: EngineInterface): Promise<string> {
  const script = await $.fs.read(SCRIPT).catch(() => undefined)
  if (script === undefined) return "Aura sync is on, but Aura's settings can't be read, so the jukebox keeps the theme's colours."
  return `Aura sync is on: ${followed(script)}. /aurasync off goes back to the theme's.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'aurasync',
      description: "mc-rice's jukebox follows the laptop's Aura lighting: /aurasync on|off",
      argumentHint: '[on|off]',
      // It only keeps a word and reads a file, so it needn't wait for a turn to end.
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'aurasync' }, async ($, e) => {
    const asked = e.args.trim().toLowerCase()
    if (asked !== '' && asked !== 'on' && asked !== 'off') return { text: '/aurasync takes on or off.' }
    const isOn = asked === '' ? (await $.store.get('on')) !== true : asked === 'on'
    await $.store.set('on', isOn)
    return { text: isOn ? await answer($) : "Aura sync is off: the jukebox is in the theme's colours. /aurasync on follows Aura." }
  })
}
