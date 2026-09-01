/*
 * End-to-end checks against a real browser.
 *
 *   npm install            # playwright-core (uses an installed Chrome)
 *   npm run test:browser   # starts a static server itself
 *
 * Set PW_CHROME to a Chrome/Chromium binary if the default channel is missing.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8788);
const BASE = 'http://127.0.0.1:' + PORT;

const TYPES = {
	'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
	'.json': 'application/json', '.patch': 'text/plain', '.ttf': 'font/ttf',
	'.svg': 'image/svg+xml', '.map': 'application/json'
};

const failures = [];
let passed = 0;

function check(name, ok, detail) {
	if (ok) { passed++; console.log('  ok   ' + name); return; }
	failures.push(name);
	console.log('  FAIL ' + name + (detail ? '  — ' + detail : ''));
}

function serve() {
	const server = http.createServer((req, res) => {
		const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
		const file = path.join(ROOT, rel || 'index.html');

		if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			res.writeHead(404).end('not found');
			return;
		}

		res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
		fs.createReadStream(file).pipe(res);
	});

	return new Promise(resolve => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

function launch() {
	const options = process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : { channel: 'chrome' };
	return chromium.launch(options);
}

/* A patch big enough to trip the large-diff guard. */
function hugePatch() {
	const lines = ['diff --git a/big.txt b/big.txt', 'index 1111111..2222222 100644', '--- a/big.txt', '+++ b/big.txt', '@@ -1,25000 +1,25000 @@'];
	for (let i = 1; i <= 25000; i++) lines.push(i === 3 ? '-changed' : ' line ' + i);
	lines.push('+changed');
	return lines.join('\n') + '\n';
}

async function run() {
	const server = await serve();
	const browser = await launch();
	const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
	const errors = [];

	const page = await context.newPage();
	page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
	page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
	page.on('response', r => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });

	/* Monaco renders spaces as non-breaking, so normalise before matching. */
	const plain = t => t.replace(/\u00a0/g, ' ');
	const blur = () => page.evaluate(() => document.activeElement && document.activeElement.blur());

	const open = async (query, exactName) => {
		await page.fill('#filter', query);
		await page.waitForTimeout(300);
		await page.click(exactName ? '#filelist .row.file:has(.name:text-is("' + exactName + '"))' : '#filelist .row.file');
		await page.waitForTimeout(1300);
	};

	console.log('\nimages fixture: text diffs');
	await page.goto(BASE + '/index.html?url=fixtures/images.patch', { waitUntil: 'load' });
	await page.waitForSelector('.monaco-diff-editor', { state: 'attached', timeout: 30000 });
	await page.waitForTimeout(1200);

	check('the window title comes from the strings table', (await page.title()) === 'Patch Viewer', await page.title());
	check('summary counts every file', (await page.textContent('#summary')).startsWith('11 files · 3 text · 8 binary'), await page.textContent('#summary'));
	check('the non-git preamble line is kept', (await page.textContent('#preamble')).indexOf('patch viewer sample') !== -1);

	await open('_main.css');
	const gutter = await page.$$eval('.monaco-diff-editor .original .line-numbers', els => els.map(e => e.textContent).filter(Boolean).slice(0, 6));
	check('gutter shows real file line numbers, not 1..n', gutter[0] !== '1' && Number(gutter[0]) > 1, JSON.stringify(gutter));
	check('gutter numbers are consecutive', gutter.every((n, i) => i === 0 || Number(n) === Number(gutter[i - 1]) + 1), JSON.stringify(gutter));
	const gapText = (await page.$$eval('.view-line', els => els.map(e => e.textContent).filter(t => t.indexOf('⋯') !== -1))).map(plain);
	check('missing context is shown as a gap band', gapText.some(t => /\d+ unchanged lines/.test(t)), JSON.stringify(gapText.slice(0, 2)));
	check('the tail of the file is marked too', gapText.some(t => t.indexOf('rest of the file') !== -1));
	check('gap rows are decorated', (await page.$$eval('.gap-line', e => e.length)) > 0);
	check('the diff is computed (a line is marked inserted)', (await page.$$eval('.line-insert', e => e.length)) > 0);

	await page.click('#btn-side');
	await page.waitForTimeout(600);
	check('side-by-side toggles to inline', (await page.textContent('#btn-side')) === 'Inline');
	await page.click('#btn-side');
	await page.waitForTimeout(400);

	console.log('\nimages fixture: binary files');
	await open('icon-shrunk.png');
	let shots = await page.$$eval('figure.shot img', els => els.map(e => e.naturalWidth + 'x' + e.naturalHeight));
	check('a forward-delta image is reconstructed on both sides', shots.length === 2 && shots[0] === '64x88' && shots[1] === '64x28', JSON.stringify(shots));
	check('captions carry size and dimensions', (await page.textContent('figure.shot figcaption')).indexOf('64 × 88 px') !== -1);

	await page.click('button[data-mode="swipe"]');
	await page.waitForTimeout(400);
	await page.$eval('.slider input', el => { el.value = 30; el.dispatchEvent(new Event('input', { bubbles: true })); });
	await page.waitForTimeout(200);
	check('swipe mode follows the slider', (await page.$eval('.overlay', el => el.style.getPropertyValue('--pos'))) === '30%');
	await page.click('button[data-mode="onion"]');
	await page.waitForTimeout(300);
	await page.$eval('.slider input', el => { el.value = 20; el.dispatchEvent(new Event('input', { bubbles: true })); });
	await page.waitForTimeout(200);
	check('onion mode follows the slider', (await page.$eval('.overlay', el => el.style.getPropertyValue('--opacity'))) === '0.2');

	/* before is 64x88 and after is 64x28 here, so a stage sized to the after
	   image would let the before image overflow onto the slider. */
	for (const mode of ['swipe', 'onion']) {
		await page.click('button[data-mode="' + mode + '"]');
		await page.waitForTimeout(500);
		const geom = await page.evaluate(() => {
			const box = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return { top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
			return { overlay: box('.overlay'), stage: box('.overlay .stage'), base: box('.overlay .base'), top: box('.overlay .top'), slider: box('.slider') };
		});
		check(mode + ': the stage is sized to the larger of the two images',
			Math.round(geom.stage.width) === 64 && Math.round(geom.stage.height) === 88, JSON.stringify(geom.stage));
		check(mode + ': the taller image stays inside the overlay',
			geom.top.bottom <= geom.overlay.bottom + 1 && geom.top.right <= geom.overlay.right + 1, JSON.stringify(geom));
		check(mode + ': the taller image does not reach the slider', geom.top.bottom <= geom.slider.top);
		check(mode + ': both images share the top-left anchor', Math.round(geom.base.top) === Math.round(geom.top.top));
	}

	await page.click('button[data-mode="swipe"]');
	await page.waitForTimeout(400);
	await page.$eval('.slider input', el => { el.value = 25; el.dispatchEvent(new Event('input', { bubbles: true })); });
	await page.waitForTimeout(200);
	const veil = await page.evaluate(() => ({
		veil: document.querySelector('.veil').getBoundingClientRect().width,
		stage: document.querySelector('.stage').getBoundingClientRect().width
	}));
	check('the swipe boundary is a fraction of the stage, not of one image',
		Math.round(veil.veil / veil.stage * 100) === 25, JSON.stringify(veil));
	check('the overlay shows the transparency checkerboard', await page.$eval('.overlay .stage', el => el.classList.contains('checker')));
	await page.click('button[data-mode="side"]');
	await page.waitForTimeout(300);
	check('side-by-side is restored', (await page.$$eval('figure.shot', e => e.length)) === 2);

	await open('icon-edited.png');
	check('a delta/delta image says so plainly', (await page.textContent('.card h3')).indexOf('cannot be reconstructed') !== -1);
	const meta = (await page.textContent('.card dl')).replace(/\s+/g, ' ');
	check('the unviewable card still reports sizes', /KB → .*KB/.test(meta), meta);
	check('the unviewable card reports the block kinds', meta.indexOf('delta / delta') !== -1, meta);

	await open('icon-resized.png');
	const resizedGeom = await (async () => {
		await page.click('button[data-mode="swipe"]');
		await page.waitForTimeout(500);
		return page.evaluate(() => {
			const box = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), right: b.right, bottom: b.bottom }; };
			return { stage: box('.overlay .stage'), overlay: box('.overlay'), base: box('.overlay .base'), top: box('.overlay .top') };
		});
	})();
	check('a stage spans the union of both dimensions', resizedGeom.stage.w === 96 && resizedGeom.stage.h === 72, JSON.stringify(resizedGeom.stage));
	check('a wider image does not overflow the overlay', resizedGeom.top.right <= resizedGeom.overlay.right + 1 && resizedGeom.base.right <= resizedGeom.overlay.right + 1, JSON.stringify(resizedGeom));

	await open('logo-added.png');
	check('an added image shows only an after', (await page.$$eval('figure.shot', e => e.length)) === 1);
	check('an added image says why there is no before', (await page.textContent('.card h3')).indexOf('no "before" image') !== -1, await page.textContent('.card h3'));

	await open('icon-removed.png');
	check('a deleted image shows only a before', (await page.$$eval('figure.shot', e => e.length)) === 1);

	await open('sprite.bin');
	check('a non-image binary is not shown as an image', (await page.$$eval('figure.shot', e => e.length)) === 0);
	check('a non-image binary explains itself', (await page.textContent('.card h3')).indexOf('Not a previewable image') !== -1, await page.textContent('.card h3'));
	check('a non-image binary gets a hex dump', (await page.$$eval('.hexdump', e => e.length)) === 1);
	check('the hex dump is offset, hex and ascii', /^0000000  00 01 02 03/.test((await page.textContent('.hexdump')).trim()), (await page.textContent('.hexdump')).slice(0, 40));

	console.log('\nnavigation');
	await page.fill('#filter', '');
	await blur();
	await page.waitForTimeout(300);
	const dirNames = await page.$$eval('#filelist .row.dir .name', els => els.map(e => e.textContent));
	check('single-child directory chains collapse into one row', dirNames.some(d => d.split('/').length > 2), JSON.stringify(dirNames.slice(0, 6)));

	await page.keyboard.press('t');
	await page.waitForTimeout(250);
	check('t switches to a flat list of every file', (await page.$$eval('#filelist .row.file', e => e.length)) === 11 && (await page.$$eval('#filelist .row.dir', e => e.length)) === 0);
	await page.keyboard.press('t');
	await page.waitForTimeout(250);

	await page.keyboard.press('j');
	await page.keyboard.press('j');
	await page.waitForTimeout(150);
	const cursor = await page.$eval('#filelist .row.cursor', e => e.dataset.index);
	check('j moves the cursor without opening', cursor !== (await page.$eval('#filelist .row.open', e => e.dataset.index)));
	await page.keyboard.press('Enter');
	await page.waitForTimeout(900);
	check('Enter opens the file under the cursor', (await page.$eval('#filelist .row.open', e => e.dataset.index)) === cursor);
	check('the URL hash tracks the open file', page.url().endsWith('#f=' + cursor), page.url());

	await page.keyboard.press('/');
	await page.waitForTimeout(150);
	check('/ focuses the filter box', await page.evaluate(() => document.activeElement.id === 'filter'));
	await page.fill('#filter', 'no-such-path');
	await page.waitForTimeout(250);
	check('an empty result explains itself', (await page.$$eval('.empty-hint', e => e.length)) === 1);
	await page.fill('#filter', '');
	await blur();
	await page.waitForTimeout(250);

	console.log('\nviewed state');
	await open('_main.css');
	const openedIndex = await page.$eval('#filelist .row.open', e => e.dataset.index);
	await page.click('#fh-viewed');
	await page.waitForTimeout(200);
	check('marking viewed dims the row', await page.$eval('#filelist .row.open', e => e.classList.contains('viewed')));
	check('progress counts viewed files', (await page.textContent('#viewed-progress')).startsWith('1 / 11'));
	await page.reload({ waitUntil: 'load' });
	await page.waitForTimeout(2200);
	check('viewed state survives a reload', (await page.textContent('#viewed-progress')).startsWith('1 / 11'));
	check('the hash reopens the same file', (await page.$eval('#filelist .row.open', e => e.dataset.index)) === openedIndex);
	await page.click('#mark-all');
	await page.waitForTimeout(300);
	check('mark all viewed', (await page.textContent('#viewed-progress')).startsWith('11 / 11'));
	await page.click('#clear-all');
	await page.waitForTimeout(250);
	check('clear viewed', (await page.textContent('#viewed-progress')).startsWith('0 / 11'));

	console.log('\nfixtures: renames, copies, modes, exotic paths');
	await page.goto(BASE + '/index.html?url=fixtures/edge-cases.patch', { waitUntil: 'load' });
	await page.waitForTimeout(1800);
	await blur();
	await page.keyboard.press('t');
	await page.waitForTimeout(300);
	const rows = await page.$$eval('#filelist .row.file', els => els.map(e => e.querySelector('.badge').textContent + ' ' + e.querySelector('.name').textContent));
	check('renames are labelled R', rows.some(r => r.startsWith('R ')), rows.join(' | '));
	check('copies are labelled C', rows.some(r => r.startsWith('C ')));
	check('deletions are labelled D', rows.some(r => r.startsWith('D ')));
	check('additions are labelled A', rows.some(r => r.startsWith('A ')));
	check('a C-quoted UTF-8 path is decoded', rows.some(r => r.indexOf('тест файл.txt') !== -1));
	check('a path containing spaces survives', rows.some(r => r.indexOf('some file.md') !== -1));

	await open('script.sh');
	check('a mode-only change reports the modes', (await page.textContent('#fh-meta')).indexOf('100644 → 100755') !== -1, await page.textContent('#fh-meta'));
	check('a mode-only change shows a card, not an empty editor', (await page.textContent('#viewport')).indexOf('changes no content') !== -1);

	await open('newname.js');
	check('a rename shows where it came from', (await page.textContent('#fh-meta')).indexOf('Renamed from src/oldname.js') !== -1);

	await open('src/multi.txt', 'multi.txt');
	const position = () => page.evaluate(() => window.monaco.editor.getEditors().map(e => e.getPosition().lineNumber).join(','));
	await page.click('#fh-meta');
	await page.keyboard.press('n');
	await page.waitForTimeout(400);
	const first = await position();
	await page.keyboard.press('n');
	await page.waitForTimeout(400);
	const second = await position();
	check('n walks forward through hunks', first !== second, first + ' -> ' + second);
	await page.keyboard.press('p');
	await page.waitForTimeout(400);
	check('p walks back', (await position()) === first);

	await page.goto(BASE + '/index.html?url=fixtures/edge-cases-nobinary.patch', { waitUntil: 'load' });
	await page.waitForTimeout(1500);
	await open('base.png');
	check('a patch made without --binary says it carries no data', (await page.textContent('.card h3')).indexOf('records only that the file changed') !== -1, await page.textContent('.card h3'));

	await page.goto(BASE + '/index.html?url=fixtures/combined-merge.patch', { waitUntil: 'load' });
	await page.waitForTimeout(1500);
	check('a combined merge diff is named, not called empty', (await page.textContent('.card h3')) === 'Combined merge diff', await page.textContent('.card h3'));
	check('a combined merge diff does not claim to change nothing', (await page.textContent('#viewport')).indexOf('changes no content') === -1);
	check('a combined merge diff still shows its raw text', (await page.textContent('pre.raw')).indexOf('@@@ -1,5 -1,5 +1,5 @@@') !== -1);
	check('a combined merge diff reports no misleading +0 −0', (await page.textContent('#fh-meta')).indexOf('+0') === -1, await page.textContent('#fh-meta'));
	check('a combined merge diff is tagged in the list', (await page.textContent('#filelist .row.file .counts')).trim() === 'merge');
	check('inert editor controls are hidden for it', await page.$eval('#btn-side', e => e.hidden));
	check('--- and +++ headers are not coloured as content', await page.$$eval('pre.raw .ln', els => {
		const header = els.filter(e => e.textContent.indexOf('--- a/') === 0 || e.textContent.indexOf('+++ b/') === 0);
		return header.length === 2 && header.every(e => e.classList.contains('h'));
	}));

	console.log('\nloading a patch from the file picker');
	const bigPatch = path.join(os.tmpdir(), 'pv-big.patch');
	fs.writeFileSync(bigPatch, hugePatch());
	await page.goto(BASE + '/index.html', { waitUntil: 'load' });
	await page.waitForTimeout(400);
	await page.setInputFiles('#file-input', bigPatch);
	await page.waitForTimeout(1500);
	check('a picked file is parsed and listed', (await page.$$eval('#filelist .row.file', e => e.length)) === 1);
	check('a very large diff is guarded, not rendered blindly', (await page.textContent('#viewport')).indexOf('may take a moment') !== -1);
	await page.click('#render-anyway');
	await page.waitForTimeout(4000);
	check('"render anyway" mounts the editor', (await page.$$eval('.monaco-diff-editor', e => e.length)) === 1);
	fs.unlinkSync(bigPatch);

	console.log('\ndegraded and error paths');
	const blocked = await context.newPage();
	await blocked.route('**/vendor/monaco/**', route => route.abort());
	await blocked.goto(BASE + '/index.html?url=fixtures/images.patch', { waitUntil: 'load' });
	await blocked.waitForTimeout(4000);
	await blocked.fill('#filter', '_main.css');
	await blocked.waitForTimeout(300);
	await blocked.click('#filelist .row.file');
	await blocked.waitForTimeout(600);
	check('a missing editor is explained', (await blocked.textContent('#viewport')).indexOf('could not be loaded') !== -1);
	check('the raw diff is rendered instead', (await blocked.$$eval('pre.raw', e => e.length)) === 1);
	check('the raw fallback marks additions', (await blocked.$$eval('pre.raw .a', e => e.length)) === 3);
	check('the raw fallback marks deletions', (await blocked.$$eval('pre.raw .d', e => e.length)) === 1);
	await blocked.fill('#filter', 'icon-shrunk.png');
	await blocked.waitForTimeout(300);
	await blocked.click('#filelist .row.file');
	await blocked.waitForTimeout(900);
	check('binary files still work with no editor', (await blocked.$$eval('figure.shot img', e => e.length)) === 2);
	await blocked.close();

	const bad = await context.newPage();
	await bad.goto(BASE + '/index.html?url=css/app.css', { waitUntil: 'load' });
	await bad.waitForTimeout(1000);
	check('a file that is not a patch is reported', (await bad.textContent('#banner-text')).indexOf('does not look like a git patch') !== -1);
	await bad.goto(BASE + '/index.html?url=missing.patch', { waitUntil: 'load' });
	await bad.waitForTimeout(1000);
	check('a failed fetch explains the http requirement', (await bad.textContent('#banner-text')).indexOf('npx serve') !== -1);
	await bad.close();

	check('no page errors, console errors or 404s along the way', errors.length === 0, errors.slice(0, 4).join(' | '));

	await browser.close();
	server.close();

	console.log('\n' + passed + ' checks passed, ' + failures.length + ' failed');
	process.exit(failures.length ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
