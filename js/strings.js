/* Every user-visible string. Swap this file to localise the UI. */
(function (root) {
	'use strict';

	var PV = root.PV = root.PV || {};

	PV.strings = {
		appName: 'Patch Viewer',

		dropHint: 'Drop a .patch file here',
		dropSub: 'or click to choose one, or paste patch text into the window',
		dropOverlay: 'Release to open the patch',
		openFile: 'Open patch…',
		loading: 'Reading patch…',

		flat: 'Flat',
		tree: 'Tree',
		filterPlaceholder: 'Filter paths…  (/)',
		noMatches: 'No paths match the filter.',
		viewedProgress: function (done, total) { return done + ' / ' + total + ' viewed'; },
		markAllViewed: 'Mark all viewed',
		clearViewed: 'Clear viewed',

		summary: function (s) {
			return s.files + ' files · ' + s.text + ' text · ' + s.binary + ' binary · +' + s.additions + ' −' + s.deletions;
		},

		statusLabel: {
			added: 'Added',
			deleted: 'Deleted',
			modified: 'Modified',
			renamed: 'Renamed',
			copied: 'Copied'
		},
		statusBadge: { added: 'A', deleted: 'D', modified: 'M', renamed: 'R', copied: 'C' },

		binaryTag: 'bin',
		combinedTag: 'merge',
		unviewableTag: 'no data',
		modeChange: function (from, to) { return 'Mode ' + (from || '?') + ' → ' + (to || '?'); },
		renamedFrom: function (from) { return 'Renamed from ' + from; },
		copiedFrom: function (from) { return 'Copied from ' + from; },
		similarity: function (n) { return n + '% similar'; },

		gapLabel: function (oldCount, newCount, atEnd) {
			if (atEnd) return '⋯  the rest of the file is not contained in the patch';
			var count = Math.max(oldCount, newCount);
			if (count <= 0) return '⋯  unchanged lines not contained in the patch';
			return '⋯  ' + count + (count === 1 ? ' unchanged line' : ' unchanged lines') + ' not contained in the patch';
		},
		gapTooltip: 'A patch carries only its hunks, so these lines are not available to expand.',

		sideBySide: 'Side by side',
		inline: 'Inline',
		wrap: 'Wrap',
		copyPath: 'Copy path',
		copyDiff: 'Copy raw diff',
		copied: 'Copied',
		viewed: 'Viewed',

		noHunks: 'This entry changes no content.',
		noHunksHint: 'Only file metadata changed, so the patch contains no hunks.',

		combinedTitle: 'Combined merge diff',
		combinedBody: 'This entry came from a merge commit (`diff --cc`), which records each parent in its own column. That format is not rendered here — the raw diff is shown below.',

		monacoLoading: 'Loading the editor…',
		monacoFailed: 'The Monaco editor could not be loaded.',
		monacoFailedHint: 'Showing the raw diff instead. Check that vendor/monaco is present and that the page is served over http://, then reload.',

		bigFileWarning: function (lines) { return 'This diff is ' + lines + ' lines long and may take a moment to render.'; },
		renderAnyway: 'Render anyway',

		before: 'Before',
		after: 'After',
		compareSide: 'Side by side',
		compareSwipe: 'Swipe',
		compareOnion: 'Onion skin',
		imageAdded: 'This file is new, so the patch has no "before" image.',
		imageDeleted: 'This file was deleted, so the patch has no "after" image.',
		decoding: 'Decoding binary data…',

		binaryUnviewableTitle: 'This image cannot be reconstructed from the patch',
		binaryUnviewableBody: 'Both the forward and the reverse block are deltas, so neither the original nor the new blob is contained in the patch. Reconstructing the image would need the original file from the repository.',
		binaryDifferOnlyTitle: 'The patch records only that the file changed',
		binaryDifferOnlyBody: 'This patch was produced without --binary, so it carries no file data — only the note that the two versions differ.',
		binaryErrorTitle: 'The binary data could not be decoded',
		notAnImageTitle: 'Not a previewable image',
		notAnImageBody: 'The bytes are available but the browser cannot display this file type. The first 256 bytes are shown below.',
		download: function (which) { return 'Download ' + which; },
		dimensions: function (w, h) { return w + ' × ' + h + ' px'; },
		sizeChange: function (from, to) { return from + ' → ' + to; },
		blobs: function (a, b) { return 'index ' + (a || '?') + '..' + (b || '?'); },

		errorNotAPatch: 'That file does not look like a git patch: no `diff --git` sections were found.',
		errorFetch: function (url) { return 'Could not fetch ' + url + '. A ?url= parameter needs the page to be served over http:// (for example `npx serve`).'; },
		errorRead: 'The file could not be read.',
		warnings: function (n) { return n + (n === 1 ? ' parser warning' : ' parser warnings'); },

		shortcutsTitle: 'Keyboard',
		shortcuts: [
			['j / ↓', 'next file'],
			['k / ↑', 'previous file'],
			['Enter', 'open file'],
			['n / p', 'next / previous hunk'],
			['Space', 'toggle viewed'],
			['t', 'flat / tree'],
			['/', 'filter'],
			['Esc', 'clear filter']
		]
	};
}(typeof window !== 'undefined' ? window : globalThis));
