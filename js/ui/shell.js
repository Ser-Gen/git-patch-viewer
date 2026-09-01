/* Chrome around the two panes: patch input, banner, drop target, resizer. */
(function (root) {
	'use strict';

	var PV = root.PV = root.PV || {};
	var S = null;
	var el = {};
	var onPatch = function () {};

	function id(name) { return document.getElementById(name); }

	function init(callbacks) {
		S = PV.strings;
		onPatch = callbacks.onPatch;

		el = {
			dropzone: id('dropzone'),
			dragOverlay: id('drag-overlay'),
			fileInput: id('file-input'),
			banner: id('banner'),
			bannerText: id('banner-text'),
			patchName: id('patch-name'),
			summary: id('summary'),
			preamble: id('preamble'),
			sidebar: id('sidebar'),
			resizer: id('resizer')
		};

		applyStrings();
		wireInput();
		wireResizer();
	}

	function applyStrings() {
		document.title = S.appName;
		document.querySelector('.brand').textContent = S.appName;
		id('dz-keys-title').textContent = S.shortcutsTitle;
		id('dz-title').textContent = S.dropHint;
		id('dz-sub').textContent = S.dropSub;
		id('drag-text').textContent = S.dropOverlay;
		id('open-btn').textContent = S.openFile;
		id('tree-btn').textContent = S.tree;
		id('flat-btn').textContent = S.flat;
		id('filter').placeholder = S.filterPlaceholder;
		id('mark-all').textContent = S.markAllViewed;
		id('clear-all').textContent = S.clearViewed;
		id('btn-side').textContent = S.sideBySide;
		id('btn-wrap').textContent = S.wrap;
		id('btn-copy-path').textContent = S.copyPath;
		id('btn-copy-diff').textContent = S.copyDiff;
		id('fh-viewed').parentNode.appendChild(document.createTextNode(' ' + S.viewed));

		id('dz-keys').innerHTML = S.shortcuts.map(function (pair) {
			return '<b>' + PV.util.escapeHtml(pair[0]) + '</b><span>' + PV.util.escapeHtml(pair[1]) + '</span>';
		}).join('');
	}

	function readFile(file) {
		var reader = new FileReader();

		id('dz-title').textContent = S.loading;

		reader.onload = function () {
			onPatch(decode(new Uint8Array(reader.result)), file.name);
			/* A successful load hides the drop zone; restoring the hint matters
			   only when the file turned out not to be a patch. */
			id('dz-title').textContent = S.dropHint;
		};
		reader.onerror = function () {
			id('dz-title').textContent = S.dropHint;
			banner(S.errorRead);
		};
		reader.readAsArrayBuffer(file);
	}

	/* Patch bodies can carry mixed encodings; fall back to latin1 so that a
	   file with a few invalid UTF-8 bytes still opens instead of failing. */
	function decode(bytes) {
		try {
			return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		} catch (err) {
			return new TextDecoder('windows-1252').decode(bytes);
		}
	}

	function wireInput() {
		el.dropzone.addEventListener('click', function () { el.fileInput.click(); });
		id('open-btn').addEventListener('click', function () { el.fileInput.click(); });

		el.fileInput.addEventListener('change', function () {
			if (el.fileInput.files[0]) readFile(el.fileInput.files[0]);
		});

		var depth = 0;

		window.addEventListener('dragenter', function (event) {
			event.preventDefault();
			depth++;
			el.dragOverlay.classList.add('show');
		});

		window.addEventListener('dragover', function (event) { event.preventDefault(); });

		window.addEventListener('dragleave', function () {
			depth = Math.max(0, depth - 1);
			if (!depth) el.dragOverlay.classList.remove('show');
		});

		window.addEventListener('drop', function (event) {
			event.preventDefault();
			depth = 0;
			el.dragOverlay.classList.remove('show');
			if (event.dataTransfer.files[0]) readFile(event.dataTransfer.files[0]);
		});

		window.addEventListener('paste', function (event) {
			var text = event.clipboardData && event.clipboardData.getData('text/plain');
			if (text && /^diff --git |\ndiff --git /.test(text)) {
				event.preventDefault();
				onPatch(text, 'pasted');
			}
		});

		id('banner-close').addEventListener('click', function () { el.banner.classList.remove('show'); });
	}

	function wireResizer() {
		var dragging = false;

		el.resizer.addEventListener('mousedown', function (event) {
			dragging = true;
			event.preventDefault();
			document.body.style.cursor = 'col-resize';
		});

		window.addEventListener('mousemove', function (event) {
			if (!dragging) return;
			var width = Math.min(720, Math.max(180, event.clientX));
			el.sidebar.style.width = width + 'px';
		});

		window.addEventListener('mouseup', function () {
			dragging = false;
			document.body.style.cursor = '';
		});
	}

	function fromUrl() {
		var params = new URLSearchParams(location.search);
		var url = params.get('url') || params.get('file');
		if (!url) return false;

		id('dz-title').textContent = S.loading;

		fetch(url).then(function (response) {
			if (!response.ok) throw new Error(response.status);
			return response.arrayBuffer();
		}).then(function (buffer) {
			onPatch(decode(new Uint8Array(buffer)), url.slice(url.lastIndexOf('/') + 1));
			id('dz-title').textContent = S.dropHint;
		}).catch(function () {
			id('dz-title').textContent = S.dropHint;
			banner(S.errorFetch(url));
		});

		return true;
	}

	function banner(text) {
		el.bannerText.textContent = text;
		el.banner.classList.add('show');
	}

	function showPatch(name, summaryText, preambleText) {
		el.dropzone.style.display = 'none';
		el.patchName.textContent = name;
		el.summary.textContent = summaryText;
		el.preamble.textContent = preambleText || '';
		el.preamble.title = preambleText || '';
	}

	PV.shell = { init: init, fromUrl: fromUrl, banner: banner, showPatch: showPatch };
}(typeof window !== 'undefined' ? window : globalThis));
