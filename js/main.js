/* Wiring: patch in, file list out, and whichever view suits the open file. */
(function (root) {
	'use strict';

	var PV = root.PV = root.PV || {};
	var S = null;

	var patch = null;
	var openFile = null;

	function id(name) { return document.getElementById(name); }

	function boot() {
		S = PV.strings;

		PV.shell.init({ onPatch: load });
		PV.sidebar.init({
			list: id('filelist'),
			filter: id('filter'),
			flatBtn: id('flat-btn'),
			treeBtn: id('tree-btn'),
			progress: id('viewed-progress'),
			markAll: id('mark-all'),
			clearAll: id('clear-all')
		}, { onOpen: show });

		PV.diffview.init(id('editor'));
		PV.binaryview.init(id('binary'));

		wireHeader();
		wireKeyboard();

		window.addEventListener('hashchange', openFromHash);
		PV.shell.fromUrl();
	}

	function load(text, name) {
		var parsed = PV.patch.parse(text);

		if (!parsed.files.length) {
			PV.shell.banner(S.errorNotAPatch);
			return;
		}

		patch = parsed;
		openFile = null;

		var summary = PV.patch.summarize(parsed.files);
		PV.shell.showPatch(name, S.summary(summary), parsed.preamble.join('  '));

		if (parsed.warnings.length) {
			PV.shell.banner(S.warnings(parsed.warnings.length) + ': ' + parsed.warnings.slice(0, 3).join('; '));
		}

		PV.sidebar.setFiles(parsed.files, 'pv:viewed:' + PV.util.fnv1a(text));

		if (!openFromHash()) PV.sidebar.open(0);
	}

	function openFromHash() {
		var match = /^#f=(\d+)$/.exec(location.hash);
		if (!match || !patch) return false;

		var index = parseInt(match[1], 10);
		if (index < 0 || index >= patch.files.length) return false;
		if (openFile && openFile.index === index) return true;

		PV.sidebar.open(index);
		return true;
	}

	function pathHtml(file) {
		var path = file.displayPath;
		var at = path.lastIndexOf('/');
		var dir = at === -1 ? '' : path.slice(0, at + 1);
		var base = at === -1 ? path : path.slice(at + 1);
		return '<span class="dir">' + PV.util.escapeHtml(dir) + '</span>' + PV.util.escapeHtml(base);
	}

	function metaText(file) {
		var parts = [S.statusLabel[file.status] || file.status];

		if (file.status === 'renamed') parts.push(S.renamedFrom(file.oldPath));
		if (file.status === 'copied') parts.push(S.copiedFrom(file.oldPath));
		if (file.similarity != null) parts.push(S.similarity(file.similarity));
		if (file.modeChanged && file.oldMode !== file.newMode) parts.push(S.modeChange(file.oldMode, file.newMode));
		/* A combined diff parses to no hunks, so +0 −0 would misdescribe it. */
		if (!file.isBinary && !file.combined) parts.push('+' + file.additions + ' −' + file.deletions);

		return parts.join(' · ');
	}

	function show(file) {
		openFile = file;

		id('fh-path').innerHTML = pathHtml(file);
		id('fh-meta').textContent = metaText(file);
		id('fh-actions').hidden = false;
		id('fh-viewed').checked = !!PV.sidebar.state.viewed[file.index];
		id('btn-side').hidden = file.isBinary || file.combined;
		id('btn-wrap').hidden = file.isBinary || file.combined;

		if (location.hash !== '#f=' + file.index) {
			history.replaceState(null, '', '#f=' + file.index);
		}

		if (file.isBinary) {
			PV.diffview.clear();
			id('editor').hidden = true;
			id('binary').hidden = false;
			PV.binaryview.show(file);
		} else {
			PV.binaryview.clear();
			id('binary').hidden = true;
			id('editor').hidden = false;
			PV.diffview.show(file);
		}
	}

	function copy(text, button) {
		var label = button.textContent;

		navigator.clipboard.writeText(text).then(function () {
			button.textContent = S.copied;
			setTimeout(function () { button.textContent = label; }, 1200);
		});
	}

	function wireHeader() {
		id('btn-side').addEventListener('click', function () {
			var next = !PV.diffview.options.sideBySide;
			PV.diffview.setOption('sideBySide', next);
			this.classList.toggle('on', next);
			this.textContent = next ? S.sideBySide : S.inline;
		});

		id('btn-wrap').addEventListener('click', function () {
			var next = !PV.diffview.options.wrap;
			PV.diffview.setOption('wrap', next);
			this.classList.toggle('on', next);
		});

		id('btn-copy-path').addEventListener('click', function () {
			if (openFile) copy(openFile.displayPath, this);
		});

		id('btn-copy-diff').addEventListener('click', function () {
			if (openFile) copy(openFile.raw, this);
		});

		id('fh-viewed').addEventListener('change', function () {
			if (openFile) PV.sidebar.toggleViewed(openFile.index);
		});
	}

	function wireKeyboard() {
		window.addEventListener('keydown', function (event) {
			var target = event.target;
			var typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

			if (event.metaKey || event.ctrlKey || event.altKey) return;

			if (event.key === '/' && !typing) {
				event.preventDefault();
				PV.sidebar.focusFilter();
				return;
			}

			if (typing) return;

			/* Monaco owns its own key handling; only act when focus is outside it. */
			if (target && target.closest && target.closest('.monaco-editor') && event.key !== 'Escape') {
				if (['j', 'k', 't', 'n', 'p'].indexOf(event.key) !== -1) return;
			}

			switch (event.key) {
			case 'j':
			case 'ArrowDown':
				event.preventDefault();
				PV.sidebar.moveCursor(1);
				break;
			case 'k':
			case 'ArrowUp':
				event.preventDefault();
				PV.sidebar.moveCursor(-1);
				break;
			case 'Enter':
				event.preventDefault();
				PV.sidebar.openCursor();
				break;
			case 'n':
				PV.diffview.nextHunk();
				break;
			case 'p':
				PV.diffview.prevHunk();
				break;
			case 't':
				PV.sidebar.toggleMode();
				break;
			case ' ':
				if (openFile) {
					event.preventDefault();
					PV.sidebar.toggleViewed(PV.sidebar.state.cursor);
					if (PV.sidebar.state.cursor === openFile.index) {
						id('fh-viewed').checked = !!PV.sidebar.state.viewed[openFile.index];
					}
				}
				break;
			case 'Escape':
				PV.sidebar.clearFilter();
				break;
			}
		});
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
	else boot();
}(typeof window !== 'undefined' ? window : globalThis));
