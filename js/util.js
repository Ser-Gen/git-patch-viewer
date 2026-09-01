/* Small helpers shared by the parse layer and the UI. DOM-free. */
(function (root) {
	'use strict';

	var PV = root.PV = root.PV || {};

	function fnv1a(text) {
		var h = 0x811c9dc5;
		for (var i = 0; i < text.length; i++) {
			h ^= text.charCodeAt(i) & 0xff;
			h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
		}
		return h.toString(16);
	}

	function formatBytes(n) {
		if (n == null) return '?';
		if (n < 1024) return n + ' B';
		if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
		return (n / 1048576).toFixed(1) + ' MB';
	}

	function extensionOf(path) {
		var base = path.slice(path.lastIndexOf('/') + 1);
		var dot = base.lastIndexOf('.');
		return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
	}

	function escapeHtml(s) {
		return String(s).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}

	PV.util = {
		fnv1a: fnv1a,
		formatBytes: formatBytes,
		extensionOf: extensionOf,
		escapeHtml: escapeHtml
	};
}(typeof window !== 'undefined' ? window : globalThis));
