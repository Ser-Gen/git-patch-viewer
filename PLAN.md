# git-patch-viewer — implementation plan

A zero-build, static browser tool for reading `.patch` files produced by git.

---

## 0. What the sample patch actually contains (measured, not assumed)

Everything below was verified by decoding `1.patch` with a throwaway Node prototype.
**That sample is no longer part of the repository**; the measurements are kept because they
drove the design. `fixtures/images.patch` now reproduces every case it covered — see §6.

| Fact | Value |
|---|---|
| Format | plain `git diff` output, **not** a format-patch mailbox |
| Preamble | one custom non-git line: `# servant patch \| ветка: master \| 2026-08-20T...` (UTF-8 Cyrillic) |
| Files | 235 |
| Text files | 12 (7 `.php`, 2 `.svg`, 2 `.css`, 1 `.js`) |
| Binary files | 223 (all `.png`, all as `GIT binary patch`) |
| New files | 10 · renames 0 · deletions 0 · mode changes 0 · `\ No newline` 0 |
| Longest line | 2578 chars |

**The binary blocks are the interesting part.** Git emits two blocks per binary file:
the *forward* patch (a→b) then the *reverse* patch (b→a). Each is git-base85 over
zlib-deflated bytes. All 223 forward blocks inflate with zero failures. The four
combinations in this patch, and what each makes possible:

| forward / reverse | count | before image | after image |
|---|---|---|---|
| `literal` / `literal` | 56 | ✅ reverse literal | ✅ forward literal |
| `delta` / `literal` | 41 | ✅ reverse literal | ✅ apply forward delta to it *(verified 41/41)* |
| `literal` / `delta` | 7 | ✅ apply reverse delta to forward literal *(verified 7/7)* | ✅ forward literal |
| `delta` / `delta` | 119 | ❌ base blob absent | ❌ base blob absent |

So **104 of 223 images can be shown with a real before/after pair**, and 119 genuinely
cannot be reconstructed from the patch alone — no tool can, the pre-image bytes are
simply not in the file. For those we show honest metadata, never a blank box.

Even for `delta`/`delta` we can still read the source and target byte sizes out of the
delta header varints (e.g. `logo_precomposed.png: 5179 B → 5158 B, delta 10 B`), so the
"unviewable" card is still informative.

## 1. Locked decisions

| Question | Decision |
|---|---|
| Diff engine | Monaco `DiffEditor` fed **hunk-only virtual documents**; real line numbers restored via the `lineNumbers` callback; inter-hunk gaps rendered as collapsed separators. Fully standalone. |
| Binary | Decode literals **and apply deltas where the counterpart block supplies the base**; metadata card for the rest. |
| Packaging | Static, no build step. Drag-drop / file picker / paste **plus** `?url=` for deep links (needs `http://`, e.g. `npx serve`). |
| Main pane | One file at a time, single reused Monaco instance. |
| Sidebar | Flat/tree toggle + filter, status badges + counts, keyboard nav, viewed checkboxes. |
| Parser scope | Renames/copies/mode changes **and** path/encoding edge cases. No format-patch mailbox, no `diff --cc`. |
| UI text | English, all strings in one `strings.js` table so a locale can drop in later. |
| Monaco | ~~CDN only~~ **vendored** under `vendor/monaco` (0.52.2), pinned and offline; explicit error card plus a raw-diff fallback if it fails to load. *(changed during implementation at the user's request)* |

## 2. Layout

```
index.html          shell, CDN tags, layout skeleton
css/app.css
js/
  main.js           bootstrap, routing, wiring
  strings.js        every user-visible string
  parse/
    patch.js        patch text -> FileChange[]
    hunks.js        hunk -> virtual docs + line-number maps
    base85.js       git b85 alphabet + line-length prefix decode
    delta.js        git delta format (varint header, copy/insert opcodes)
    binary.js       GIT binary patch block -> {before, after, reason}
  ui/
    sidebar.js      flat/tree, filter, badges, keyboard, viewed state
    diffview.js     Monaco diff editor host
    binaryview.js   image compare / metadata card
    shell.js        header, summary bar, errors, drop target
```

Plain ES modules, no bundler. Monaco via its AMD loader, everything else `<script type="module">`.

## 3. Stages

Each stage ends in something runnable. Ship them in order.

---

### Stage 1 — Shell and input

**Goal:** open a patch and see its filenames.

- `index.html` with a two-pane layout (sidebar + content), drop target over the whole window.
- Input paths: drag-drop, `<input type=file>`, paste into the window, and `?url=<path>` via `fetch`.
- Read bytes as `ArrayBuffer`, decode as UTF-8 with a `latin1` fallback if the file has invalid
  UTF-8 sequences — patch bodies can legitimately carry mixed encodings.
- Skip any leading non-git preamble lines (the `# servant patch |…` header) and keep them to
  display in the header bar.
- `strings.js` in place from the first commit; no bare literals in the UI.

**Done when:** dropping `1.patch` prints "235 files" and a raw list of paths.

---

### Stage 2 — The parser

**Goal:** a clean data model. This is the load-bearing stage; everything else reads from it.

```js
FileChange {
  oldPath, newPath, displayPath,
  status: 'added'|'deleted'|'modified'|'renamed'|'copied',
  oldMode, newMode, oldSha, newSha, similarity,
  isBinary, hunks: Hunk[], binary: BinaryBlocks|null,
  additions, deletions
}
Hunk { oldStart, oldLines, newStart, newLines, section, lines: [{kind:' '|'+'|'-', text}] }
```

- Split on `diff --git`, then read the extended headers: `new file mode`, `deleted file mode`,
  `old mode`/`new mode`, `similarity index`, `rename from`/`rename to`, `copy from`/`copy to`,
  `index <sha>..<sha> <mode>`, `Binary files … differ`, `GIT binary patch`.
- **Paths are the trap.** Derive them from `---`/`+++` when present, falling back to the
  `diff --git` line. Handle: C-quoted paths (`"a/\320\272.txt"` → unescape octal + `\t \n \" \\`,
  then UTF-8 decode), spaces in paths, `/dev/null`, and `--no-prefix` / custom prefixes.
  The `diff --git a/x b/y` line is genuinely ambiguous when paths contain spaces — prefer
  `---`/`+++`, use the a/b line only for pure renames with no hunks.
- Handle `\ No newline at end of file` as a flag on the preceding line, not a diff line.
- Strip a trailing `-- \n2.x.y` signature if present. Tolerate CRLF throughout.
- Count additions/deletions per file while parsing.

**Test fixtures:** the sample has no renames, deletions, mode changes, quoted paths or
`\ No newline`. Generate a small `fixtures/` set with a throwaway repo (`git mv`, a file named
`тест файл.txt`, a chmod +x, a file with no trailing newline) so these paths are actually
exercised rather than merely written.

**Done when:** a parser unit check over `1.patch` + fixtures reports the expected per-status
counts and every path round-trips exactly.

---

### Stage 3 — File list: flat, tree, filter, keyboard

**Goal:** navigating 235 files is pleasant.

- Flat mode: full paths, dimmed directory / bright basename.
- Tree mode: collapsible directories; **collapse single-child chains** into one row
  (`assets/img/dest/brand/`) or the tree is 6 levels of noise for this patch.
- Per row: status badge (A/M/D/R/C), `+N −M` counts, a binary marker, and a distinct
  marker for "binary, not reconstructable".
- Summary bar: `235 files · 12 text · 223 binary · +N −M`.
- Filter box: case-insensitive substring across the full path, live, preserving tree structure
  (a match keeps its ancestors visible). `/` focuses it, `Esc` clears.
- Keyboard: `j`/`k` and `↑`/`↓` move selection, `Enter`/click opens, `n`/`p` jump hunks in the
  open file, `t` toggles flat/tree.
- Routing: `#f=<index>` (index, not path — paths contain `/` and non-ASCII); browser
  back/forward works. Selection state survives reload.
- Render the list as plain DOM but **do not** mount anything heavy per row; 235 rows is fine
  without virtualization, so skip it.

**Done when:** every file in the sample is reachable by keyboard alone, both modes, filter live.

---

### Stage 4 — Text diff via Monaco

**Goal:** real syntax-highlighted diffs from hunks alone.

The core trick — a patch has no full file, so build two **virtual documents** from the hunks:

- `original` = concatenation of ` ` and `-` lines, in order, across all hunks.
- `modified` = concatenation of ` ` and `+` lines.
- While building, record `origLineMap[i] → real old line number` and `modLineMap[i] → real new
  line number`. Feed these back with
  `diffEditor.getOriginalEditor().updateOptions({ lineNumbers: n => origLineMap[n-1] ?? '' })`
  and the same for the modified side. Line numbers then read as the real file's, not 1..N.
- Between hunks insert one **gap row**. Two options; start with the cheap one:
  1. *(v1)* a single placeholder line in both documents, styled via a Monaco decoration into a
     `⋯ 87 unchanged lines not in patch` band, added to `unchangedRegions`-style muted styling.
  2. *(later)* a real zone widget via `changeViewZones` so no fake line exists in the model.
- Language detection from the extension → Monaco language id (`php`, `css`, `javascript`,
  `xml` for `.svg`, sensible default `plaintext`). Map the handful the sample needs plus the
  common set; fall back to `plaintext` silently.
- One `createDiffEditor` instance, created once and reused: `setModel({original, modified})` on
  every file switch, and `dispose()` the previous two models to avoid leaking 235 models.
- Options: `renderSideBySide` toggle (side-by-side ⇄ inline), word wrap toggle, `readOnly: true`,
  `automaticLayout: true`, `renderWhitespace: 'selection'`, `ignoreTrimWhitespace: false`
  (a patch's whitespace changes are the point).
- New files (`--- /dev/null`) and deletions reconstruct **completely** — no gaps at all. Detect
  and skip the gap machinery there.
- Monaco load failure → a visible card plus a plain `<pre>` fallback rendering of the raw
  hunk text, so the tool degrades instead of dying.
- Language-service validation is switched off (TypeScript, JSON, CSS/SCSS/LESS): the virtual
  documents are hunks, so they are incomplete by construction and every truncated block would
  otherwise be marked as an error.

**Done when:** all 12 text files render side-by-side with correct real line numbers, correct
highlighting, and gap bands where context is missing.

---

### Stage 5 — Binary files

**Goal:** actually see the images. This is where the tool beats reading the patch in an editor.

Build in this order, each step independently useful:

1. **`base85.js`** — git's alphabet is
   `0-9 A-Z a-z !#$%&()*+-;<=>?@^_\`{|}~`. Every data line is prefixed by a length char
   (`A`–`Z` = 1–26 bytes, `a`–`z` = 27–52) followed by base85 in 5-char → 4-byte groups.
   Truncate the final group to the declared line length.
2. **inflate** — the payload is zlib-wrapped deflate, so
   `new Response(bytes).body.pipeThrough(new DecompressionStream('deflate'))`. No library, no
   dependency. (`'deflate-raw'` is the wrong one here.)
3. **`delta.js`** — git delta format: source-size varint, target-size varint, then opcodes.
   `op & 0x80` → copy from base, with offset bytes selected by bits 0–3 and length bytes by
   bits 4–6, `len === 0` meaning `0x10000`. `op !== 0 && !(op & 0x80)` → insert `op` literal
   bytes. `op === 0` is reserved → error. Validate that the produced length equals the target
   varint, and that the base length equals the source varint — this check is what turns silent
   corruption into a clear message.
4. **`binary.js` resolution table** — for each file, using forward block F and reverse block R:
   - F literal, R literal → before = R, after = F
   - F delta, R literal → before = R, after = applyDelta(R, F)
   - F literal, R delta → after = F, before = applyDelta(F, R)
   - F delta, R delta → **unresolvable**; keep sizes/SHAs only
5. **Render.** Blob URL + `<img>` for anything the browser displays natively (png/jpg/gif/webp/
   avif/svg/ico/bmp). Show dimensions (parse PNG IHDR at bytes 16–24 for an instant read, else
   `naturalWidth/Height` after load), byte size, and the delta between them.
   Compare modes: **side-by-side**, **swipe** (draggable divider), **onion-skin** (opacity
   slider). Checkerboard backdrop so PNG transparency is legible — several of these images are
   tiny logos where that matters.
   Non-image binaries: size, SHAs, a hex-dump of the first 256 bytes, and a download button.
6. **Unresolvable card.** State it plainly: *"Both directions are deltas — the original blob is
   not contained in this patch, so the image cannot be reconstructed."* plus
   `index <oldsha>..<newsha>`, `5179 B → 5158 B`, `delta 10 B`. 119 files in the sample land here
   and they should not look like a bug.

Decode lazily, per file, on open — never decode 223 images up front. Cache decoded results in a
`Map` keyed by file index; blob URLs get `URL.revokeObjectURL` on eviction.

**Done when:** 104 of the sample's images show a real before/after pair, and the other 119 show
the metadata card.

---

### Stage 6 — Viewed state

- Per-file checkbox, `Space` toggles the selected row; progress `12 / 235` in the summary bar.
- Persist in `localStorage` keyed by a hash of the patch content (a cheap FNV-1a over the text is
  plenty) so re-opening the same patch restores progress and a *different* patch does not
  inherit it. Wrap every read/write in `try/catch` — private windows throw.
- "Mark all / clear all", and dim viewed rows.

---

### Stage 7 — Polish

- Errors that name the cause: not a patch file, truncated block, bad base85 char, delta size
  mismatch, `?url=` fetch blocked by CORS or `file://`.
- Empty states: no file selected, file with no hunks (pure rename / mode change only) — these
  render as an information card, not an empty editor.
- Large-patch guard: a file with a huge single hunk should not freeze Monaco; above ~20k lines,
  offer "render anyway".
- Copy buttons: file path, the file's raw diff text.
- Dark/light following `prefers-color-scheme`, with Monaco's theme switched to match.
- A short `README.md`: how to open it, why `?url=` needs a server, what the delta/delta
  limitation means.

## 4. Explicit non-goals

- `git format-patch` mailboxes and multi-commit series (no commit-level grouping layer).
- `diff --cc` / combined merge diffs.
- Applying patches, editing, or writing anything back.
- Reading the surrounding repo from disk — the tool stays a pure patch reader, which is why the
  119 delta/delta images stay unviewable by design.

## 5. Open questions to settle later

- Word-level intra-line diff is free from Monaco side-by-side, but the inline mode's rendering
  of it has never been eyeballed on a very long line (the sample had a 2578-char minified one).
- Whether the gap bands should be expandable at all — they can't be, without the source file.
  Current answer: no, and say so in the band's tooltip.

## 6. Pending

Everything known to be outstanding. Nothing here blocks use of the tool.

### Code paths that exist but nothing exercises

- **Drag-and-drop and paste.** Both are wired in `ui/shell.js`, and both are the *primary*
  way a patch gets opened, but the browser suite only covers the file picker and `?url=`.
  Testing drop means synthesising a `DataTransfer`; paste means a clipboard event.
- **Plain unified diffs with no `diff --git` headers.** `findBoundaries` in `parse/patch.js`
  falls back to `---`/`+++`/`@@` triples for `diff -u` output. Never tested, no fixture.
  The fallback deliberately requires all three lines, because a removed line beginning
  `-- ` is otherwise indistinguishable from a file header.

### Cosmetic rough edges

- The patch-level summary bar reads `+0 −0` for a patch containing only combined diffs.
  Not wrong — it aggregates what was parsed — but it reads oddly.
- Added and deleted files show git's all-zero SHA in the binary card's `blobs` row.
  It is what the patch contains, but 40 zeros is noise; showing only the real side
  would read better.
- A gap band announces that it cannot be expanded only through its hover tooltip. Someone
  who never hovers may just think the expand affordance is missing.

### Scale and ergonomics

- The file list renders every visible row. Fine at tens or hundreds; a patch with thousands
  of files would want virtualization.
- Sidebar width is draggable but not persisted, unlike viewed state.
- The list is built from `div`s with manual focus handling rather than a proper
  `role="listbox"`; keyboard use works, screen-reader use has not been considered.

### Deferred by decision, not oversight

- `git format-patch` mailboxes and commit-level grouping of a series.
- Rendering combined merge diffs as a real multi-parent diff (they currently show a card
  plus the raw text).
- Reading a local checkout to recover the blobs that delta/delta binary blocks lack.
- Applying, editing or writing anything back.

### Fixture note

`fixtures/images.patch` is generated by `fixtures/make-images.py`. Hitting all four
forward/reverse block combinations depends on details of how git chooses between a literal
and a delta, so the parse suite asserts that all four are still present: if the fixture is
regenerated and a combination disappears, that assertion fails rather than the decoder
silently going untested.
