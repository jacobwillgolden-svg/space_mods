"""A wallpaper in pixels: one of pixel-probe's worlds, its moons and the probe,
drawn by the mod's own renderer in big square pixels over one of the
panoramas, as the Linux concept has Jupiter and Juno over the stars.

    python tools/wallpaper.py jupiter
    python tools/wallpaper.py saturn --panorama orion --size 2560x1440 --pixel 5
    python tools/wallpaper.py --all

Writes wallpapers/<world>-<panorama>.png. Needs Node 23.6 or newer (it runs
the mod's TypeScript as it is), and Pillow.
"""
import argparse
import subprocess
from pathlib import Path

from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
PANORAMAS = ROOT / 'panoramas'
OUT = ROOT / 'wallpapers'
WORLDS = ['moon', 'mars', 'earth', 'saturn', 'jupiter', 'neptune', 'pluto']
# Each world's own sky by default: the scene it is most often seen in suits it.
SKY = {'moon': 'violet', 'mars': 'ember', 'earth': 'violet', 'saturn': 'orion', 'jupiter': 'violet', 'neptune': 'violet', 'pluto': 'orion'}


def layer(world: str, width: int, height: int, args: argparse.Namespace) -> Image.Image:
    """The world over nothing, `width` by `height` of its own pixels."""
    pan_x, pan_y = (float(n) for n in args.pan.split(','))
    command = [
        'node', '--no-warnings', '--import', './tools/ts-loader.mjs', 'tools/layer.mjs',
        world, str(width), str(height), str(args.time), str(args.zoom), str(pan_x), str(pan_y), args.craft,
    ]
    rgba = subprocess.run(command, cwd=ROOT, check=True, capture_output=True).stdout
    return Image.frombytes('RGBA', (width, height), rgba)


def backdrop(name: str, width: int, height: int, dim: float) -> Image.Image:
    """The panorama scaled to cover the screen, cut to it, and dimmed so the world stands out."""
    image = Image.open(PANORAMAS / f'{name}.jpg').convert('RGB')
    scale = max(width / image.width, height / image.height)
    image = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    left, top = (image.width - width) // 2, (image.height - height) // 2
    image = image.crop((left, top, left + width, top + height))
    return ImageEnhance.Brightness(image).enhance(dim).convert('RGBA')


def wallpaper(world: str, panorama: str, args: argparse.Namespace) -> Path:
    width, height = (int(n) for n in args.size.lower().split('x'))
    small = layer(world, -(-width // args.pixel), -(-height // args.pixel), args)
    big = small.resize((small.width * args.pixel, small.height * args.pixel), Image.NEAREST).crop((0, 0, width, height))
    picture = Image.alpha_composite(backdrop(panorama, width, height, args.dim), big).convert('RGB')
    OUT.mkdir(exist_ok=True)
    path = OUT / f'{world}-{panorama}.png'
    picture.save(path, optimize=True)
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('world', nargs='?', choices=WORLDS, help='the world to draw')
    parser.add_argument('--all', action='store_true', help='every world, each over its own panorama')
    parser.add_argument('--panorama', choices=['violet', 'orion', 'ember'], help="the sky behind it (the world's own by default)")
    parser.add_argument('--size', default='1920x1080', help='the screen, WIDTHxHEIGHT')
    parser.add_argument('--pixel', type=int, default=4, help='how many screen pixels wide each of the world\'s pixels is')
    parser.add_argument('--zoom', type=float, default=1.45, help='how much bigger than in the pane the world is drawn')
    parser.add_argument('--pan', default='-0.12,0.06', help='where the view looks off the middle, as fractions of the screen: x,y')
    parser.add_argument('--time', type=float, default=4.0, help='seconds into its orbits: where the moons and the probe are')
    parser.add_argument('--craft', default='juno', help='the craft drawn orbiting it')
    parser.add_argument('--dim', type=float, default=0.8, help='how bright the panorama is kept, 0 to 1')
    args = parser.parse_args()
    if not args.all and args.world is None:
        parser.error('name a world, or --all')

    for world in WORLDS if args.all else [args.world]:
        print(wallpaper(world, args.panorama or SKY[world], args).relative_to(ROOT))


if __name__ == '__main__':
    main()
