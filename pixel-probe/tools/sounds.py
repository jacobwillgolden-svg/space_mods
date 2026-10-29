"""The probe's sound effects, synthesized: sine sweeps, chimes, filtered
noise. Nothing is recorded or taken from anywhere, so the clips are as free
to share as the code. Writes 16-bit mono WAVs to ../sounds/.

    python tools/sounds.py
"""
import wave
from pathlib import Path

import numpy as np

RATE = 22050
OUT = Path(__file__).resolve().parent.parent / 'sounds'
# Every clip peaks this loud: a picture on the dashboard, not an alarm.
PEAK = 0.45


def seconds(length: float) -> np.ndarray:
    return np.arange(int(RATE * length)) / RATE


def envelope(t: np.ndarray, attack: float, decay: float) -> np.ndarray:
    """Up over `attack` seconds, then dying away with time constant `decay`."""
    rise = np.clip(t / max(attack, 1e-4), 0, 1)
    return rise * np.exp(-np.maximum(t - attack, 0) / decay)


def sweep(t: np.ndarray, start: float, end: float, curve: str = 'exp') -> np.ndarray:
    """A tone gliding from `start` to `end` Hz over the clip."""
    length = t[-1] if len(t) else 1
    if curve == 'exp':
        k = np.log(end / start) / length
        phase = 2 * np.pi * start * (np.exp(k * t) - 1) / k
    else:
        phase = 2 * np.pi * (start * t + (end - start) * t * t / (2 * length))
    return np.sin(phase)


def bell(t: np.ndarray, hz: float, decay: float) -> np.ndarray:
    """A struck bell: the note and two quieter partials, dying away."""
    tone = np.sin(2 * np.pi * hz * t) + 0.4 * np.sin(2 * np.pi * hz * 2.76 * t) + 0.2 * np.sin(2 * np.pi * hz * 5.4 * t)
    return tone * envelope(t, 0.004, decay)


def noise(n: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).uniform(-1, 1, n)


def low_pass(signal: np.ndarray, cutoff: np.ndarray | float) -> np.ndarray:
    """A one-pole low-pass, its cutoff in Hz free to move over the clip."""
    cut = np.broadcast_to(np.asarray(cutoff, dtype=float), signal.shape)
    alpha = 1 - np.exp(-2 * np.pi * cut / RATE)
    out = np.empty_like(signal)
    level = 0.0
    for i, (x, a) in enumerate(zip(signal, alpha)):
        level += a * (x - level)
        out[i] = level
    return out


def at(clip: np.ndarray, delay: float, length: float) -> np.ndarray:
    """`clip` placed `delay` seconds into silence `length` long."""
    out = np.zeros(int(RATE * length))
    start = int(RATE * delay)
    end = min(len(out), start + len(clip))
    out[start:end] += clip[: end - start]
    return out


def blip() -> np.ndarray:
    t = seconds(0.12)
    return sweep(t, 880, 1320) * envelope(t, 0.005, 0.04)


def tick() -> np.ndarray:
    t = seconds(0.05)
    return np.sin(2 * np.pi * 1600 * t) * envelope(t, 0.002, 0.012) * 0.6


def chime() -> np.ndarray:
    notes = [1046.5, 1318.5, 1568.0, 2093.0]
    return sum(at(bell(seconds(0.9), hz, 0.25), 0.11 * i, 1.3) for i, hz in enumerate(notes)) / 2


def scan() -> np.ndarray:
    t = seconds(0.45)
    return sweep(t, 300, 1200) * (0.6 + 0.4 * np.sin(2 * np.pi * 24 * t)) * envelope(t, 0.02, 0.2)


def chirp() -> np.ndarray:
    t = seconds(0.08)
    return sweep(t, 1200, 2400) * envelope(t, 0.003, 0.025)


def ping() -> np.ndarray:
    t = seconds(1.2)
    tone = np.sin(2 * np.pi * 1400 * t) * envelope(t, 0.003, 0.3)
    return tone + 0.35 * at(tone, 0.3, 1.2)[: len(tone)]


def rumble() -> np.ndarray:
    t = seconds(0.7)
    return low_pass(noise(len(t), 1), 180) * 6 * envelope(t, 0.2, 0.25)


def zap() -> np.ndarray:
    t = seconds(0.16)
    tone = sweep(t, 2000, 300)
    return np.sign(tone) * np.abs(tone) ** 0.5 * envelope(t, 0.002, 0.06) * 0.5


def boom() -> np.ndarray:
    t = seconds(1.1)
    blast = low_pass(noise(len(t), 2), 2500 * np.exp(-t * 4) + 120) * 3
    thump = np.sin(2 * np.pi * 55 * t) * 0.8
    return (blast + thump) * envelope(t, 0.004, 0.3)


def whoosh() -> np.ndarray:
    t = seconds(0.55)
    rise = np.sin(np.pi * t / t[-1]) ** 2
    return low_pass(noise(len(t), 3), 300 + 2500 * rise) * 2.5 * rise


CLIPS = {
    'blip': blip, 'tick': tick, 'chime': chime,
    'scan': scan, 'chirp': chirp, 'ping': ping,
    'rumble': rumble, 'zap': zap, 'boom': boom,
    'whoosh': whoosh,
}


def write(name: str, signal: np.ndarray) -> None:
    peak = np.max(np.abs(signal)) or 1
    # A few milliseconds faded at each end, so no clip clicks.
    fade = np.minimum(1, np.minimum(np.arange(len(signal)), np.arange(len(signal))[::-1]) / (RATE * 0.003))
    samples = (signal / peak * PEAK * fade * 32767).astype('<i2')
    with wave.open(str(OUT / f'{name}.wav'), 'wb') as clip:
        clip.setnchannels(1)
        clip.setsampwidth(2)
        clip.setframerate(RATE)
        clip.writeframes(samples.tobytes())


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for name, make in CLIPS.items():
        write(name, make())
        print(f'sounds/{name}.wav')


if __name__ == '__main__':
    main()
