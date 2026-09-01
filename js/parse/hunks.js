/*
 * A patch has hunks, Monaco's DiffEditor wants whole files. This builds two
 * virtual documents out of the hunks alone and records, for each virtual line,
 * the real line number it had in the original file - which is fed back to
 * Monaco through the `lineNumbers` callback so the gutter reads correctly.
 */
(function (root) {
	'use strict';

	var PV = root.PV = root.PV || {};

	var LANGUAGE_BY_EXTENSION = {
		js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
		ts: 'typescript', tsx: 'typescript', json: 'json', jsonc: 'json',
		php: 'php', phtml: 'php', css: 'css', scss: 'scss', sass: 'scss', less: 'less',
		html: 'html', htm: 'html', vue: 'html', twig: 'html', tpl: 'html',
		xml: 'xml', svg: 'xml', xsl: 'xml', xsd: 'xml', plist: 'xml',
		md: 'markdown', markdown: 'markdown', py: 'python', rb: 'ruby', go: 'go',
		rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
		c: 'c', h: 'c', cpp: 'cpp', cxx: 'cpp', cc: 'cpp', hpp: 'cpp', hxx: 'cpp',
		cs: 'csharp', sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
		yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini',
		sql: 'sql', graphql: 'graphql', gql: 'graphql', lua: 'lua', pl: 'perl',
		r: 'r', scala: 'scala', dart: 'dart', ps1: 'powershell', bat: 'bat',
		dockerfile: 'dockerfile', tf: 'hcl', proto: 'proto', txt: 'plaintext'
	};

	var LANGUAGE_BY_NAME = {
		dockerfile: 'dockerfile', makefile: 'makefile', 'cmakelists.txt': 'cmake',
		'.gitignore': 'plaintext', '.gitattributes': 'plaintext', '.env': 'ini'
	};

	function languageFor(path) {
		var base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
		if (LANGUAGE_BY_NAME[base]) return LANGUAGE_BY_NAME[base];
		return LANGUAGE_BY_EXTENSION[PV.util.extensionOf(path)] || 'plaintext';
	}

	/* Added and deleted files arrive complete, so they have no missing context
	   and should show no gap bands at all. */
	function isComplete(file) {
		return file.status === 'added' || file.status === 'deleted';
	}

	function buildDiffDocs(file) {
		var original = [];
		var modified = [];
		var origMap = [];
		var modMap = [];
		var gaps = [];
		var anchors = [];
		var complete = isComplete(file);
		var nextOld = 1;
		var nextNew = 1;

		function pushGap(oldCount, newCount, atEnd) {
			var text = PV.strings.gapLabel(oldCount, newCount, atEnd);
			original.push(text);
			modified.push(text);
			origMap.push(null);
			modMap.push(null);
			gaps.push({ originalLine: original.length, modifiedLine: modified.length });
		}

		for (var h = 0; h < file.hunks.length; h++) {
			var hunk = file.hunks[h];
			var gapOld = hunk.oldStart - nextOld;
			var gapNew = hunk.newStart - nextNew;

			if (!complete && (gapOld > 0 || gapNew > 0)) pushGap(gapOld, gapNew, false);

			anchors.push({
				originalLine: original.length + 1,
				modifiedLine: modified.length + 1,
				section: hunk.section,
				oldStart: hunk.oldStart,
				newStart: hunk.newStart
			});

			var oldLine = hunk.oldStart;
			var newLine = hunk.newStart;

			for (var i = 0; i < hunk.lines.length; i++) {
				var entry = hunk.lines[i];

				if (entry.kind === ' ') {
					original.push(entry.text);
					modified.push(entry.text);
					origMap.push(oldLine++);
					modMap.push(newLine++);
				} else if (entry.kind === '-') {
					original.push(entry.text);
					origMap.push(oldLine++);
				} else {
					modified.push(entry.text);
					modMap.push(newLine++);
				}
			}

			nextOld = hunk.oldStart + hunk.oldLines;
			nextNew = hunk.newStart + hunk.newLines;
		}

		/* The patch never says how long the file is, so a trailing gap can only
		   be reported as "there is more", never as a line count. */
		if (!complete && file.hunks.length) pushGap(-1, -1, true);

		return {
			originalText: original.join('\n'),
			modifiedText: modified.join('\n'),
			originalLines: original.length,
			modifiedLines: modified.length,
			origMap: origMap,
			modMap: modMap,
			gaps: gaps,
			anchors: anchors,
			complete: complete,
			language: languageFor(file.displayPath)
		};
	}

	function lineNumberFn(map) {
		return function (lineNumber) {
			var value = map[lineNumber - 1];
			return value == null ? '' : String(value);
		};
	}

	PV.hunks = {
		buildDiffDocs: buildDiffDocs,
		languageFor: languageFor,
		lineNumberFn: lineNumberFn,
		isComplete: isComplete
	};
}(typeof window !== 'undefined' ? window : globalThis));
