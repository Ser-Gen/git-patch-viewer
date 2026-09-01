/*
 * GIT binary patch blocks -> before/after bytes.
 *
 * git writes two blocks per binary file: the forward patch (a -> b) then the
 * reverse patch (b -> a). Whenever one of the two is a `literal` we hold a
 * complete blob, and the other block's delta can be applied to it to recover
 * the counterpart. Only delta/delta pairs are unrecoverable: neither blob is
 * present in the patch and no amount of work can conjure it.
 */
(function (root) {
	'use strict';

	var PV = root.PV = root.PV || {};

	function inflate(bytes) {
		if (typeof DecompressionStream === 'undefined') {
			return Promise.reject(new Error('DecompressionStream is not available in this browser'));
		}

		/* Binary patch payloads are zlib-wrapped deflate, not raw deflate. */
		var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));

		return new Response(stream).arrayBuffer().then(function (buffer) {
			return new Uint8Array(buffer);
		});
	}

	function decodeBlock(block) {
		if (!block) return Promise.resolve(null);
		if (!block.data.length) return Promise.resolve(new Uint8Array(0));

		return Promise.resolve()
			.then(function () { return PV.base85.decodeLines(block.data); })
			.then(inflate);
	}

	/* Sizes are readable from a delta even with no base blob in hand. */
	function deltaSizes(raw) {
		try {
			var header = PV.delta.readHeader(raw);
			return { sourceSize: header.sourceSize, targetSize: header.targetSize };
		} catch (err) {
			return null;
		}
	}

	function resolve(file) {
		var result = {
			before: null,
			after: null,
			forwardKind: null,
			reverseKind: null,
			beforeSize: null,
			afterSize: null,
			deltaSize: null,
			reason: null,
			error: null
		};

		if (!file.binary) return Promise.resolve(result);

		if (file.binary.differOnly) {
			result.reason = 'differOnly';
			return Promise.resolve(result);
		}

		var forward = file.binary.blocks[0] || null;
		var reverse = file.binary.blocks[1] || null;

		result.forwardKind = forward && forward.kind;
		result.reverseKind = reverse && reverse.kind;

		return Promise.all([decodeBlock(forward), decodeBlock(reverse)]).then(function (raw) {
			var forwardRaw = raw[0];
			var reverseRaw = raw[1];

			if (forward && forward.kind === 'delta' && forwardRaw) {
				var fSizes = deltaSizes(forwardRaw);
				result.deltaSize = forwardRaw.length;
				if (fSizes) {
					result.beforeSize = fSizes.sourceSize;
					result.afterSize = fSizes.targetSize;
				}
			}

			if (forward && forward.kind === 'literal') {
				result.after = forwardRaw;
				result.afterSize = forwardRaw.length;
			}

			if (reverse && reverse.kind === 'literal') {
				result.before = reverseRaw;
				result.beforeSize = reverseRaw.length;
			} else if (reverse && reverse.kind === 'delta' && reverseRaw) {
				var rSizes = deltaSizes(reverseRaw);
				if (rSizes && result.beforeSize == null) result.beforeSize = rSizes.targetSize;
			}

			/* forward delta + reverse literal: the reverse literal IS the
			   pre-image, so the forward delta reconstructs the post-image. */
			if (!result.after && result.before && forward && forward.kind === 'delta') {
				result.after = PV.delta.apply(result.before, forwardRaw);
				result.afterSize = result.after.length;
			}

			/* forward literal + reverse delta: mirror of the above. */
			if (!result.before && result.after && reverse && reverse.kind === 'delta') {
				result.before = PV.delta.apply(result.after, reverseRaw);
				result.beforeSize = result.before.length;
			}

			if (result.before && result.before.length === 0) result.before = null;
			if (result.after && result.after.length === 0) result.after = null;

			if (!result.before && !result.after) result.reason = 'deltaOnly';

			return result;
		}).catch(function (err) {
			result.error = err.message;
			result.reason = 'error';
			return result;
		});
	}

	var IMAGE_TYPES = {
		png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
		webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
		svg: 'image/svg+xml', apng: 'image/apng'
	};

	function mimeFor(path) {
		return IMAGE_TYPES[PV.util.extensionOf(path)] || null;
	}

	/* PNG dimensions live in the IHDR chunk, so they are readable without
	   waiting for the browser to decode the image. */
	function pngSize(bytes) {
		if (!bytes || bytes.length < 24) return null;
		var signature = [137, 80, 78, 71, 13, 10, 26, 10];
		for (var i = 0; i < 8; i++) {
			if (bytes[i] !== signature[i]) return null;
		}
		var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		return { width: view.getUint32(16), height: view.getUint32(20) };
	}

	PV.binary = {
		resolve: resolve,
		inflate: inflate,
		mimeFor: mimeFor,
		pngSize: pngSize,
		isImage: function (path) { return mimeFor(path) !== null; }
	};
}(typeof window !== 'undefined' ? window : globalThis));
