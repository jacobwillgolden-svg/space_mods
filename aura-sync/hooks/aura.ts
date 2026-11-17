// What the Aura service has written, in words for /aurasync's answer. The
// dashboard reads the colours for itself (mc-rice's mcrice/aura.py).

export const SCRIPT = 'C:\\Program Files (x86)\\LightingService\\script\\LastScript.xml'

const NAMES: [number, string][] = [
  [15, 'red'], [45, 'orange'], [70, 'yellow'], [165, 'green'], [195, 'cyan'], [255, 'blue'], [290, 'purple'], [340, 'pink'], [360, 'red'],
]

// The hue, 0 to 1, as a word.
export function colorName(hue: number, saturation: number): string {
  if (saturation < 0.1) return 'white'
  const degrees = ((hue % 1) + 1) % 1 * 360
  return NAMES.find(([upTo]) => degrees < upTo)?.[1] ?? 'red'
}

// The keyboard's effect: the first device's that isn't the wallpaper, its
// number gone from its name, and all that its entry in the list says.
export function keyboardEffect(script: string): { name: string; body: string } | undefined {
  for (const [, key, group] of script.matchAll(/<group key="([^"]+)">([\s\S]*?)<\/group>/g)) {
    if (group?.includes('<type>WallPaper</type>') === false && key !== undefined) {
      const body = new RegExp(`<(effect|anime) key="${key}">[\\s\\S]*?</\\1>`).exec(script.slice(script.indexOf('<effectList>')))?.[0]
      if (body !== undefined) return { name: key.replace(/\d+$/, ''), body }
    }
  }
  return undefined
}

// What the jukebox is following, or why it isn't.
export function followed(script: string): string {
  const effect = keyboardEffect(script)
  const color = effect && /<initColor>\s*<hue>([\d.]+)<\/hue>\s*<saturation>([\d.]+)</.exec(effect.body)
  if (effect !== undefined && color) {
    const isGradient = effect.body.includes('<ViceEffect key="Gradient">')
    const name = isGradient ? 'a gradient' : colorName(Number(color[1]), Number(color[2]))
    if (effect.name === 'StaticSingleEff') return `the jukebox follows ${isGradient ? 'a static gradient' : `static ${name}`}`
    if (effect.name === 'ColorCycleSingleEff') return 'the jukebox follows the color cycle, about in step'
    if (effect.name === 'RainbowSingleEff') return 'the jukebox follows the rainbow, about in step'
    // Armoury Crate's Immersion is written as a music effect, told apart by its audio type.
    if (effect.name.startsWith('Music')) {
      const kind = /<audiotype>204</.test(effect.body) ? 'immersion' : 'music'
      return `the jukebox follows ${kind} in ${/<slot key="HUE"/.test(effect.body) ? 'a rainbow' : name}`
    }
  }
  return `this effect${effect === undefined ? '' : ` (${effect.name})`} isn't followed yet, so the jukebox keeps the theme's colours`
}
