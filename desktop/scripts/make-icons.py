"""Generate the launcher icon (build/icon.png 512x512, build/icon.ico 16-256) with the standard library only.

Design: primary-blue rounded square with a white check mark. Deterministic; run from desktop/:
    python3 scripts/make-icons.py
"""
import struct
import sys
import zlib
from pathlib import Path

BLUE = (29, 78, 216)   # #1d4ed8
WHITE = (255, 255, 255)


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** 0.5


def sample(u, v):
    """Colour+alpha at unit-square coordinates (0..1)."""
    r, c = 0.2, 0.5  # corner radius, centre
    qx, qy = abs(u - c) - (0.5 - r), abs(v - c) - (0.5 - r)
    outside = (max(qx, 0) ** 2 + max(qy, 0) ** 2) ** 0.5 + min(max(qx, qy), 0) - r
    if outside > 0:
        return (0, 0, 0, 0)
    d = min(seg_dist(u, v, 0.27, 0.53, 0.43, 0.69), seg_dist(u, v, 0.43, 0.69, 0.74, 0.33))
    return (*(WHITE if d < 0.055 else BLUE), 255)


def render(size, ss=4):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    r, g, b, a = sample((x + (sx + .5) / ss) / size, (y + (sy + .5) / ss) / size)
                    acc[0] += r * a; acc[1] += g * a; acc[2] += b * a; acc[3] += a
            a = acc[3]
            row += bytes((round(acc[0] / a), round(acc[1] / a), round(acc[2] / a), round(a / (ss * ss)))) if a else bytes(4)
        rows.append(bytes(row))
    return rows


def png(size):
    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))
    raw = b''.join(render(size))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


def ico(sizes):
    images = [png(s) for s in sizes]
    head = struct.pack('<HHH', 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = b''
    for s, data in zip(sizes, images):
        entries += struct.pack('<BBBBHHII', 0 if s >= 256 else s, 0 if s >= 256 else s, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    return head + entries + b''.join(images)


def main():
    out = Path(__file__).resolve().parent.parent / 'build'
    out.mkdir(exist_ok=True)
    (out / 'icon.png').write_bytes(png(512))
    (out / 'icon.ico').write_bytes(ico([16, 24, 32, 48, 64, 128, 256]))
    print('wrote', out / 'icon.png', out / 'icon.ico')


if __name__ == '__main__':
    sys.exit(main())
