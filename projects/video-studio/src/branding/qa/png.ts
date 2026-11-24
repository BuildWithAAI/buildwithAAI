/**
 * Minimal PNG codec and raster helpers for the branding QA (Node only, no dependencies: node:zlib).
 * Decodes 8-bit non-interlaced PNGs of colour types 0 (grey), 2 (RGB), 3 (palette), 4 (grey+alpha) and 6 (RGBA),
 * which covers Chrome/Remotion stills and ffmpeg frame grabs. Everything is converted to RGBA8.
 */
import {crc32, deflateSync, inflateSync} from 'node:zlib';

export type Image = {width: number; height: number; data: Uint8Array}; // RGBA8, row-major

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const decodePng = (buf: Uint8Array): Image => {
	const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
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
		else if (type === 'IDAT') idat.push(Buffer.from(body));
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
		for (let x = 0; x < stride; x++) {
			const r = raw[src + x];
			const a = x >= channels ? px[out + x - channels] : 0;
			const up = y > 0 ? px[out - stride + x] : 0;
			const ul = y > 0 && x >= channels ? px[out - stride + x - channels] : 0;
			let v: number;
			switch (f) {
				case 0:
					v = r;
					break;
				case 1:
					v = r + a;
					break;
				case 2:
					v = r + up;
					break;
				case 3:
					v = r + ((a + up) >> 1);
					break;
				case 4: {
					const p = a + up - ul;
					const pa = Math.abs(p - a);
					const pb = Math.abs(p - up);
					const pc = Math.abs(p - ul);
					v = r + (pa <= pb && pa <= pc ? a : pb <= pc ? up : ul);
					break;
				}
				default:
					throw new Error(`bad PNG filter type ${f} on row ${y}`);
			}
			px[out + x] = v & 255;
		}
	}
	const data = new Uint8Array(width * height * 4);
	for (let i = 0, j = 0; i < width * height; i++, j += channels) {
		const o = i * 4;
		if (ctype === 6) {
			data[o] = px[j];
			data[o + 1] = px[j + 1];
			data[o + 2] = px[j + 2];
			data[o + 3] = px[j + 3];
		} else if (ctype === 2) {
			data[o] = px[j];
			data[o + 1] = px[j + 1];
			data[o + 2] = px[j + 2];
			data[o + 3] = 255;
		} else if (ctype === 0) {
			data[o] = data[o + 1] = data[o + 2] = px[j];
			data[o + 3] = 255;
		} else if (ctype === 4) {
			data[o] = data[o + 1] = data[o + 2] = px[j];
			data[o + 3] = px[j + 1];
		} else {
			const k = px[j];
			data[o] = palette![k * 3];
			data[o + 1] = palette![k * 3 + 1];
			data[o + 2] = palette![k * 3 + 2];
			data[o + 3] = trns && k < trns.length ? trns[k] : 255;
		}
	}
	return {width, height, data};
};

const chunk = (type: string, body: Buffer): Buffer => {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(body.length);
	const tb = Buffer.from(type, 'latin1');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([tb, body])) >>> 0);
	return Buffer.concat([len, tb, body, crc]);
};

/** Encode RGBA8 as PNG (colour type 6; filter 'Sub' per row; zlib level 9). */
export const encodePng = (img: Image): Buffer => {
	const {width, height, data} = img;
	const stride = width * 4;
	const raw = Buffer.alloc(height * (stride + 1));
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 1;
		for (let x = 0; x < stride; x++) {
			const v = data[y * stride + x];
			const left = x >= 4 ? data[y * stride + x - 4] : 0;
			raw[y * (stride + 1) + 1 + x] = (v - left) & 255;
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
};

export const blank = (width: number, height: number, rgba: readonly [number, number, number, number] = [0, 0, 0, 0]): Image => {
	const data = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
	return {width, height, data};
};

export const crop = (img: Image, x: number, y: number, w: number, h: number): Image => {
	const x0 = Math.max(0, Math.round(x));
	const y0 = Math.max(0, Math.round(y));
	const cw = Math.min(img.width - x0, Math.round(w));
	const ch = Math.min(img.height - y0, Math.round(h));
	const out = new Uint8Array(cw * ch * 4);
	for (let r = 0; r < ch; r++) out.set(img.data.subarray(((y0 + r) * img.width + x0) * 4, ((y0 + r) * img.width + x0 + cw) * 4), r * cw * 4);
	return {width: cw, height: ch, data: out};
};

/**
 * Area-average resample (a box filter over the exact source footprint of each output pixel), premultiplied by alpha.
 * This is how a browser or YouTube's server shows a large image small: no ringing, no aliasing of thin lines.
 */
export const resize = (img: Image, width: number, height: number): Image => {
	const out = new Uint8Array(width * height * 4);
	const sx = img.width / width;
	const sy = img.height / height;
	for (let oy = 0; oy < height; oy++) {
		const y0 = oy * sy;
		const y1 = y0 + sy;
		for (let ox = 0; ox < width; ox++) {
			const x0 = ox * sx;
			const x1 = x0 + sx;
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			let wsum = 0;
			for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
				const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
				for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
					const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
					const w = wx * wy;
					const i = (Math.min(img.height - 1, yy) * img.width + Math.min(img.width - 1, xx)) * 4;
					const al = img.data[i + 3] / 255;
					r += img.data[i] * al * w;
					g += img.data[i + 1] * al * w;
					b += img.data[i + 2] * al * w;
					a += al * w;
					wsum += w;
				}
			}
			const o = (oy * width + ox) * 4;
			out[o] = a > 0 ? Math.round(r / a) : 0;
			out[o + 1] = a > 0 ? Math.round(g / a) : 0;
			out[o + 2] = a > 0 ? Math.round(b / a) : 0;
			out[o + 3] = Math.round((a / wsum) * 255);
		}
	}
	return {width, height, data: out};
};

/** Source-over composite of `top` onto `base` at (x, y), with an optional extra mask (0..1 per top pixel). */
export const composite = (base: Image, top: Image, x: number, y: number, mask?: (tx: number, ty: number) => number): Image => {
	const out = new Uint8Array(base.data);
	for (let ty = 0; ty < top.height; ty++) {
		const by = ty + y;
		if (by < 0 || by >= base.height) continue;
		for (let tx = 0; tx < top.width; tx++) {
			const bx = tx + x;
			if (bx < 0 || bx >= base.width) continue;
			const ti = (ty * top.width + tx) * 4;
			const bi = (by * base.width + bx) * 4;
			const a = (top.data[ti + 3] / 255) * (mask ? mask(tx, ty) : 1);
			for (let c = 0; c < 3; c++) out[bi + c] = Math.round(top.data[ti + c] * a + out[bi + c] * (1 - a));
			out[bi + 3] = Math.round(255 * (a + (out[bi + 3] / 255) * (1 - a)));
		}
	}
	return {width: base.width, height: base.height, data: out};
};

/** Anti-aliased coverage (0..1) of a pixel by a circle (4x4 supersampling). */
export const circleCoverage = (px: number, py: number, cx: number, cy: number, r: number): number => {
	let n = 0;
	for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (Math.hypot(px + (i + 0.5) / 4 - cx, py + (j + 0.5) / 4 - cy) <= r) n++;
	return n / 16;
};

/** Bounding box of pixels whose alpha exceeds `threshold` (0..255); null when the image is fully transparent. */
export const alphaBBox = (img: Image, threshold = 8): {x: number; y: number; w: number; h: number} | null => {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -1;
	let y1 = -1;
	for (let y = 0; y < img.height; y++) {
		for (let x = 0; x < img.width; x++) {
			if (img.data[(y * img.width + x) * 4 + 3] > threshold) {
				if (x < x0) x0 = x;
				if (x > x1) x1 = x;
				if (y < y0) y0 = y;
				if (y > y1) y1 = y;
			}
		}
	}
	return x1 < 0 ? null : {x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1};
};

/** Trim fully transparent margins (alpha <= threshold). Returns the image unchanged when nothing is opaque. */
export const trimTransparent = (img: Image, threshold = 0): Image => {
	const b = alphaBBox(img, threshold);
	return b ? crop(img, b.x, b.y, b.w, b.h) : img;
};

export const pixel = (img: Image, x: number, y: number): [number, number, number, number] => {
	const i = (Math.max(0, Math.min(img.height - 1, Math.round(y))) * img.width + Math.max(0, Math.min(img.width - 1, Math.round(x)))) * 4;
	return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
};
