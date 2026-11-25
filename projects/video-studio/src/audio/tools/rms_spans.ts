/**
 * Speech spans of a narration WAV from its RMS, computed in Node by the same code <MusicBed duck={{narration}}>
 * runs in the render tab (core/speech.ts speechSpansFromAudio over core/wav.ts parseWav). Prints the
 * AudioDuckRms props for mode 'speech' as JSON.
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/audio/tools/rms_spans.ts <narration under public/> <offsetSec>
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {speechSpansFromAudio} from '../core/speech.ts';
import {parseWav} from '../core/wav.ts';

const STUDIO = fileURLToPath(new URL('../../../', import.meta.url));
const narration = process.argv[2] ?? 'generated/zoora-security/_audio-demo/en/narration.wav';
const offsetSec = Number(process.argv[3] ?? 1);
const b = readFileSync(`${STUDIO}public/${narration}`);
const wav = parseWav(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
const speech = speechSpansFromAudio(wav.channels, wav.sampleRate, {offsetSec});
process.stdout.write(JSON.stringify({mode: 'speech', narration, offsetSec, speech}) + '\n');
