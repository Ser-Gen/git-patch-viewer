#!/usr/bin/env python3
"""
Regenerates fixtures/images.patch — the fixture that stands in for a real-world
patch: nested directories, text files with separated hunks, and binary files
covering all four combinations of forward/reverse block kinds.

git writes two blocks per binary file, the forward patch (a->b) then the reverse
(b->a), and picks `literal` or `delta` per direction by whichever is smaller.
Hitting all four combinations on purpose takes a little care:

  literal/literal  the two versions share nothing, so no delta helps
  delta/delta      a small edit inside a large incompressible image
  literal/delta    the new version is a large uniform block plus the old bytes:
                   the delta format cannot compress runs but deflate can, so the
                   forward literal wins while the reverse stays a cheap copy
  delta/literal    the same pair, reversed

    python3 fixtures/make-images.py
"""

import os
import random
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'images.patch')
PREAMBLE = '# patch viewer sample | ветка: master | 2026-01-01T09:15:00.000Z'

W = 64
NOISE_H = 28
PAD_H = 60


def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)


def png(width, height, rows, level=0):
    raw = b''.join(b'\x00' + row for row in rows)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, level))
            + chunk(b'IEND', b''))


def noise_rows(height, seed, width=W):
    rnd = random.Random(seed)
    return [bytes(rnd.randrange(256) for _ in range(width * 3)) for _ in range(height)]


def flat_rows(height, byte):
    return [bytes([byte]) * (W * 3) for _ in range(height)]


def edited(rows, band=(6, 12)):
    out = [bytearray(r) for r in rows]
    for y in range(*band):
        for x in range(len(out[y])):
            out[y][x] = 0x20
    return [bytes(r) for r in out]


CSS_BEFORE = """/* main stylesheet */
@import "modules/_reset";
@import "modules/_buttonSet";
@import "modules/_productPhoto";
@import "modules/_imgsGroup";

/* TABLE OF CONTENTS
   1. layout
   2. components
   3. utilities
*/

.layout {
	display: grid;
	grid-template-columns: 1fr;
	gap: 16px;
}

.layout__header {
	position: sticky;
	top: 0;
}

.button {
	border-radius: 4px;
	padding: 6px 12px;
}
"""

PHP_BEFORE = """<?php

function ErrorPage($param = [])
{
	$defaults = [
		'type' => '404',
		'state' => null,
		'title' => null,
	];

	$options = array_merge($defaults, $param);

	if (empty($options['title'])) {
		$options['title'] = 'Страница не найдена';
	}

	$classes = [
		'ErrorPage',
		'ErrorPage--' . $options['type'],
	];

	return render($classes, $options);
}
"""


def run(cwd, *args):
    subprocess.run(args, cwd=cwd, check=True, capture_output=True)


def write(root, rel, data):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    mode = 'wb' if isinstance(data, bytes) else 'w'
    with open(path, mode) as handle:
        handle.write(data)


def build(root):
    noise = noise_rows(NOISE_H, 21)
    shared_big = flat_rows(PAD_H, 0xAA) + noise
    brand = 'assets/img/dest/brand/'
    icons = 'assets/img/dest/interface/'

    # --- the state before the change ---
    write(root, brand + 'logo-rewritten.png', png(W, 40, noise_rows(40, 2)))
    write(root, icons + 'icon-edited.png', png(W, 48, noise_rows(48, 3)))
    write(root, icons + 'icon-grown.png', png(W, NOISE_H, noise))
    write(root, icons + 'icon-shrunk.png', png(W, PAD_H + NOISE_H, shared_big))
    write(root, icons + 'icon-removed.png', png(W, 16, noise_rows(16, 4)))
    # changes both dimensions, so an overlay must size itself to the union
    write(root, icons + 'icon-resized.png', png(96, 40, noise_rows(40, 8, 96)))
    write(root, 'assets/css/src/_main.css', CSS_BEFORE)
    write(root, 'assets/_layouts/src/pages/404.php', PHP_BEFORE)
    write(root, 'notes.txt', '\n'.join('line %d' % i for i in range(1, 41)) + '\n')

    run(root, 'git', 'init', '-q', '.')
    run(root, 'git', 'config', 'user.email', 'fixtures@example.invalid')
    run(root, 'git', 'config', 'user.name', 'Fixtures')
    run(root, 'git', 'add', '-A')
    run(root, 'git', 'commit', '-qm', 'before')

    # --- the state after ---
    write(root, brand + 'logo-rewritten.png', png(W, 40, noise_rows(40, 77)))       # literal/literal
    write(root, brand + 'logo-added.png', png(W, 24, noise_rows(24, 5)))            # added
    write(root, icons + 'icon-edited.png', png(W, 48, edited(noise_rows(48, 3))))   # delta/delta
    write(root, icons + 'icon-grown.png', png(W, PAD_H + NOISE_H, shared_big))      # literal/delta
    write(root, icons + 'icon-shrunk.png', png(W, NOISE_H, noise))                  # delta/literal
    write(root, icons + 'icon-resized.png', png(40, 72, noise_rows(72, 9, 40)))
    os.remove(os.path.join(root, icons + 'icon-removed.png'))
    write(root, 'desk/assets/img/sprite.bin', bytes(range(256)) * 6)   # added: not an image, so it gets a hex dump

    css = CSS_BEFORE.replace('@import "modules/_imgsGroup";', '@import "modules/_imgsGroup";\n@import "modules/_errorPage";')
    css = css.replace('\tpadding: 6px 12px;', '\tpadding: 8px 14px;\n\tcursor: pointer;')
    write(root, 'assets/css/src/_main.css', css)

    php = PHP_BEFORE.replace("		'title' => null,", "		'title' => null,\n		'content' => null,")
    php = php.replace("	return render($classes, $options);", "	$classes[] = 'ErrorPage--' . $options['state'];\n\n	return render($classes, $options);")
    write(root, 'assets/_layouts/src/pages/404.php', php)

    lines = ['line %d' % i for i in range(1, 41)]
    lines[1] = 'line 2 CHANGED'
    lines[32] = 'line 33 CHANGED'
    write(root, 'notes.txt', '\n'.join(lines) + '\n')

    run(root, 'git', 'add', '-A')
    return subprocess.run(['git', 'diff', '--cached', '--binary'], cwd=root, check=True, capture_output=True).stdout


def main():
    root = tempfile.mkdtemp(prefix='pv-fixture-')
    try:
        patch = build(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    with open(OUT, 'wb') as handle:
        handle.write(PREAMBLE.encode() + b'\n' + patch)

    print('wrote ' + OUT + ' (%d bytes)' % (len(patch) + len(PREAMBLE) + 1))


if __name__ == '__main__':
    sys.exit(main())
