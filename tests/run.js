/*
 * Node runner for the DOM-free parse layer. The browser sources are classic
 * scripts, so they are simply evaluated into a shared context.
 *   node tests/run.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const context = vm.createContext({
	console, TextDecoder, TextEncoder, DecompressionStream, Blob, Response, URL, DataView, Uint8Array, Int16Array, Promise, Math, JSON, Object
});
context.globalThis = context;
context.window = undefined;

for (const file of ['js/util.js', 'js/strings.js', 'js/parse/base85.js', 'js/parse/delta.js', 'js/parse/patch.js', 'js/parse/hunks.js', 'js/parse/binary.js']) {
	vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

const PV = context.PV;
let passed = 0;
const failures = [];

function check(name, condition, detail) {
	if (condition) { passed++; return; }
	failures.push(name + (detail ? '  — ' + detail : ''));
}

function eq(name, actual, expected) {
	check(name, actual === expected, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }

/* ---------- fixtures: extended headers, paths, encodings ---------- */

const edge = PV.patch.parse(read('fixtures/edge-cases.patch'));
const byPath = {};
for (const f of edge.files) byPath[f.displayPath] = f;

eq('edge: file count', edge.files.length, 11);
eq('edge: no warnings', edge.warnings.length, 0, edge.warnings.join('; '));

eq('rename detected', byPath['src/newname.js'].status, 'renamed');
eq('rename old path', byPath['src/newname.js'].oldPath, 'src/oldname.js');
eq('rename similarity', byPath['src/newname.js'].similarity, 96);
eq('copy detected', byPath['src/multi-copy.txt'].status, 'copied');
eq('copy old path', byPath['src/multi-copy.txt'].oldPath, 'src/multi.txt');
eq('delete detected', byPath['src/gone.py'].status, 'deleted');
eq('add detected', byPath['src/added.css'].status, 'added');
eq('mode change flagged', byPath['src/script.sh'].modeChanged, true);
eq('mode change from', byPath['src/script.sh'].oldMode, '100644');
eq('mode change to', byPath['src/script.sh'].newMode, '100755');
check('mode-only change has no hunks', byPath['src/script.sh'].hunks.length === 0);

const cyrillic = 'src/тест файл.txt';
check('quoted UTF-8 path decoded', !!byPath[cyrillic], 'paths: ' + Object.keys(byPath).join(', '));
eq('spaces in path', byPath['dir with spaces/some file.md'].status, 'modified');

const noNewline = byPath['src/nonewline.txt'];
const lastLine = noNewline.hunks[0].lines[noNewline.hunks[0].lines.length - 1];
check('\\ No newline recorded on a line', noNewline.hunks[0].lines.some(l => l.noNewline), JSON.stringify(noNewline.hunks[0].lines));
check('\\ No newline is not a diff line', noNewline.hunks[0].lines.every(l => ' +-'.includes(l.kind)));

const multi = byPath['src/multi.txt'];
eq('two separated hunks', multi.hunks.length, 2);
eq('multi additions', multi.additions, 2);
eq('multi deletions', multi.deletions, 2);

eq('binary add is binary', byPath['img/new.png'].isBinary, true);
eq('binary add status', byPath['img/new.png'].status, 'added');
eq('binary modify has two blocks', byPath['img/base.png'].binary.blocks.length, 2);

/* Combined merge diffs: recognised and flagged, deliberately not rendered */
const cc = PV.patch.parse(read('fixtures/combined-merge.patch'));
eq('combined: one file', cc.files.length, 1);
eq('combined: flagged as combined', cc.files[0].combined, true);
eq('combined: path parsed', cc.files[0].displayPath, 'conflict.txt');
eq('combined: no ordinary hunks are invented', cc.files[0].hunks.length, 0);
eq('combined: no warnings', cc.warnings.length, 0, cc.warnings.join('; '));
check('combined: raw text is kept for display', cc.files[0].raw.indexOf('@@@ -1,5 -1,5 +1,5 @@@') !== -1);

/* A patch produced without --binary carries no file data at all */
const nobin = PV.patch.parse(read('fixtures/edge-cases-nobinary.patch'));
const nobinByPath = {};
for (const f of nobin.files) nobinByPath[f.displayPath] = f;
eq('no-binary: same file count', nobin.files.length, edge.files.length);
eq('no-binary: png is still binary', nobinByPath['img/base.png'].isBinary, true);
eq('no-binary: flagged as data-less', nobinByPath['img/base.png'].binary.differOnly, true);
eq('no-binary: no blocks', nobinByPath['img/base.png'].binary.blocks.length, 0);
eq('no-binary: added png still detected as added', nobinByPath['img/new.png'].status, 'added');
eq('no-binary: text files unaffected', nobinByPath['src/multi.txt'].hunks.length, 2);

/* CRLF-saved patch must parse identically */
const crlf = PV.patch.parse(read('fixtures/edge-cases-crlf.patch'));
eq('crlf: file count', crlf.files.length, edge.files.length);
eq('crlf: paths match', crlf.files.map(f => f.displayPath).join('|'), edge.files.map(f => f.displayPath).join('|'));
eq('crlf: no stray carriage returns', crlf.files.some(f => f.hunks.some(h => h.lines.some(l => /\r$/.test(l.text)))), false);

/* ---------- virtual documents and line-number maps ---------- */

const docs = PV.hunks.buildDiffDocs(multi);
const origLines = docs.originalText.split('\n');
const gapCount = docs.gaps.length;
check('gaps inserted between hunks', gapCount >= 2, 'gaps: ' + gapCount);
eq('anchors match hunks', docs.anchors.length, 2);
eq('first hunk real old line number', docs.origMap[docs.anchors[0].originalLine - 1], multi.hunks[0].oldStart);
eq('second hunk real old line number', docs.origMap[docs.anchors[1].originalLine - 1], multi.hunks[1].oldStart);
eq('gap rows have no line number', docs.origMap[docs.gaps[0].originalLine - 1], null);
check('gap text identical on both sides',
	origLines[docs.gaps[0].originalLine - 1] === docs.modifiedText.split('\n')[docs.gaps[0].modifiedLine - 1]);
const lineNo = PV.hunks.lineNumberFn(docs.origMap);
eq('lineNumbers callback maps real numbers', lineNo(docs.anchors[1].originalLine), String(multi.hunks[1].oldStart));
eq('lineNumbers callback blanks gaps', lineNo(docs.gaps[0].originalLine), '');

const addedDocs = PV.hunks.buildDiffDocs(byPath['src/added.css']);
eq('added file is complete', addedDocs.complete, true);
eq('added file has no gaps', addedDocs.gaps.length, 0);
eq('added file original is empty', addedDocs.originalText, '');
eq('language detection', addedDocs.language, 'css');
eq('language detection: php', PV.hunks.languageFor('a/b/ErrorPage.php'), 'php');
eq('language detection: svg as xml', PV.hunks.languageFor('logo.svg'), 'xml');
eq('language detection: unknown', PV.hunks.languageFor('LICENSE'), 'plaintext');

/* ---------- the images fixture: every binary block combination ---------- */

const images = PV.patch.parse(read('fixtures/images.patch'));
const imagesByPath = {};
for (const f of images.files) imagesByPath[f.displayPath] = f;
const imagesSummary = PV.patch.summarize(images.files);

eq('images: file count', imagesSummary.files, 11);
eq('images: binary files', imagesSummary.binary, 8);
eq('images: text files', imagesSummary.text, 3);
eq('images: added', imagesSummary.added, 2);
eq('images: deleted', imagesSummary.deleted, 1);
eq('images: no warnings', images.warnings.length, 0, images.warnings.join('; '));
eq('images: a non-git preamble line is kept', images.preamble.length, 1);
check('images: the preamble is the sample header', images.preamble[0].startsWith('# patch viewer sample'));
check('images: the preamble keeps its non-ASCII text', images.preamble[0].indexOf('ветка') !== -1);
check('images: every binary file has a forward and a reverse block',
	images.files.filter(f => f.isBinary).every(f => f.binary.blocks.length === 2));

/* The fixture exists to cover all four combinations; if a regenerated fixture
   ever loses one, the decoder would silently stop being tested for it. */
const combos = {};
for (const f of images.files.filter(x => x.isBinary)) {
	combos[f.binary.blocks[0].kind + '/' + f.binary.blocks[1].kind] = true;
}
check('images: literal/literal is covered', combos['literal/literal']);
check('images: delta/delta is covered', combos['delta/delta']);
check('images: literal/delta is covered', combos['literal/delta']);
check('images: delta/literal is covered', combos['delta/literal']);

const cssDocs = PV.hunks.buildDiffDocs(imagesByPath['assets/css/src/_main.css']);
eq('images: css language detected', cssDocs.language, 'css');
eq('images: two hunks in the css file', imagesByPath['assets/css/src/_main.css'].hunks.length, 2);
check('images: the css file has gap bands', cssDocs.gaps.length >= 2);
eq('images: php language detected', PV.hunks.buildDiffDocs(imagesByPath['assets/_layouts/src/pages/404.php']).language, 'php');

/* ---------- binary decoding ---------- */

async function binaryChecks() {
	const png = byPath['img/new.png'];
	const resolved = await PV.binary.resolve(png);
	check('fixture png decodes', !!resolved.after, resolved.error || resolved.reason);
	const size = PV.binary.pngSize(resolved.after);
	check('fixture png header readable', size && size.width === 4 && size.height === 4, JSON.stringify(size));

	const modified = await PV.binary.resolve(byPath['img/base.png']);
	check('fixture png modify resolves both sides', !!modified.before && !!modified.after, modified.error || modified.reason);

	const dataless = await PV.binary.resolve(nobinByPath['img/base.png']);
	eq('no-binary: resolve reports differOnly', dataless.reason, 'differOnly');
	check('no-binary: no bytes are invented', !dataless.before && !dataless.after);

	const decoded = {};
	const tally = { pair: 0, afterOnly: 0, beforeOnly: 0, unviewable: 0, error: 0 };

	for (const file of images.files.filter(f => f.isBinary)) {
		const r = await PV.binary.resolve(file);
		decoded[file.displayPath] = r;
		if (r.error) { tally.error++; failures.push('decode error on ' + file.displayPath + ': ' + r.error); continue; }
		if (r.before && r.after) tally.pair++;
		else if (r.after) tally.afterOnly++;
		else if (r.before) tally.beforeOnly++;
		else if (r.reason === 'deltaOnly') tally.unviewable++;
	}

	eq('images: no decode errors', tally.error, 0);
	eq('images: files with a before/after pair', tally.pair, 4);
	eq('images: added files carry only an after', tally.afterOnly, 2);
	eq('images: deleted files carry only a before', tally.beforeOnly, 1);
	eq('images: unreconstructable files', tally.unviewable, 1);
	eq('images: every binary file is accounted for', tally.pair + tally.afterOnly + tally.beforeOnly + tally.unviewable, 8);

	/* literal/literal: both blobs are present outright */
	const rewritten = decoded['assets/img/dest/brand/logo-rewritten.png'];
	check('literal/literal keeps both blobs', rewritten.before.length === 7788 && rewritten.after.length === 7788);

	/* delta/literal: the reverse literal is the pre-image and the forward delta
	   rebuilds the post-image. literal/delta is the same pair mirrored, so the
	   two reconstructions must agree byte for byte. */
	const shrunk = decoded['assets/img/dest/interface/icon-shrunk.png'];
	const grown = decoded['assets/img/dest/interface/icon-grown.png'];
	eq('delta/literal reconstructs the post-image', shrunk.after.length, 5472);
	eq('literal/delta reconstructs the pre-image', grown.before.length, 5472);
	check('the forward and reverse reconstructions agree byte for byte',
		shrunk.after.length === grown.before.length && shrunk.after.every((b, i) => b === grown.before[i]));
	check('a reconstructed blob is a valid PNG', !!PV.binary.pngSize(shrunk.after));

	/* delta/delta: nothing can be recovered, but the header sizes still read */
	const edited = decoded['assets/img/dest/interface/icon-edited.png'];
	eq('delta/delta is reported as unviewable', edited.reason, 'deltaOnly');
	check('an unviewable entry still reports both sizes', edited.beforeSize > 0 && edited.afterSize > 0);
	check('an unviewable entry reports the delta size', edited.deltaSize > 0);

	/* both dimensions change here, which is what an overlay has to size around */
	const resized = decoded['assets/img/dest/interface/icon-resized.png'];
	const wasSize = PV.binary.pngSize(resized.before);
	const nowSize = PV.binary.pngSize(resized.after);
	check('a resized image keeps both versions', !!resized.before && !!resized.after);
	check('the before dimensions are read', wasSize.width === 96 && wasSize.height === 40, JSON.stringify(wasSize));
	check('the after dimensions are read', nowSize.width === 40 && nowSize.height === 72, JSON.stringify(nowSize));

	check('a non-image binary still decodes', !!decoded['desk/assets/img/sprite.bin'].after);
	eq('a non-image binary is not treated as an image', PV.binary.isImage('desk/assets/img/sprite.bin'), false);
}

binaryChecks().then(() => {
	console.log('\n' + passed + ' checks passed, ' + failures.length + ' failed');
	for (const f of failures) console.log('  FAIL  ' + f);
	process.exit(failures.length ? 1 : 0);
}).catch(err => {
	console.log('runner crashed: ' + err.stack);
	process.exit(1);
});
