/*
 * Binary files: decoded images with a before/after comparison where the patch
 * carries enough data, and an honest metadata card where it does not.
 */
(function (root) {
	'use strict';

	var PV = root.PV = root.PV || {};
	var S = null;

	var host = null;
	var urls = [];
	var token = 0;

	function init(container) {
		S = PV.strings;
		host = container;
	}

	function clear() {
		token++;
		urls.forEach(function (url) { URL.revokeObjectURL(url); });
		urls = [];
		if (host) host.innerHTML = '';
	}

	function objectUrl(bytes, mime) {
		var url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
		urls.push(url);
		return url;
	}

	function metaList(file, result) {
		var rows = [];

		rows.push(['blobs', S.blobs(file.oldSha, file.newSha)]);

		if (result.beforeSize != null || result.afterSize != null) {
			rows.push(['size', S.sizeChange(PV.util.formatBytes(result.beforeSize), PV.util.formatBytes(result.afterSize))]);
		}
		if (result.deltaSize != null) rows.push(['delta', PV.util.formatBytes(result.deltaSize)]);
		if (result.forwardKind) rows.push(['blocks', result.forwardKind + ' / ' + (result.reverseKind || '—')]);

		return '<dl>' + rows.map(function (row) {
			return '<dt>' + row[0] + '</dt><dd>' + PV.util.escapeHtml(row[1]) + '</dd>';
		}).join('') + '</dl>';
	}

	function card(title, body, extra) {
		return '<div class="card"><h3>' + PV.util.escapeHtml(title) + '</h3>' +
			(body ? '<p>' + PV.util.escapeHtml(body) + '</p>' : '') + (extra || '') + '</div>';
	}

	function hexdump(bytes, limit) {
		var out = [];
		var max = Math.min(bytes.length, limit);

		for (var i = 0; i < max; i += 16) {
			var hex = [];
			var ascii = '';

			for (var j = 0; j < 16; j++) {
				if (i + j < max) {
					var b = bytes[i + j];
					hex.push((b < 16 ? '0' : '') + b.toString(16));
					ascii += b >= 32 && b < 127 ? String.fromCharCode(b) : '.';
				} else {
					hex.push('  ');
				}
			}

			out.push(('0000000' + i.toString(16)).slice(-7) + '  ' + hex.join(' ') + '  |' + ascii + '|');
		}

		return '<div class="hexdump">' + PV.util.escapeHtml(out.join('\n')) + '</div>';
	}

	function describe(bytes, path) {
		var size = PV.binary.pngSize(bytes);
		var parts = [PV.util.formatBytes(bytes.length)];
		if (size) parts.push(S.dimensions(size.width, size.height));
		return parts.join(' · ');
	}

	function figure(label, bytes, mime, path) {
		var url = objectUrl(bytes, mime);
		return '<figure class="shot"><div class="frame checker"><img src="' + url + '" alt="' +
			PV.util.escapeHtml(label) + '" data-measure="1"></div>' +
			'<figcaption>' + label + ' · <span class="desc">' + describe(bytes, path) + '</span> · ' +
			'<a href="' + url + '" download="' + PV.util.escapeHtml(path.slice(path.lastIndexOf('/') + 1)) + '">' +
			PV.util.escapeHtml(S.download(label.toLowerCase())) + '</a></figcaption></figure>';
	}

	/* Fill in dimensions for formats whose header we do not parse ourselves. */
	function measure(container) {
		Array.prototype.forEach.call(container.querySelectorAll('img[data-measure]'), function (img) {
			img.addEventListener('load', function () {
				var caption = img.closest('figure, .overlay-wrap');
				var desc = caption && caption.querySelector('.desc');
				if (desc && desc.textContent.indexOf('×') === -1) {
					desc.textContent += ' · ' + S.dimensions(img.naturalWidth, img.naturalHeight);
				}
			});
		});
	}

	function comparison(file, result, mime) {
		var beforeUrl = objectUrl(result.before, mime);
		var afterUrl = objectUrl(result.after, mime);

		return '<div class="tools">' +
			'<button data-mode="side" class="on">' + S.compareSide + '</button>' +
			'<button data-mode="swipe">' + S.compareSwipe + '</button>' +
			'<button data-mode="onion">' + S.compareOnion + '</button>' +
			'</div>' +
			'<div class="compare" data-before="' + beforeUrl + '" data-after="' + afterUrl + '">' +
			'<div class="pair">' +
			figure(S.before, result.before, mime, file.oldPath || file.displayPath) +
			figure(S.after, result.after, mime, file.displayPath) +
			'</div></div>';
	}

	function overlayHtml(mode, beforeUrl, afterUrl) {
		var label = mode === 'swipe' ? S.compareSwipe : S.compareOnion;

		/* The two versions can differ in size, so both images are anchored to
		   the top left of a stage big enough for either one, and the swipe is
		   clipped by a veil sized to the stage rather than by the image itself
		   — clipping the image would make the boundary depend on its width. */
		return '<div class="overlay-wrap">' +
			'<div class="overlay ' + mode + '" style="--pos:50%;--opacity:.5">' +
			'<div class="stage checker">' +
			'<img class="base" src="' + afterUrl + '" alt="' + S.after + '">' +
			'<div class="veil"><img class="top" src="' + beforeUrl + '" alt="' + S.before + '"></div>' +
			'</div></div>' +
			'<div class="slider"><span>' + S.after + '</span>' +
			'<input type="range" min="0" max="100" value="50" aria-label="' + label + '">' +
			'<span>' + S.before + '</span></div></div>';
	}

	/* Size the stage to whichever image is larger and scale both by the same
	   factor, so a size change reads as one image not filling the stage. */
	function layoutOverlay(overlay) {
		var base = overlay.querySelector('.base');
		var top = overlay.querySelector('.top');
		var stage = overlay.querySelector('.stage');

		if (!base.naturalWidth || !top.naturalWidth) return;

		var width = Math.max(base.naturalWidth, top.naturalWidth);
		var height = Math.max(base.naturalHeight, top.naturalHeight);
		var scale = Math.min(1,
			Math.min(window.innerWidth * 0.8, 900) / width,
			(window.innerHeight * 0.6) / height);

		stage.style.width = Math.round(width * scale) + 'px';
		stage.style.height = Math.round(height * scale) + 'px';

		[base, top].forEach(function (img) {
			img.style.width = Math.round(img.naturalWidth * scale) + 'px';
			img.style.height = Math.round(img.naturalHeight * scale) + 'px';
		});
	}

	function whenLoaded(overlay) {
		var images = overlay.querySelectorAll('img');
		var pending = images.length;

		function done() {
			if (--pending === 0) layoutOverlay(overlay);
		}

		Array.prototype.forEach.call(images, function (img) {
			/* A cached image may already be complete, so its load never fires. */
			if (img.complete && img.naturalWidth) done();
			else img.addEventListener('load', done, { once: true });
		});
	}

	function wireComparison(container) {
		var compare = container.querySelector('.compare');
		if (!compare) return;

		var beforeUrl = compare.dataset.before;
		var afterUrl = compare.dataset.after;

		container.querySelector('.tools').addEventListener('click', function (event) {
			var button = event.target.closest('button[data-mode]');
			if (!button) return;

			Array.prototype.forEach.call(container.querySelectorAll('.tools button'), function (b) {
				b.classList.toggle('on', b === button);
			});

			var mode = button.dataset.mode;

			if (mode === 'side') {
				compare.innerHTML = '<div class="pair">' + compare.dataset.pair + '</div>';
				return;
			}

			compare.innerHTML = overlayHtml(mode, beforeUrl, afterUrl);

			var overlay = compare.querySelector('.overlay');
			whenLoaded(overlay);
			compare.querySelector('input[type=range]').addEventListener('input', function () {
				if (mode === 'swipe') overlay.style.setProperty('--pos', this.value + '%');
				else overlay.style.setProperty('--opacity', this.value / 100);
			});
		});
	}

	function render(file, result) {
		var mime = PV.binary.mimeFor(file.displayPath);
		var html = ['<div class="binary">'];

		if (result.reason === 'error') {
			html.push(card(S.binaryErrorTitle, result.error, metaList(file, result)));
		} else if (result.reason === 'differOnly') {
			html.push(card(S.binaryDifferOnlyTitle, S.binaryDifferOnlyBody, metaList(file, result)));
		} else if (result.reason === 'deltaOnly') {
			html.push(card(S.binaryUnviewableTitle, S.binaryUnviewableBody, metaList(file, result)));
		} else if (!mime) {
			var bytes = result.after || result.before;
			html.push(card(S.notAnImageTitle, S.notAnImageBody, metaList(file, result) + hexdump(bytes, 256) +
				'<p style="margin-top:8px"><a href="' + objectUrl(bytes, null) + '" download="' +
				PV.util.escapeHtml(file.displayPath.slice(file.displayPath.lastIndexOf('/') + 1)) + '">' +
				S.download(S.after.toLowerCase()) + '</a></p>'));
		} else if (result.before && result.after) {
			html.push(comparison(file, result, mime));
		} else if (result.after) {
			html.push('<div class="pair">' + figure(S.after, result.after, mime, file.displayPath) + '</div>');
			if (file.status === 'added') html.push(card(S.imageAdded, '', metaList(file, result)));
		} else if (result.before) {
			html.push('<div class="pair">' + figure(S.before, result.before, mime, file.oldPath || file.displayPath) + '</div>');
			if (file.status === 'deleted') html.push(card(S.imageDeleted, '', metaList(file, result)));
		}

		html.push('</div>');
		host.innerHTML = html.join('');

		var compare = host.querySelector('.compare');
		if (compare) compare.dataset.pair = compare.querySelector('.pair').innerHTML;

		wireComparison(host);
		measure(host);
	}

	function show(file) {
		clear();

		var mine = token;
		host.innerHTML = '<div class="placeholder">' + S.decoding + '</div>';

		PV.binary.resolve(file).then(function (result) {
			if (mine !== token) return;
			render(file, result);
		});
	}

	PV.binaryview = { init: init, show: show, clear: clear };
}(typeof window !== 'undefined' ? window : globalThis));
