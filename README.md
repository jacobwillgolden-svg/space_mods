# space_mods

Space for Claude Code, in pixels. Every planet, moon, ring, spacecraft and
star here is drawn in code a pixel at a time: no textures, no photos, no
recordings.

![The probe: Jupiter, a survey of Saturn, agents' craft round Earth, a comet mined](docs/pane.png)

## pixel-probe

A probe orbiting a world while Claude works. It is a Claude Code mod of
function hooks, the back end of what mc-rice's dashboard (`claude_mods/mc-rice`)
draws in Steve's place once `/steve off` and `/probe on` give it the place
(`hooks/mirror.ts`, mc-rice's `tools/probe-frames.ts`). Nothing is drawn
beside the chat: with no dashboard round the shell, the probe shows nowhere.

**The effort level picks the world.** The harder Claude thinks, the bigger the
world, each with its own moons:

| effort | world | moons |
| --- | --- | --- |
| low | the Moon | |
| medium | Mars | Phobos, Deimos |
| high | Earth | the Moon |
| xhigh | Saturn, rings and all | Enceladus, Titan |
| max | Jupiter, its Great Red Spot turning | Io, Europa, Ganymede, Callisto |
| a thinking budget | Neptune | Triton |
| no effort setting | Pluto | Charon |

**The permission mode picks the scene**, and Claude's work fills it in, by
requests and tool calls, or by its task list where it keeps one:

- **orbit** (the usual modes): the probe charts its orbit as Claude works; when
  Claude stops the orbit closes and the probe signals home.
- **survey** (plan mode): a beam sweeps the world and the map grows across it;
  done, the whole map flashes.
- **asteroid** (auto mode): the probe lasers an asteroid, which cracks as Claude
  works and shatters when Claude stops. Tougher with more effort: a stony
  asteroid at low, a comet at xhigh, a metal one at max.
- **apollo** (`/probe apollo`): Apollo 11, over black and the stars, with the
  real Earth and Moon lit as they were in July 1969, going only forward from
  turn to turn. As it is asked for the Saturn V lifts off from pad 39A, drops
  its stages, makes Earth orbit and burns for the Moon, and Columbia turns round
  to dock with Eagle; the coast out goes as far as the turn has got, and when
  Claude stops, Apollo goes behind the Moon into lunar orbit. Turns after that
  go on in lunar orbit, Eagle readied as each gets on: the burn that rounds out
  the orbit, Neil and Buzz powering Eagle up, its landing gear out. A
  `git commit` (or `gh pr create`) lands Eagle at Tranquility Base; turns after
  that go on from the Moon, and a `git push` (or a merge) puts Neil on the
  ladder, then the Moon, Buzz after him, and the flag up. Only the turn after
  the flag launches a new mission. Once the flag is up, drag over the picture
  (or scroll out) to pull back from the flag to the landing site seen from a
  distance, then up to orbit to see Earth rise over the Moon's horizon as
  Apollo 11 photographed it (AS11-44-6551); right-click to go back in.

**Every agent flies a craft of its own**, after a real mission (Voyager,
Cassini, Rosetta, Dawn, New Horizons...): it flies in when the agent starts,
orbits beside the probe, lasers the asteroid with it, and fires its engine and
flies off when the agent is done.

Drag over the picture to spin the world and tip it toward you; scroll to zoom
about the pointer; right-click to put it back.

| `/probe ...` | |
| --- | --- |
| `on`, `off` | the probe in the dashboard's place, or off it, kept across sessions |
| `orbit`, `survey`, `asteroid`, `apollo`, `follow` | keep a scene whatever the mode, or follow the mode again |
| `jupiter`, `saturn`, ... `effort` | keep a world whatever the effort, or let the effort pick again; Apollo 11, with its own Earth and Moon, stands down for it |
| `juno`, `voyager`, `cassini`, ... | the craft Claude flies (Juno unless asked) |
| `labels on`, `labels off` | names over the craft, where the picture is fine enough |
| `sound on`, `sound off` | blips, chirps, a laser and a boom; off until asked for |

Each shows at once, with no turn or restart for it, and from any session: one
typed in another shell reaches the panel's within two seconds. The panel itself
is closed while the dashboard's grid has a shell, and comes back with the change.

### Install

At the prompt of a terminal session:

```
/plugin install pixel-probe --marketplace jacobwillgolden-svg/space_mods
```

Answer `y` to add the marketplace, then pick a scope. From a shell, the same is
`claude plugin install pixel-probe --marketplace jacobwillgolden-svg/space_mods`. In the
desktop app, where `/plugin` does not run: click + next to the prompt box,
then Plugins, Add marketplace with `jacobwillgolden-svg/space_mods`, then Add plugin.

To run it from a clone instead: `claude --plugin-dir ./pixel-probe`, or name
the folder in `CLAUDE_CODE_PLUGIN_DIRS`.

## Other mods

Three more Claude Code mods that are not about space. Like the probe, each is
a set of function hooks with tests, written for kitty on Windows
([win-kitty](https://github.com/jacobwillgolden-svg/win-kitty-fork)).

### kitty-mood

The kitty window reacts to Claude. Its background leans towards a colour for
the permission mode (plan blue, auto red, accept-edits violet), the tab
breathes while Claude works, and the whole window flashes as a turn ends:
green when it answered, amber when it was stopped, red when it failed. The
title bar says the mode, the session's topic, what Claude is doing, how many
agents are out and how long the turn has run. The topic is Claude Code's own
session title once there is one; until then a small model names the session
from its first prompt (`$.model.complete`, `hooks/register.ts`).

| Command | What it does |
|---|---|
| `/kitty mood on\|off` | the tint, the tab and the flash |
| `/kitty title on\|off` | the title bar |
| `/opacity 1-100`, `/opacity reset` | how see-through the window is until Claude exits; kitty needs `dynamic_background_opacity yes` |
| `/win-kitty` | asks mc-rice's dashboard for a shell in its grid; with no dashboard it says so |

It reaches kitty by remote control, with a password that may only restyle a
window. In kitty's config folder, `claude-rc.conf`:

```
listen_on tcp:127.0.0.1:0
allow_remote_control password
remote_control_password "<a long random password>" set-colors set-tab-color set-window-title set-background-opacity set-user-vars
```

Put the same password, alone, in `claude-rc.pw` beside it, add
`include claude-rc.conf` to `kitty.conf`, and start Claude in a kitty opened
after that. What it changes is put back as the session ends.

### predict

Predictive text for the prompt box, the way a phone's keyboard has it. As you
type, three guesses follow the word at the caret, finishing it or offering
the next, learnt from the prompts you have sent before (Claude Code's
`history.jsonl`, read on your own machine; `hooks/words.ts`). A typo is
offered as the word it was a slip for. In an empty box after a turn the
guesses are whole prompts: what git's state suggests at once (commit, push, a
merge), then three from a fork of the conversation (`$.model.fork`,
`hooks/guess.ts`), with the prompts you send often.

The guesses are shown as three ovals by a strip on mc-rice's dashboard, which
is not in this repo, so on its own the mod works them out and shows nothing.
`/predict on|off`.

### aura-sync

`/aurasync on|off` keeps one choice, which mc-rice's dashboard reads to give
its jukebox the colours of an ASUS laptop's Aura lighting, and says in words
which effect it found. It only reads Aura's `LastScript.xml`.

## Wallpapers

![Jupiter and Juno in pixels over the violet panorama](docs/wallpaper.jpg)

The same worlds as a desktop or terminal wallpaper: the mod's own renderer
draws a world, its moons and the probe in big square pixels, laid over one of
the panoramas.

```
python tools/wallpaper.py jupiter
python tools/wallpaper.py saturn --panorama orion --size 2560x1440 --pixel 5
python tools/wallpaper.py --all
```

Saturn's rings reach past the probe's orbit, so its probe hangs clear of them
by default; `--probe-at x,y` puts the probe anywhere on the screen, drawn at a
moment its orbit has it behind the world (`--time` 6, 18, 30...), and
`--probe-at orbit` puts it back on its orbit.

They land in `wallpapers/`. It needs Node 23.6 or newer (to run the mod's
TypeScript as it is) and Pillow. In kitty, `background_image` in kitty.conf,
or `kitten @ set-background-image` for the window you are in.

## Panoramas

`panoramas/` holds three nebulae, and each scene's sky is drawn in
one's colors:

- `violet.jpg`: blue and violet, behind the orbit
- `orion.jpg`: rose, ember and teal, behind the survey
- `ember.jpg`: red and gold, behind the asteroid

## Making and checking

- `python pixel-probe/tools/sounds.py` synthesizes the clips in
  `pixel-probe/sounds/` (numpy).
- `claude plugin validate pixel-probe` and `claude plugin test pixel-probe`
  check the mod; the same two commands check `kitty-mood`, `predict` and
  `aura-sync`.

## License

MIT, for the code, the clips and the pictures in `docs/`. The panoramas were
made with Grok's image generator. The craft are named after real missions and
drawn as simple shapes; none of their agencies' artwork is used. Apollo 11's
Earth is filled in from Natural Earth's 1:110m land outlines, which are in the
public domain; its Moon's seas are traced from the albedo map of NASA's Lunar
Reconnaissance Orbiter, also in the public domain, and its craters are placed
by their coordinates or spread as the Moon's are.
