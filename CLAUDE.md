# CLAUDE.md

A static browser viewer for git `.patch` files: file list (flat or tree), Monaco
diff for text, decoded before/after images for binaries. No build step, no
framework — classic scripts hanging off a single `PV` global, loaded in the
order given by `index.html`.

## Structure

```
index.html          script order matters; everything attaches to window.PV
css/app.css         light/dark via prefers-color-scheme
js/strings.js       every user-visible string lives here
js/parse/           base85.js, delta.js, patch.js, hunks.js, binary.js
js/ui/              shell.js, sidebar.js, diffview.js, binaryview.js
js/main.js          wiring
vendor/monaco/      monaco-editor 0.52.2, vendored deliberately
fixtures/images.patch   the main fixture: nested dirs, a preamble line, and all
                    four forward/reverse binary block combinations
fixtures/           also renames, copies, quoted paths, CRLF, no-newline,
                    a diff --cc merge, a diff taken without --binary
```

## Commands

```sh
npm run serve          # http://127.0.0.1:8777 — file:// does not work
npm test               # parse layer in a Node VM (95 checks)
npm run test:browser    # end-to-end in Chrome via playwright-core (80 checks)
npm run test:all
```

## The parts that are not obvious

**Diffs are built from hunks, not files.** A patch has no whole file, so
`parse/hunks.js` builds two virtual documents from the hunks and hands Monaco a
`lineNumbers` *callback* that maps virtual lines back to real ones. If the
gutter looks wrong, fix the map — do not renumber the documents. Gaps between
hunks are rendered as `⋯ N unchanged lines` bands and **cannot be expanded**:
those lines are absent from the patch, not hidden.

**Monaco language diagnostics are switched off on purpose**
(`quietenLanguageServices` in `diffview.js`). Hunk-only documents are
syntactically incomplete by construction, so validation would squiggle every
truncated block.

**Binary files come as two blocks**, the forward patch (a→b) and the reverse
(b→a). If either is a `literal` we hold a complete blob and the other block's
delta reconstructs its counterpart — that is how 104 of the sample's 223 images
get a real before/after pair. When *both* are deltas the blobs are simply not in
the patch and no amount of cleverness recovers them; those 119 files show a
metadata card by design. Do not try to "fix" them.

**The image overlay is sized by JavaScript, not CSS.** Before and after can have
different dimensions, so `layoutOverlay` in `binaryview.js` sets the stage to the
union of both and scales both images by one factor. The swipe is clipped by a
`.veil` sized to the stage — clipping the image itself would tie the boundary to
that image's width, so the two modes would disagree whenever the sizes differ.

**`js/parse/` must stay DOM-free.** `tests/run.js` evaluates those sources in a
Node VM context; a `document` reference anywhere in them breaks the suite.

**Monaco needs its own persistent node.** `diffview.js` keeps `editorHost` and
`altHost` siblings and toggles `hidden`; writing `innerHTML` over the editor's
container destroys it while the editor object survives.

**Outstanding work is listed in `PLAN.md` §6** — untested input paths, cosmetic
rough edges, and features deferred by decision. Check it before assuming
something is simply missing.

**The sidebar filter matches `oldPath` too**, so a renamed or copied file
matches its former name. Tests that click "the first matching row" need to
select by exact name.
