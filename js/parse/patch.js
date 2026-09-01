/*
 * Patch text -> FileChange[]. Handles `git diff` output including extended
 * headers (renames, copies, mode changes), C-quoted / non-ASCII paths, binary
 * blocks and `\ No newline at end of file`. Combined merge diffs (`diff --cc`)
 * are recognised and flagged, not rendered.
 */
(function (root) {
	'use strict';

	var PV = root.PV = root.PV || {};

	var HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
	var COMBINED_HUNK_RE = /^@@@+ /;
	var BINARY_BLOCK_RE = /^(literal|delta) (\d+)$/;
	var ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "'": 39, '\\': 92 };

	function splitLines(text) {
		var lines = text.split('\n');

		/* A patch saved with CRLF endings would otherwise carry a stray \r on
		   every line. Only strip when the file as a whole looks like CRLF, so
		   that a genuine line-ending change inside an LF patch stays visible. */
		var sample = Math.min(lines.length, 200);
		var crlf = 0;

		for (var i = 0; i < sample; i++) {
			if (lines[i].charAt(lines[i].length - 1) === '\r') crlf++;
		}

		if (sample > 0 && crlf > sample / 2) {
			for (var j = 0; j < lines.length; j++) {
				if (lines[j].charAt(lines[j].length - 1) === '\r') lines[j] = lines[j].slice(0, -1);
			}
		}

		return lines;
	}

	/* git quotes paths containing control characters, quotes, backslashes or
	   non-ASCII bytes (core.quotePath). Octal escapes are UTF-8 bytes. */
	function unquotePath(quoted) {
		var body = quoted.slice(1, -1);
		var bytes = [];
		var i = 0;

		while (i < body.length) {
			var c = body.charAt(i);

			if (c === '\\') {
				var next = body.charAt(i + 1);

				if (next >= '0' && next <= '7') {
					bytes.push(parseInt(body.substr(i + 1, 3), 8) & 0xff);
					i += 4;
				} else if (Object.prototype.hasOwnProperty.call(ESCAPES, next)) {
					bytes.push(ESCAPES[next]);
					i += 2;
				} else {
					bytes.push(next.charCodeAt(0) & 0xff);
					i += 2;
				}
			} else {
				var code = body.charCodeAt(i);
				if (code < 128) {
					bytes.push(code);
				} else {
					/* Already-decoded text inside quotes: re-encode to bytes. */
					var enc = new TextEncoder().encode(c);
					for (var k = 0; k < enc.length; k++) bytes.push(enc[k]);
				}
				i++;
			}
		}

		return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
	}

	function stripPrefix(path) {
		return /^[ab]\//.test(path) ? path.slice(2) : path;
	}

	/* Value of a `---` / `+++` line, without the marker. */
	function parseSidePath(value) {
		var tab = value.indexOf('\t');
		if (tab !== -1) value = value.slice(0, tab);
		value = value.replace(/\s+$/, '');
		if (value === '/dev/null') return null;
		if (value.charAt(0) === '"') return stripPrefix(unquotePath(value));
		return stripPrefix(value);
	}

	/* `diff --git a/x b/y` is ambiguous when paths contain spaces, so this is a
	   fallback only: --- / +++ and rename headers are preferred everywhere. */
	function parseGitLine(line) {
		var rest = line.replace(/^diff --git /, '');
		var quoted = /^("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/.exec(rest);

		if (quoted) {
			var a = quoted[1].charAt(0) === '"' ? unquotePath(quoted[1]) : quoted[1];
			var b = quoted[2].charAt(0) === '"' ? unquotePath(quoted[2]) : quoted[2];
			return { oldPath: stripPrefix(a), newPath: stripPrefix(b), ambiguous: false };
		}

		/* Unquoted paths with spaces: assume the usual a/ b/ prefixes and split
		   on the last ' b/' that leaves a plausible left half. */
		for (var at = rest.indexOf(' b/'); at !== -1; at = rest.indexOf(' b/', at + 1)) {
			var left = rest.slice(0, at);
			var right = rest.slice(at + 1);
			if (/^a\//.test(left)) {
				return { oldPath: left.slice(2), newPath: right.slice(2), ambiguous: rest.indexOf(' b/', at + 1) !== -1 };
			}
		}

		return { oldPath: null, newPath: null, ambiguous: true };
	}

	function isFileStart(line) {
		return line.indexOf('diff --git ') === 0 || line.indexOf('diff --cc ') === 0 || line.indexOf('diff --combined ') === 0;
	}

	function findBoundaries(lines) {
		var bounds = [];
		var i;

		for (i = 0; i < lines.length; i++) {
			if (isFileStart(lines[i])) bounds.push(i);
		}

		if (bounds.length) return bounds;

		/* Plain unified diff with no git headers. Require the full ---/+++/@@
		   sequence so that a removed line beginning with `-- ` is not mistaken
		   for a file header. */
		for (i = 0; i < lines.length - 2; i++) {
			if (lines[i].indexOf('--- ') === 0 && lines[i + 1].indexOf('+++ ') === 0 && lines[i + 2].indexOf('@@') === 0) {
				bounds.push(i);
			}
		}

		return bounds;
	}

	function parseBinaryBlocks(lines, start, end) {
		var blocks = [];
		var i = start;

		while (i < end) {
			var match = BINARY_BLOCK_RE.exec(lines[i]);
			if (!match) break;

			var data = [];
			i++;

			while (i < end && lines[i].length > 0 && PV.base85.lineByteLength(lines[i].charAt(0)) > 0) {
				data.push(lines[i]);
				i++;
			}

			if (i < end && lines[i] === '') i++;
			blocks.push({ kind: match[1], size: parseInt(match[2], 10), data: data });
		}

		return { blocks: blocks, next: i };
	}

	function parseHunk(file, lines, start, end) {
		var match = HUNK_RE.exec(lines[start]);

		if (!match) {
			file.warnings.push('unrecognised hunk header: ' + lines[start].slice(0, 80));
			return start + 1;
		}

		var hunk = {
			oldStart: parseInt(match[1], 10),
			oldLines: match[2] === undefined ? 1 : parseInt(match[2], 10),
			newStart: parseInt(match[3], 10),
			newLines: match[4] === undefined ? 1 : parseInt(match[4], 10),
			section: match[5].replace(/^ /, ''),
			lines: []
		};

		var oldLeft = hunk.oldLines;
		var newLeft = hunk.newLines;
		var i = start + 1;

		while (i < end && (oldLeft > 0 || newLeft > 0)) {
			var line = lines[i];
			var kind = line.charAt(0);

			if (line === '') {
				/* Some tools strip the trailing space of an empty context line. */
				hunk.lines.push({ kind: ' ', text: '' });
				oldLeft--;
				newLeft--;
			} else if (kind === ' ') {
				hunk.lines.push({ kind: ' ', text: line.slice(1) });
				oldLeft--;
				newLeft--;
			} else if (kind === '+') {
				hunk.lines.push({ kind: '+', text: line.slice(1) });
				newLeft--;
				file.additions++;
			} else if (kind === '-') {
				hunk.lines.push({ kind: '-', text: line.slice(1) });
				oldLeft--;
				file.deletions++;
			} else if (kind === '\\') {
				if (hunk.lines.length) hunk.lines[hunk.lines.length - 1].noNewline = true;
			} else {
				break;
			}

			i++;
		}

		/* A `\ No newline` marker can trail the final counted line. */
		while (i < end && lines[i].charAt(0) === '\\') {
			if (hunk.lines.length) hunk.lines[hunk.lines.length - 1].noNewline = true;
			i++;
		}

		if (oldLeft > 0 || newLeft > 0) {
			file.warnings.push('truncated hunk at @@ -' + hunk.oldStart + ' +' + hunk.newStart + ' @@');
		}

		file.hunks.push(hunk);
		return i;
	}

	function parseSection(lines, start, end) {
		var file = {
			oldPath: null,
			newPath: null,
			displayPath: '',
			status: 'modified',
			oldMode: null,
			newMode: null,
			oldSha: null,
			newSha: null,
			similarity: null,
			isBinary: false,
			binary: null,
			combined: false,
			modeChanged: false,
			hunks: [],
			additions: 0,
			deletions: 0,
			warnings: [],
			raw: ''
		};

		var i = start;
		var gitPaths = null;
		var explicitStatus = null;

		if (lines[i].indexOf('diff --cc ') === 0 || lines[i].indexOf('diff --combined ') === 0) {
			file.combined = true;
			file.newPath = file.oldPath = lines[i].replace(/^diff --(cc|combined) /, '');
			i++;
		} else if (lines[i].indexOf('diff --git ') === 0) {
			gitPaths = parseGitLine(lines[i]);
			i++;
		}

		for (; i < end; i++) {
			var line = lines[i];

			if (line.indexOf('@@') === 0) break;
			if (line === 'GIT binary patch') {
				file.isBinary = true;
				var parsed = parseBinaryBlocks(lines, i + 1, end);
				file.binary = { blocks: parsed.blocks, differOnly: false };
				i = parsed.next;
				break;
			}
			if (line.indexOf('Binary files ') === 0 || line.indexOf('Files ') === 0) {
				file.isBinary = true;
				file.binary = { blocks: [], differOnly: true };
				continue;
			}
			if (line.indexOf('old mode ') === 0) { file.oldMode = line.slice(9).trim(); file.modeChanged = true; continue; }
			if (line.indexOf('new mode ') === 0) { file.newMode = line.slice(9).trim(); file.modeChanged = true; continue; }
			if (line.indexOf('new file mode ') === 0) { file.newMode = line.slice(14).trim(); explicitStatus = 'added'; continue; }
			if (line.indexOf('deleted file mode ') === 0) { file.oldMode = line.slice(18).trim(); explicitStatus = 'deleted'; continue; }
			if (line.indexOf('similarity index ') === 0) { file.similarity = parseInt(line.slice(17), 10); continue; }
			if (line.indexOf('dissimilarity index ') === 0) { continue; }
			if (line.indexOf('rename from ') === 0) { file.oldPath = stripQuoted(line.slice(12)); explicitStatus = 'renamed'; continue; }
			if (line.indexOf('rename to ') === 0) { file.newPath = stripQuoted(line.slice(10)); explicitStatus = 'renamed'; continue; }
			if (line.indexOf('copy from ') === 0) { file.oldPath = stripQuoted(line.slice(10)); explicitStatus = 'copied'; continue; }
			if (line.indexOf('copy to ') === 0) { file.newPath = stripQuoted(line.slice(8)); explicitStatus = 'copied'; continue; }
			if (line.indexOf('index ') === 0) {
				var idx = /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: (\d+))?/.exec(line);
				if (idx) {
					file.oldSha = idx[1];
					file.newSha = idx[2];
					if (idx[3]) { file.oldMode = file.oldMode || idx[3]; file.newMode = file.newMode || idx[3]; }
				}
				continue;
			}
			if (line.indexOf('--- ') === 0) { file.oldPath = parseSidePath(line.slice(4)); continue; }
			if (line.indexOf('+++ ') === 0) { file.newPath = parseSidePath(line.slice(4)); continue; }
		}

		while (i < end) {
			if (lines[i].indexOf('@@') === 0) {
				if (COMBINED_HUNK_RE.test(lines[i])) {
					file.combined = true;
					i++;
				} else {
					i = parseHunk(file, lines, i, end);
				}
			} else {
				i++;
			}
		}

		if (gitPaths) {
			if (file.oldPath === null && explicitStatus !== 'added') file.oldPath = gitPaths.oldPath;
			if (file.newPath === null && explicitStatus !== 'deleted') file.newPath = gitPaths.newPath;
			if (gitPaths.ambiguous) file.warnings.push('path in `diff --git` line is ambiguous');
		}

		if (explicitStatus) {
			file.status = explicitStatus;
		} else if (file.oldPath === null && file.newPath !== null) {
			file.status = 'added';
		} else if (file.newPath === null && file.oldPath !== null) {
			file.status = 'deleted';
		} else {
			file.status = 'modified';
		}

		if (file.oldMode && file.newMode && file.oldMode !== file.newMode) file.modeChanged = true;
		else if (file.status !== 'added' && file.status !== 'deleted') file.modeChanged = file.modeChanged && file.oldMode !== file.newMode;

		file.displayPath = file.newPath || file.oldPath || '(unknown)';
		file.raw = lines.slice(start, end).join('\n');

		return file;
	}

	function stripQuoted(value) {
		value = value.replace(/\s+$/, '');
		return value.charAt(0) === '"' ? unquotePath(value) : value;
	}

	function parsePatch(text) {
		var lines = splitLines(text);
		var bounds = findBoundaries(lines);
		var result = { preamble: [], files: [], warnings: [], text: text };

		if (!bounds.length) {
			result.warnings.push('no `diff --git` sections found');
			result.preamble = lines;
			return result;
		}

		result.preamble = lines.slice(0, bounds[0]).filter(function (l) { return l.trim() !== ''; });

		for (var b = 0; b < bounds.length; b++) {
			var end = b + 1 < bounds.length ? bounds[b + 1] : lines.length;
			var file = parseSection(lines, bounds[b], end);
			file.index = result.files.length;
			result.files.push(file);
			for (var w = 0; w < file.warnings.length; w++) {
				result.warnings.push(file.displayPath + ': ' + file.warnings[w]);
			}
		}

		return result;
	}

	function summarize(files) {
		var s = { files: files.length, text: 0, binary: 0, additions: 0, deletions: 0, added: 0, deleted: 0, renamed: 0, modified: 0, copied: 0 };

		for (var i = 0; i < files.length; i++) {
			var f = files[i];
			if (f.isBinary) s.binary++; else s.text++;
			s.additions += f.additions;
			s.deletions += f.deletions;
			if (s[f.status] !== undefined) s[f.status]++;
		}

		return s;
	}

	PV.patch = { parse: parsePatch, summarize: summarize, unquotePath: unquotePath };
}(typeof window !== 'undefined' ? window : globalThis));
