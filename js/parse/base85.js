/*
 * git's base85 (see base85.c in git). Each data line of a binary patch starts
 * with a length character: 'A'-'Z' encodes 1-26 bytes, 'a'-'z' encodes 27-52.
 * The rest of the line is base85 in groups of 5 characters -> 4 bytes.
 */
(function (root) {
	'use strict';

	var PV = root.PV = root.PV || {};
	var ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~';
	var DECODE = new Int16Array(256);

	DECODE.fill(-1);
	for (var i = 0; i < ALPHABET.length; i++) {
		DECODE[ALPHABET.charCodeAt(i)] = i;
	}

	function lineByteLength(ch) {
		if (!ch) return -1;
		var c = ch.charCodeAt(0);
		if (c >= 65 && c <= 90) return c - 64;
		if (c >= 97 && c <= 122) return c - 70;
		return -1;
	}

	function decodeLines(lines) {
		var total = 0;
		var i;

		for (i = 0; i < lines.length; i++) {
			var n = lineByteLength(lines[i].charAt(0));
			if (n < 0) throw new Error('base85: bad length prefix ' + JSON.stringify(lines[i].charAt(0)));
			total += n;
		}

		var out = new Uint8Array(total);
		var o = 0;

		for (i = 0; i < lines.length; i++) {
			var line = lines[i];
			var want = lineByteLength(line.charAt(0));
			var body = line.slice(1);
			var end = o + want;

			for (var p = 0; p < body.length && o < end; p += 5) {
				var acc = 0;

				for (var j = 0; j < 5; j++) {
					var d = DECODE[body.charCodeAt(p + j)];
					if (d === undefined || d < 0) {
						throw new Error('base85: invalid character ' + JSON.stringify(body.charAt(p + j)));
					}
					acc = acc * 85 + d;
				}

				if (acc > 0xffffffff) throw new Error('base85: group overflow');

				out[o++] = Math.floor(acc / 16777216);
				if (o < end) out[o++] = Math.floor(acc / 65536) % 256;
				if (o < end) out[o++] = Math.floor(acc / 256) % 256;
				if (o < end) out[o++] = acc % 256;
			}

			if (o !== end) throw new Error('base85: line produced ' + (o - (end - want)) + ' of ' + want + ' bytes');
		}

		return out;
	}

	PV.base85 = { lineByteLength: lineByteLength, decodeLines: decodeLines };
}(typeof window !== 'undefined' ? window : globalThis));
