/*
 * git's delta format: a source-size varint, a target-size varint, then a
 * stream of opcodes. High bit set means "copy a run from the base", otherwise
 * the opcode byte is a count of literal bytes that follow.
 */
(function (root) {
	'use strict';

	var PV = root.PV = root.PV || {};

	function readVarint(bytes, pos) {
		var value = 0;
		var shift = 0;
		var byte;

		do {
			if (pos >= bytes.length) throw new Error('delta: truncated varint');
			byte = bytes[pos++];
			value += (byte & 0x7f) * Math.pow(2, shift);
			shift += 7;
		} while (byte & 0x80);

		return { value: value, pos: pos };
	}

	/* Sizes alone are readable even when the base blob is missing. */
	function readHeader(delta) {
		var src = readVarint(delta, 0);
		var tgt = readVarint(delta, src.pos);
		return { sourceSize: src.value, targetSize: tgt.value, bodyStart: tgt.pos };
	}

	function apply(base, delta) {
		var header = readHeader(delta);

		if (base.length !== header.sourceSize) {
			throw new Error('delta: base is ' + base.length + ' bytes, delta expects ' + header.sourceSize);
		}

		var out = new Uint8Array(header.targetSize);
		var p = header.bodyStart;
		var o = 0;

		while (p < delta.length) {
			var op = delta[p++];

			if (op & 0x80) {
				var offset = 0;
				var length = 0;

				if (op & 0x01) offset |= delta[p++];
				if (op & 0x02) offset |= delta[p++] << 8;
				if (op & 0x04) offset |= delta[p++] << 16;
				if (op & 0x08) offset += delta[p++] * 16777216;
				if (op & 0x10) length |= delta[p++];
				if (op & 0x20) length |= delta[p++] << 8;
				if (op & 0x40) length |= delta[p++] << 16;
				if (length === 0) length = 0x10000;

				if (offset + length > base.length) throw new Error('delta: copy runs past the base');
				if (o + length > out.length) throw new Error('delta: copy runs past the target');

				out.set(base.subarray(offset, offset + length), o);
				o += length;
			} else if (op) {
				if (p + op > delta.length) throw new Error('delta: truncated literal run');
				if (o + op > out.length) throw new Error('delta: literal runs past the target');
				out.set(delta.subarray(p, p + op), o);
				o += op;
				p += op;
			} else {
				throw new Error('delta: reserved opcode 0');
			}
		}

		if (o !== header.targetSize) throw new Error('delta: produced ' + o + ' of ' + header.targetSize + ' bytes');

		return out;
	}

	PV.delta = { readHeader: readHeader, apply: apply };
}(typeof window !== 'undefined' ? window : globalThis));
