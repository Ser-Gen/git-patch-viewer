# git-patch-viewer

A static browser tool for reading `.patch` files produced by git. No build step:
plain ES5 scripts, a vendored copy of Monaco, and nothing else.

## Running it

The page needs to be served over `http://` (Monaco's AMD loader and the `?url=`
parameter both fail under `file://`):

```sh
npm run serve                 # python3 -m http.server 8777
open http://127.0.0.1:8777/
```

Load a patch by dropping it on the window, picking it with **Open patch…**,
pasting patch text, or deep-linking to one:

```
http://127.0.0.1:8777/?url=fixtures/images.patch
```

## What it shows

**Text files** are rendered in Monaco's diff editor. A patch contains only its
hunks, so the viewer builds two virtual documents out of them and restores the
real line numbers through Monaco's `lineNumbers` callback — the gutter reads
`43, 44, 45`, not `1, 2, 3`. Context that the patch does not contain appears as
a `⋯ 42 unchanged lines not contained in the patch` band. Those bands cannot be
expanded: the lines are genuinely absent from the file, not hidden.

Added and deleted files arrive complete, so they show no bands at all.

**Binary files** are decoded from `GIT binary patch` blocks: git base85 →
zlib inflate → optionally a delta application. git writes two blocks per binary
file, the forward patch (a→b) and the reverse (b→a), and whenever either one is
a `literal` the viewer holds a complete blob and can reconstruct its counterpart
from the other block's delta. Images then get a before/after comparison with
side-by-side, swipe and onion-skin modes over a transparency checkerboard. When
the two versions differ in size, the swipe and onion stages span whichever is
larger and anchor both to the top left, so a resize reads as one version not
filling the frame rather than as a rescaled image.

When **both** blocks are deltas, neither blob is in the patch and no tool can
reconstruct the image. The viewer says so and shows what it does know — the blob
hashes, and the source and target sizes read out of the delta headers.

Non-image binaries get a hex dump of the first 256 bytes and a download link.

## Keyboard

| key | |
|---|---|
| `j` / `k`, `↓` / `↑` | move the cursor |
| `Enter` | open the file under the cursor |
| `n` / `p` | next / previous hunk |
| `Space` | toggle viewed |
| `t` | flat list / tree |
| `/` | filter, `Esc` clears |

"Viewed" state is kept in `localStorage`, keyed by a hash of the patch content,
so it survives a reload and does not leak between different patches.

## Layout

```
index.html            shell and script order
css/app.css
js/util.js            hashing, byte formatting, escaping
js/strings.js         every user-visible string (swap this file to localise)
js/parse/base85.js    git's base85 alphabet and line-length prefixes
js/parse/delta.js     git delta format: varint header, copy/insert opcodes
js/parse/patch.js     patch text -> FileChange[]
js/parse/hunks.js     hunks -> virtual documents + line-number maps
js/parse/binary.js    binary blocks -> before/after bytes
js/ui/shell.js        input, banner, drop target, resizer
js/ui/sidebar.js      flat/tree, filter, badges, viewed state
js/ui/diffview.js     Monaco host and the raw fallback
js/ui/binaryview.js   image comparison and metadata cards
js/main.js            wiring
vendor/monaco/        monaco-editor 0.52.2 (min/vs)
```

The `js/parse` layer touches no DOM, which is what lets it be unit-tested in
Node.

## Tests

```sh
npm test               # parse layer, in Node: 95 checks
npm run test:browser   # end-to-end in Chrome: 80 checks
npm run test:all
```

`tests/run.js` evaluates the browser sources in a Node VM context and checks the
parser, the virtual-document builder and the binary decoder against the fixtures.

`fixtures/images.patch` is the main one: nested directories, a non-git preamble
line, text files with separated hunks, and binary files covering **all four**
combinations of forward/reverse block kinds, so every branch of the decoder is
exercised — including the two asymmetric cases that reconstruct a blob from the
opposite block's delta. It also carries an image that changes both dimensions,
which is what the overlay comparison has to size itself around. Regenerate it with `python3 fixtures/make-images.py`;
that script explains how each combination is provoked, and the suite asserts all
four are still present so a regenerated fixture cannot silently lose one.

`fixtures/edge-cases.patch` was generated from a throwaway repository and carries
a rename, a copy, a deletion, a mode-only change, a C-quoted Cyrillic path, a
path with spaces, `\ No newline at end of file`, and both an added and a
modified binary.
`fixtures/edge-cases-crlf.patch` is the same patch saved with CRLF endings, and
`fixtures/edge-cases-nobinary.patch` is the same diff taken without `--binary`,
which carries only `Binary files … differ` and no file data. `fixtures/combined-merge.patch`
is a real `diff --cc` from a resolved merge conflict.

`tests/browser.js` starts its own static server and drives Chrome through
playwright-core (`npm install` first). Set `PW_CHROME` to a browser binary if
the `chrome` channel is not installed.

## Limits

- `git format-patch` mailboxes are not grouped by commit; the files of a series
  appear as one flat set.
- Combined merge diffs (`diff --cc`) are recognised but not rendered as a two-way
  diff: they show a card naming the format, followed by the raw patch text.
- Nothing is ever written back: this reads patches, it does not apply them.

Outstanding work — untested paths, cosmetic rough edges and deferred features —
is listed in `PLAN.md` §6.
