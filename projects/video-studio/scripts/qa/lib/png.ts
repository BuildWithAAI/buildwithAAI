/**
 * Minimal PNG codec for the QA checker (node:zlib only). Decodes 8-bit, non-interlaced PNGs of colour types
 * 0 (grey), 2 (RGB), 3 (palette), 4 (grey + alpha) and 6 (RGBA), which covers Chrome screenshots; everything
 * becomes RGBA8. Encodes RGBA8 (colour type 6) for issue thumbnails.
 */
import {deflateSync, inflateSync} from 'node:zlib';

export type Image = {width: number; height: number; data: Uint8Array}; // RGBA8, row-major

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const paeth = (a: number, b: number, c: number): number => {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export const decodePng = (input: Uint8Array): Image => {
	const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	if (b.length < 8 || !b.subarray(0, 8).equals(SIG)) throw new Error('not a PNG file');
	let pos = 8;
	let width = 0;
	let height = 0;
	let depth = 0;
	let ctype = -1;
	let interlace = 0;
	let palette: Buffer | null = null;
	let trns: Buffer | null = null;
	const idat: Buffer[] = [];
	while (pos + 8 <= b.length) {
		const len = b.readUInt32BE(pos);
		const type = b.toString('latin1', pos + 4, pos + 8);
		const body = b.subarray(pos + 8, pos + 8 + len);
		if (type === 'IHDR') {
			width = body.readUInt32BE(0);
			height = body.readUInt32BE(4);
			depth = body[8];
			ctype = body[9];
			interlace = body[12];
		} else if (type === 'PLTE') palette = Buffer.from(body);
		else if (type === 'tRNS') trns = Buffer.from(body);
		else if (type === 'IDAT') idat.push(body);
		else if (type === 'IEND') break;
		pos += 12 + len;
	}
	if (!width || !height) throw new Error('PNG has no IHDR');
	if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth} (8 only)`);
	if (interlace !== 0) throw new Error('interlaced PNGs are not supported');
	const channels = ({0: 1, 2: 3, 3: 1, 4: 2, 6: 4} as Record<number, number>)[ctype];
	if (!channels) throw new Error(`unsupported PNG colour type ${ctype}`);
	if (ctype === 3 && !palette) throw new Error('palette PNG without PLTE');
	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * channels;
	if (raw.length < height * (stride + 1)) throw new Error('PNG data is truncated');
	const px = new Uint8Array(height * stride);
	for (let y = 0; y < height; y++) {
		const f = raw[y * (stride + 1)];
		const src = y * (stride + 1) + 1;
		const out = y * stride;
		const prev = out - stride;
		switch (f) {
			case 0:
				px.set(raw.subarray(src, src + stride), out);
				break;
			case 1:
				for (let x = 0; x < stride; x++) px[out + x] = (raw[src + x] + (x >= channels ? px[out + x - channels] : 0)) & 255;
				break;
			case 2:
				for (let x = 0; x < stride; x++) px[out + x] = (raw[src + x] + (y > 0 ? px[prev + x] : 0)) & 255;
				break;
			case 3:
				for (let x = 0; x < stride; x++) {
					const a = x >= channels ? px[out + x - channels] : 0;
					const up = y > 0 ? px[prev + x] : 0;
					px[out + x] = (raw[src + x] + ((a + up) >> 1)) & 255;
				}
				break;
			case 4:
				for (let x = 0; x < stride; x++) {
					const a = x >= channels ? px[out + x - channels] : 0;
					const up = y > 0 ? px[prev + x] : 0;
					const ul = y > 0 && x >= channels ? px[prev + x - channels] : 0;
					px[out + x] = (raw[src + x] + paeth(a, up, ul)) & 255;
				}
				break;
			default:
				throw new Error(`bad PNG filter type ${f} on row ${y}`);
		}
	}
	const data = new Uint8Array(width * height * 4);
	const n = width * height;
	if (ctype === 6) data.set(px);
	else if (ctype === 2) {
		for (let i = 0; i < n; i++) {
			data[i * 4] = px[i * 3];
			data[i * 4 + 1] = px[i * 3 + 1];
			data[i * 4 + 2] = px[i * 3 + 2];
			data[i * 4 + 3] = 255;
		}
	} else if (ctype === 0) {
		for (let i = 0; i < n; i++) {
			data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = px[i];
			data[i * 4 + 3] = 255;
		}
	} else if (ctype === 4) {
		for (let i = 0; i < n; i++) {
			data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = px[i * 2];
			data[i * 4 + 3] = px[i * 2 + 1];
		}
	} else {
		const pal = palette as Buffer;
		for (let i = 0; i < n; i++) {
			const k = px[i];
			data[i * 4] = pal[k * 3];
			data[i * 4 + 1] = pal[k * 3 + 1];
			data[i * 4 + 2] = pal[k * 3 + 2];
			data[i * 4 + 3] = trns && k < trns.length ? trns[k] : 255;
		}
	}
	return {width, height, data};
};

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();
const crc32 = (buf: Uint8Array): number => {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, body: Uint8Array): Buffer => {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(body.length);
	const tb = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(body)]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(tb));
	return Buffer.concat([len, tb, crc]);
};

/** RGBA8 → PNG (colour type 6, filter 0 per row; small images, so no filter search). */
export const encodePng = (img: Image): Buffer => {
	const {width, height, data} = img;
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	const stride = width * 4;
	const raw = Buffer.alloc(height * (stride + 1));
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0;
		raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
	}
	return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, {level: 6})), chunk('IEND', new Uint8Array(0))]);
};
