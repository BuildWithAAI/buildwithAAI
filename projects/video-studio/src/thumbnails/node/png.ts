/**
 * Minimal PNG codec and resampler for the thumbnail checks (Node only, no dependencies: node:zlib). Decodes 8-bit
 * truecolour or greyscale PNGs, with or without alpha, non-interlaced (what Remotion writes); encodes 8-bit RGB.
 * Never imported by the Remotion bundle.
 */
import {crc32, deflateSync, inflateSync} from 'node:zlib';

export type Image = {width: number; height: number; data: Uint8Array}; // RGB, 3 bytes per pixel, row-major

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const decodePng = (buf: Uint8Array): Image => {
	const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
	if (!b.subarray(0, 8).equals(SIG)) throw new Error('not a PNG file');
	let pos = 8;
	let width = 0;
	let height = 0;
	let colorType = -1;
	const idat: Buffer[] = [];
	while (pos < b.length) {
		const len = b.readUInt32BE(pos);
		const type = b.toString('latin1', pos + 4, pos + 8);
		const body = b.subarray(pos + 8, pos + 8 + len);
		if (type === 'IHDR') {
			width = body.readUInt32BE(0);
			height = body.readUInt32BE(4);
			const depth = body[8];
			colorType = body[9];
			if (depth !== 8) throw new Error(`PNG bit depth ${depth} is not supported (8 only)`);
			if (body[12] !== 0) throw new Error('interlaced PNGs are not supported');
			if (![0, 2, 4, 6].includes(colorType)) throw new Error(`PNG colour type ${colorType} is not supported`);
		} else if (type === 'IDAT') idat.push(body);
		else if (type === 'IEND') break;
		pos += 12 + len;
	}
	const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 4 ? 2 : 1;
	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * channels;
	const px = new Uint8Array(height * stride);
	for (let y = 0; y < height; y++) {
		const f = raw[y * (stride + 1)];
		const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const row = px.subarray(y * stride, (y + 1) * stride);
		const up = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
		for (let i = 0; i < stride; i++) {
			const a = i >= channels ? row[i - channels] : 0;
			const u = up ? up[i] : 0;
			const c = up && i >= channels ? up[i - channels] : 0;
			let v = src[i];
			if (f === 1) v += a;
			else if (f === 2) v += u;
			else if (f === 3) v += (a + u) >> 1;
			else if (f === 4) {
				const p = a + u - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - u);
				const pc = Math.abs(p - c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? u : c;
			} else if (f !== 0) throw new Error(`bad PNG filter ${f}`);
			row[i] = v & 255;
		}
	}
	// flatten to RGB (alpha composited over black would hide problems: thumbnails must be opaque, so fail instead)
	const data = new Uint8Array(width * height * 3);
	for (let i = 0; i < width * height; i++) {
		const o = i * channels;
		if ((channels === 4 && px[o + 3] !== 255) || (channels === 2 && px[o + 1] !== 255)) throw new Error('the PNG has transparent pixels; a thumbnail must be opaque');
		if (channels >= 3) {
			data[i * 3] = px[o];
			data[i * 3 + 1] = px[o + 1];
			data[i * 3 + 2] = px[o + 2];
		} else data[i * 3] = data[i * 3 + 1] = data[i * 3 + 2] = px[o];
	}
	return {width, height, data};
};

const chunk = (type: string, body: Buffer): Buffer => {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(body.length, 0);
	head.write(type, 4, 'latin1');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
	return Buffer.concat([head, body, crc]);
};

export const encodePng = (img: Image): Buffer => {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(img.width, 0);
	ihdr.writeUInt32BE(img.height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const stride = img.width * 3;
	const raw = Buffer.alloc(img.height * (stride + 1));
	for (let y = 0; y < img.height; y++) {
		raw[y * (stride + 1)] = 0;
		Buffer.from(img.data.buffer, img.data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
	}
	return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
};

/**
 * Area-average (box) downscale with exact fractional pixel coverage, in sRGB values like the scalers that serve and
 * display thumbnails. Only for shrinking.
 */
export const downscale = (img: Image, w: number, h: number): Image => {
	if (w > img.width || h > img.height) throw new Error('downscale only shrinks');
	const sx = img.width / w;
	const sy = img.height / h;
	const out = new Uint8Array(w * h * 3);
	for (let oy = 0; oy < h; oy++) {
		const y0 = oy * sy;
		const y1 = y0 + sy;
		for (let ox = 0; ox < w; ox++) {
			const x0 = ox * sx;
			const x1 = x0 + sx;
			let r = 0;
			let g = 0;
			let bl = 0;
			let area = 0;
			for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
				const wy = Math.min(y + 1, y1) - Math.max(y, y0);
				for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
					const wgt = wy * (Math.min(x + 1, x1) - Math.max(x, x0));
					const i = (y * img.width + x) * 3;
					r += img.data[i] * wgt;
					g += img.data[i + 1] * wgt;
					bl += img.data[i + 2] * wgt;
					area += wgt;
				}
			}
			const o = (oy * w + ox) * 3;
			out[o] = Math.round(r / area);
			out[o + 1] = Math.round(g / area);
			out[o + 2] = Math.round(bl / area);
		}
	}
	return {width: w, height: h, data: out};
};

/** Nearest-neighbour enlargement, for looking at a small render pixel by pixel. */
export const enlarge = (img: Image, k: number): Image => {
	const w = img.width * k;
	const h = img.height * k;
	const out = new Uint8Array(w * h * 3);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = ((Math.floor(y / k) * img.width + Math.floor(x / k)) * 3) as number;
			const o = (y * w + x) * 3;
			out[o] = img.data[i];
			out[o + 1] = img.data[i + 1];
			out[o + 2] = img.data[i + 2];
		}
	return {width: w, height: h, data: out};
};

/** Paste `src` into `dst` at (x, y) (clipped). */
export const paste = (dst: Image, src: Image, x: number, y: number): void => {
	for (let sy = 0; sy < src.height; sy++) {
		const dy = y + sy;
		if (dy < 0 || dy >= dst.height) continue;
		for (let sx = 0; sx < src.width; sx++) {
			const dx = x + sx;
			if (dx < 0 || dx >= dst.width) continue;
			const i = (sy * src.width + sx) * 3;
			const o = (dy * dst.width + dx) * 3;
			dst.data[o] = src.data[i];
			dst.data[o + 1] = src.data[i + 1];
			dst.data[o + 2] = src.data[i + 2];
		}
	}
};

export const blank = (width: number, height: number, rgb: readonly [number, number, number]): Image => {
	const data = new Uint8Array(width * height * 3);
	for (let i = 0; i < width * height; i++) {
		data[i * 3] = rgb[0];
		data[i * 3 + 1] = rgb[1];
		data[i * 3 + 2] = rgb[2];
	}
	return {width, height, data};
};
