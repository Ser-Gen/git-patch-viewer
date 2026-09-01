/*
 * Monaco host. Feeds the DiffEditor the virtual documents built in
 * parse/hunks.js and restores the real line numbers through the `lineNumbers`
 * callback. Falls back to a plain rendering of the raw diff if the CDN is
 * unreachable, so the tool degrades rather than showing an empty pane.
 */
(function (root) {
	'use strict';

	var PV = root.PV = root.PV || {};
	var S = null;

	/* Monaco is vendored under vendor/monaco so the viewer works offline and
	   pins its own version. Resolved against the page so the tool can be
	   served from a sub-path. */
	var MONACO_BASE = new URL('vendor/monaco', location.href).href.replace(/\/$/, '');
	var BIG_DIFF_LINES = 20000;

	var monacoPromise = null;
	var monaco = null;
	var editor = null;
	var models = [];
	var decorations = [];
	var host = null;
	var editorHost = null;
	var altHost = null;
	var current = null;
	var options = { sideBySide: true, wrap: false };

	function loadMonaco() {
		if (monacoPromise) return monacoPromise;

		monacoPromise = new Promise(function (resolve, reject) {
			root.MonacoEnvironment = {
				baseUrl: MONACO_BASE + '/',
				getWorkerUrl: function () { return MONACO_BASE + '/vs/base/worker/workerMain.js'; }
			};

			var timer = setTimeout(function () { reject(new Error('timeout')); }, 25000);
			var script = document.createElement('script');

			script.src = MONACO_BASE + '/vs/loader.js';
			script.onerror = function () { clearTimeout(timer); reject(new Error('loader')); };
			script.onload = function () {
				root.require.config({ paths: { vs: MONACO_BASE + '/vs' } });
				root.require(['vs/editor/editor.main'], function () {
					clearTimeout(timer);
					quietenLanguageServices(root.monaco);
					resolve(root.monaco);
				}, function (err) {
					clearTimeout(timer);
					reject(err);
				});
			};

			document.head.appendChild(script);
		});

		return monacoPromise;
	}

	/* The virtual documents are hunks, not whole files, so they are incomplete
	   by construction. Language services would mark every truncated construct
	   as an error, so validation is turned off across the board. */
	function quietenLanguageServices(monacoApi) {
		var languages = monacoApi.languages;

		try {
			languages.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
			languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
		} catch (err) { /* language service absent */ }

		try {
			languages.json.jsonDefaults.setDiagnosticsOptions({ validate: false, allowComments: true, schemaValidation: 'ignore' });
		} catch (err) { /* language service absent */ }

		['css', 'scss', 'less'].forEach(function (name) {
			try {
				languages[name][name + 'Defaults'].setOptions({ validate: false });
			} catch (err) { /* language service absent */ }
		});
	}

	function themeName() {
		return matchMedia('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs';
	}

	function init(container) {
		S = PV.strings;
		host = container;

		/* Monaco keeps its own DOM, so placeholders and the raw fallback get a
		   separate node instead of overwriting the editor's. */
		editorHost = document.createElement('div');
		editorHost.className = 'editor-host';
		altHost = document.createElement('div');
		altHost.className = 'alt-host';
		host.appendChild(editorHost);
		host.appendChild(altHost);

		matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
			if (monaco) monaco.editor.setTheme(themeName());
		});
	}

	function ensureEditor() {
		if (editor) return editor;

		editor = monaco.editor.createDiffEditor(editorHost, {
			automaticLayout: true,
			readOnly: true,
			originalEditable: false,
			renderSideBySide: options.sideBySide,
			wordWrap: options.wrap ? 'on' : 'off',
			ignoreTrimWhitespace: false,
			renderWhitespace: 'selection',
			renderOverviewRuler: true,
			scrollBeyondLastLine: false,
			fontSize: 12,
			minimap: { enabled: true },
			theme: themeName()
		});

		return editor;
	}

	function disposeModels() {
		decorations.forEach(function (collection) { collection.clear(); });
		decorations = [];

		if (editor) editor.setModel(null);
		models.forEach(function (model) { model.dispose(); });
		models = [];
	}

	function gapDecorations(docs, side) {
		return docs.gaps.map(function (gap) {
			var line = side === 'original' ? gap.originalLine : gap.modifiedLine;
			return {
				range: new monaco.Range(line, 1, line, 1),
				options: {
					isWholeLine: true,
					className: 'gap-line',
					linesDecorationsClassName: 'gap-glyph',
					hoverMessage: { value: S.gapTooltip }
				}
			};
		});
	}

	function showEditor(visible) {
		editorHost.hidden = !visible;
		altHost.hidden = visible;
		if (visible) altHost.innerHTML = '';
	}

	function renderWithMonaco(file, docs) {
		ensureEditor();
		showEditor(true);
		editor.layout();
		disposeModels();

		var original = monaco.editor.createModel(docs.originalText, docs.language);
		var modified = monaco.editor.createModel(docs.modifiedText, docs.language);

		models = [original, modified];
		editor.setModel({ original: original, modified: modified });

		editor.getOriginalEditor().updateOptions({ lineNumbers: PV.hunks.lineNumberFn(docs.origMap) });
		editor.getModifiedEditor().updateOptions({ lineNumbers: PV.hunks.lineNumberFn(docs.modMap) });

		decorations = [
			editor.getOriginalEditor().createDecorationsCollection(gapDecorations(docs, 'original')),
			editor.getModifiedEditor().createDecorationsCollection(gapDecorations(docs, 'modified'))
		];

		current = { file: file, docs: docs, hunk: -1 };
	}

	function escapeDiffLine(line) {
		var text = PV.util.escapeHtml(line) || '&nbsp;';
		var kind = '';

		/* `---` and `+++` are file headers, not content: colouring them as a
		   deletion and an addition would misread the diff. */
		if (line.indexOf('---') === 0 || line.indexOf('+++') === 0) kind = 'h';
		else if (line.charAt(0) === '+') kind = 'a';
		else if (line.charAt(0) === '-') kind = 'd';
		else if (line.indexOf('@@') === 0) kind = 'm';
		else if (line.indexOf('diff ') === 0 || line.indexOf('index ') === 0) kind = 'h';

		return '<span class="ln ' + kind + '">' + text + '</span>';
	}

	function renderRaw(file, message, title, body) {
		var lines = file.raw.split('\n').map(escapeDiffLine).join('');
		var heading = title || S.monacoFailed;
		var text = body || message;
		showEditor(false);
		altHost.innerHTML = (text ? '<div class="card" style="margin:12px"><h3>' + PV.util.escapeHtml(heading) +
			'</h3><p>' + PV.util.escapeHtml(text) + '</p></div>' : '') +
			'<pre class="raw">' + lines + '</pre>';
		current = { file: file, docs: null, hunk: -1 };
	}

	function renderPlaceholder(html) {
		showEditor(false);
		altHost.innerHTML = '<div class="placeholder">' + html + '</div>';
	}

	function show(file, force) {
		current = null;

		/* Combined diffs carry a column per merge parent, so they parse to no
		   ordinary hunks. Without this they would claim to change nothing. */
		if (file.combined) {
			renderRaw(file, null, S.combinedTitle, S.combinedBody);
			return;
		}

		if (!file.hunks.length) {
			renderPlaceholder('<div class="big">' + S.noHunks + '</div><div>' + S.noHunksHint + '</div>');
			return;
		}

		var docs = PV.hunks.buildDiffDocs(file);
		var size = Math.max(docs.originalLines, docs.modifiedLines);

		if (size > BIG_DIFF_LINES && !force) {
			renderPlaceholder('<div class="big">' + S.bigFileWarning(size) + '</div>' +
				'<button id="render-anyway">' + S.renderAnyway + '</button>');
			var button = altHost.querySelector('#render-anyway');
			button.addEventListener('click', function () { show(file, true); });
			return;
		}

		if (monaco) {
			renderWithMonaco(file, docs);
			return;
		}

		renderPlaceholder('<div>' + S.monacoLoading + '</div>');

		loadMonaco().then(function (api) {
			monaco = api;
			renderWithMonaco(file, docs);
		}).catch(function () {
			renderRaw(file, S.monacoFailedHint);
		});
	}

	function goToHunk(delta) {
		if (!current || !current.docs || !editor) return;

		var anchors = current.docs.anchors;
		if (!anchors.length) return;

		current.hunk = Math.min(anchors.length - 1, Math.max(0, current.hunk + delta));

		var anchor = anchors[current.hunk];
		var target = editor.getModifiedEditor();
		var line = anchor.modifiedLine;

		if (line > target.getModel().getLineCount()) {
			target = editor.getOriginalEditor();
			line = anchor.originalLine;
		}

		target.revealLineNearTop(line);
		target.setPosition({ lineNumber: line, column: 1 });
	}

	function setOption(name, value) {
		options[name] = value;
		if (!editor) return;
		editor.updateOptions({
			renderSideBySide: options.sideBySide,
			wordWrap: options.wrap ? 'on' : 'off'
		});
	}

	function clear() {
		disposeModels();
		current = null;
		if (altHost) altHost.innerHTML = '';
		if (editorHost) editorHost.hidden = true;
	}

	PV.diffview = {
		init: init,
		show: show,
		clear: clear,
		nextHunk: function () { goToHunk(1); },
		prevHunk: function () { goToHunk(-1); },
		setOption: setOption,
		options: options
	};
}(typeof window !== 'undefined' ? window : globalThis));
