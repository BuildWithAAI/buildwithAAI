/**
 * ID3v2.3 tag writer (and a reader used to verify it) with chapters per the "ID3v2 Chapter Frame Addendum" v1.0
 * (id3.org, 2005): one CTOC frame (top-level, ordered) listing CHAP frames; each CHAP carries its start/end time in
 * ms, unused byte offsets (0xFFFFFFFF) and a TIT2 sub-frame with the chapter title (plus an optional WXXX link).
 *
 * Why v2.3: it is the most widely read version (podcast apps, Windows, older Apple software) and the chapter
 * addendum covers it. Apple Podcasts reads MP3 chapters from ID3 tags (podcasters.apple.com/support/2482, seen as a
 * search-index extract); ffprobe reads them too, which the tests use as an independent check.
 * Text is ISO-8859-1 when every character fits, else UTF-16 with a BOM (the two encodings v2.3 allows).
 */

export type Id3Chapter = {id: string; startMs: number; endMs: number; title: string; url?: string};

export type Id3Picture = {mime: 'image/jpeg' | 'image/png'; data: Uint8Array; description?: string};

export type Id3Tags = {
	title: string; // TIT2
	artist: string; // TPE1
	album: string; // TALB (the show)
	genre?: string; // TCON
	year?: string; // TYER (YYYY)
	trackNumber?: number; // TRCK (episode number)
	language?: string; // TLAN, ISO 639-2
	comment?: {lang: string; text: string}; // COMM
	copyright?: string; // TCOP
	publisher?: string; // TPUB
	lengthMs?: number; // TLEN
	url?: {description: string; url: string}; // WXXX (episode page)
	picture?: Id3Picture; // APIC, front cover
	chapters?: Id3Chapter[]; // CTOC + CHAP
	tocTitle?: string; // TIT2 inside the CTOC
};

const latin1Ok = (s: string): boolean => [...s].every((ch) => (ch.codePointAt(0) ?? 0) <= 0xff);

const concat = (parts: Uint8Array[]): Uint8Array => {
	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(total);
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
};

const u32 = (n: number): Uint8Array => {
	const b = new Uint8Array(4);
	new DataView(b.buffer).setUint32(0, n >>> 0);
	return b;
};

const synchsafe = (n: number): Uint8Array => {
	if (n >= 1 << 28) throw new Error(`ID3 tag too large (${n} bytes)`);
	return Uint8Array.of((n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f);
};

const latin1 = (s: string): Uint8Array => Uint8Array.from([...s].map((ch) => ch.codePointAt(0) as number));

const utf16 = (s: string): Uint8Array => {
	const out = new Uint8Array(2 + s.length * 2);
	out[0] = 0xff;
	out[1] = 0xfe; // BOM, little endian
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		out[2 + i * 2] = c & 0xff;
		out[3 + i * 2] = c >> 8;
	}
	return out;
};

/** Encoding byte + encoded string, optionally null-terminated. */
const encoded = (s: string, terminate: boolean, forceEnc?: 0 | 1): {enc: 0 | 1; bytes: Uint8Array} => {
	const enc: 0 | 1 = forceEnc ?? (latin1Ok(s) ? 0 : 1);
	const body = enc === 0 ? latin1(s) : utf16(s);
	return {enc, bytes: terminate ? concat([body, enc === 0 ? Uint8Array.of(0) : Uint8Array.of(0, 0)]) : body};
};

const frame = (id: string, data: Uint8Array): Uint8Array => {
	if (!/^[A-Z0-9]{4}$/.test(id)) throw new Error(`bad frame id ${id}`);
	return concat([latin1(id), u32(data.length), Uint8Array.of(0, 0), data]);
};

const textFrame = (id: string, text: string): Uint8Array => {
	const {enc, bytes} = encoded(text, false);
	return frame(id, concat([Uint8Array.of(enc), bytes]));
};

const commFrame = (lang: string, text: string): Uint8Array => {
	const enc: 0 | 1 = latin1Ok(text) ? 0 : 1;
	const desc = encoded('', true, enc).bytes;
	const body = encoded(text, false, enc).bytes;
	return frame('COMM', concat([Uint8Array.of(enc), latin1(lang.slice(0, 3).padEnd(3, ' ')), desc, body]));
};

const wxxxFrame = (description: string, url: string): Uint8Array => {
	const {enc, bytes} = encoded(description, true);
	if (!latin1Ok(url)) throw new Error('WXXX URL must be ISO-8859-1 (percent-encode it)');
	return frame('WXXX', concat([Uint8Array.of(enc), bytes, latin1(url)]));
};

const apicFrame = (pic: Id3Picture): Uint8Array => {
	const {enc, bytes} = encoded(pic.description ?? '', true);
	return frame('APIC', concat([Uint8Array.of(enc), latin1(pic.mime), Uint8Array.of(0), Uint8Array.of(0x03), bytes, pic.data]));
};

const ELEMENT_ID = /^[A-Za-z0-9_-]{1,32}$/;

const chapFrame = (ch: Id3Chapter): Uint8Array => {
	if (!ELEMENT_ID.test(ch.id)) throw new Error(`bad chapter element id ${ch.id}`);
	if (!(ch.endMs > ch.startMs) || ch.startMs < 0) throw new Error(`chapter ${ch.id} has bad times ${ch.startMs}-${ch.endMs}`);
	const sub = [textFrame('TIT2', ch.title), ...(ch.url ? [wxxxFrame('', ch.url)] : [])];
	return frame('CHAP', concat([latin1(ch.id), Uint8Array.of(0), u32(Math.round(ch.startMs)), u32(Math.round(ch.endMs)), u32(0xffffffff), u32(0xffffffff), ...sub]));
};

const ctocFrame = (chapters: Id3Chapter[], title?: string): Uint8Array => {
	if (chapters.length > 255) throw new Error('a CTOC frame holds at most 255 entries');
	const children = chapters.map((c) => concat([latin1(c.id), Uint8Array.of(0)]));
	return frame('CTOC', concat([latin1('toc'), Uint8Array.of(0), Uint8Array.of(0x03), Uint8Array.of(chapters.length), ...children, ...(title ? [textFrame('TIT2', title)] : [])]));
};

/** Builds a complete ID3v2.3 tag (header + frames + padding), to be written before the first MPEG frame. */
export const buildId3v23 = (tags: Id3Tags, padding = 512): Uint8Array => {
	const frames: Uint8Array[] = [textFrame('TIT2', tags.title), textFrame('TPE1', tags.artist), textFrame('TALB', tags.album)];
	if (tags.genre) frames.push(textFrame('TCON', tags.genre));
	if (tags.year) frames.push(textFrame('TYER', tags.year));
	if (tags.trackNumber !== undefined) frames.push(textFrame('TRCK', String(tags.trackNumber)));
	if (tags.language) frames.push(textFrame('TLAN', tags.language));
	if (tags.copyright) frames.push(textFrame('TCOP', tags.copyright));
	if (tags.publisher) frames.push(textFrame('TPUB', tags.publisher));
	if (tags.lengthMs !== undefined) frames.push(textFrame('TLEN', String(Math.round(tags.lengthMs))));
	if (tags.comment) frames.push(commFrame(tags.comment.lang, tags.comment.text));
	if (tags.url) frames.push(wxxxFrame(tags.url.description, tags.url.url));
	if (tags.picture) frames.push(apicFrame(tags.picture));
	if (tags.chapters?.length) {
		const ids = new Set(tags.chapters.map((c) => c.id));
		if (ids.size !== tags.chapters.length) throw new Error('chapter element ids must be unique');
		frames.push(ctocFrame(tags.chapters, tags.tocTitle));
		for (const ch of tags.chapters) frames.push(chapFrame(ch));
	}
	const body = concat([...frames, new Uint8Array(padding)]);
	return concat([latin1('ID3'), Uint8Array.of(3, 0, 0), synchsafe(body.length), body]);
};

// ------------------------------------------------------------------------------------------------------------
// Reader (verification only): parses v2.3 frames, including CHAP/CTOC sub-frames.

export type ParsedFrame = {id: string; data: Uint8Array; text?: string; sub?: ParsedFrame[]};

export type ParsedTag = {version: number; size: number; frames: ParsedFrame[]; chapters: Id3Chapter[]; toc: {flags: number; children: string[]} | null};

const decodeText = (enc: number, bytes: Uint8Array): string => {
	if (enc === 0) return String.fromCharCode(...bytes).replace(/\0+$/, '');
	if (enc === 1) {
		let b = bytes;
		let le = true;
		if (b[0] === 0xff && b[1] === 0xfe) b = b.subarray(2);
		else if (b[0] === 0xfe && b[1] === 0xff) {
			b = b.subarray(2);
			le = false;
		}
		let s = '';
		for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
		return s.replace(/\0+$/, '');
	}
	return new TextDecoder().decode(bytes).replace(/\0+$/, '');
};

const readCString = (b: Uint8Array, at: number): {value: string; next: number} => {
	let end = at;
	while (end < b.length && b[end] !== 0) end++;
	return {value: String.fromCharCode(...b.subarray(at, end)), next: end + 1};
};

const parseFrames = (b: Uint8Array, start: number, end: number): ParsedFrame[] => {
	const out: ParsedFrame[] = [];
	const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
	let at = start;
	while (at + 10 <= end) {
		if (b[at] === 0) break; // padding
		const id = String.fromCharCode(...b.subarray(at, at + 4));
		const size = view.getUint32(at + 4);
		const data = b.subarray(at + 10, at + 10 + size);
		if (at + 10 + size > end) throw new Error(`frame ${id} runs past the tag`);
		const f: ParsedFrame = {id, data};
		if (id[0] === 'T' && id !== 'TXXX') f.text = decodeText(data[0], data.subarray(1));
		if (id === 'CHAP') {
			const {next} = readCString(data, 0);
			f.sub = parseFrames(data, next + 16, data.length);
		}
		if (id === 'CTOC') {
			let p = readCString(data, 0).next;
			const count = data[p + 1];
			p += 2;
			for (let i = 0; i < count; i++) p = readCString(data, p).next;
			f.sub = parseFrames(data, p, data.length);
		}
		out.push(f);
		at += 10 + size;
	}
	return out;
};

export const parseId3 = (file: Uint8Array): ParsedTag | null => {
	if (file.length < 10 || String.fromCharCode(...file.subarray(0, 3)) !== 'ID3') return null;
	const version = file[3];
	const size = ((file[6] & 0x7f) << 21) | ((file[7] & 0x7f) << 14) | ((file[8] & 0x7f) << 7) | (file[9] & 0x7f);
	if (version !== 3) return {version, size, frames: [], chapters: [], toc: null};
	const frames = parseFrames(file, 10, 10 + size);
	const chapters: Id3Chapter[] = [];
	let toc: ParsedTag['toc'] = null;
	for (const f of frames) {
		if (f.id === 'CHAP') {
			const {value: id, next} = readCString(f.data, 0);
			const v = new DataView(f.data.buffer, f.data.byteOffset + next, 16);
			const title = f.sub?.find((s) => s.id === 'TIT2')?.text ?? '';
			const wxxx = f.sub?.find((s) => s.id === 'WXXX');
			let url: string | undefined;
			if (wxxx) {
				const enc = wxxx.data[0];
				let p = 1;
				if (enc === 0) while (p < wxxx.data.length && wxxx.data[p] !== 0) p++;
				else while (p + 1 < wxxx.data.length && !(wxxx.data[p] === 0 && wxxx.data[p + 1] === 0)) p += 2;
				url = String.fromCharCode(...wxxx.data.subarray(p + (enc === 0 ? 1 : 2)));
			}
			chapters.push({id, startMs: v.getUint32(0), endMs: v.getUint32(4), title, ...(url ? {url} : {})});
		}
		if (f.id === 'CTOC') {
			let p = readCString(f.data, 0).next;
			const flags = f.data[p];
			const count = f.data[p + 1];
			p += 2;
			const children: string[] = [];
			for (let i = 0; i < count; i++) {
				const r = readCString(f.data, p);
				children.push(r.value);
				p = r.next;
			}
			toc = {flags, children};
		}
	}
	return {version, size, frames, chapters, toc};
};

/** Bytes of an existing ID3v2 tag at the start of a file (0 when there is none). */
export const id3Length = (file: Uint8Array): number => {
	if (file.length < 10 || String.fromCharCode(...file.subarray(0, 3)) !== 'ID3') return 0;
	const size = ((file[6] & 0x7f) << 21) | ((file[7] & 0x7f) << 14) | ((file[8] & 0x7f) << 7) | (file[9] & 0x7f);
	return 10 + size + (file[5] & 0x10 ? 10 : 0);
};
