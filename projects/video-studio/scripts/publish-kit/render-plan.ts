/**
 * render-plan.sh and the kit's renders[]: commands only, nothing is rendered here.
 * - Long-form 16:9 (1920x1080): <entry> <composition>, props {channel, slug, lang}.
 * - Each Short, re-composed for 9:16 (1080x1920): composition "<composition>-Short-<n>" by convention, or, when
 *   render.shortComposition is set (the episode engine's "EpisodeShort"), that composition with props.shortId.
 * - Thumbnails (1280x720 PNG, up to 3 for YouTube Test & Compare). With the engine's "Thumbnail" still, the
 *   thumbnail builder's checked renderer: `node scripts/thumbnails.ts <channel>/<slug> --lang <lang> --out <dir>`
 *   writes <dir>/<lang>/v0.png..v2.png after checking size, contrast and legibility (its header documents this).
 *   Otherwise one `npx remotion still` per variant with props.variant = 0, 1, 2 (the Thumbnail props contract).
 * - Audio: two-pass ffmpeg loudnorm to -14 LUFS integrated, -1 dBTP true peak, LRA 11, AAC 192k at 48 kHz.
 *   YouTube publishes no loudness target; -14 LUFS / -1 dBTP is the community norm recorded in CLAUDE.md.
 *   Options checked against `ffmpeg -h filter=loudnorm` (ffmpeg 6.1.1 in this environment).
 */
import {DEFAULT_RENDER} from './episode.ts';
import type {Episode, PublishKit} from './types.ts';
import {clock} from './util.ts';

export const LOUDNESS = {integratedLufs: -14, truePeakDb: -1, lra: 11} as const;

/** Single-quotes a value for bash. */
export const shq = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

export const mediaDir = (e: Episode): string => `out/publish/${e.channel}/${e.slug}/media`;

/** True when thumbnails come from the engine's Thumbnail still, rendered and checked by scripts/thumbnails.ts. */
export const usesThumbnailBuilder = (e: Episode): boolean =>
	e.render.entry === DEFAULT_RENDER.entry && e.render.thumbnailComposition === DEFAULT_RENDER.thumbnailComposition;

export const buildRenders = (e: Episode): PublishKit['renders'] => {
	const media = mediaDir(e);
	const base = {channel: e.channel, slug: e.slug, lang: e.lang};
	const {entry, composition, shortComposition, thumbnailComposition} = e.render;
	const render = (comp: string, output: string, props: object): string => `npx remotion render ${entry} ${comp} ${output} --props=${shq(JSON.stringify(props))}`;
	const still = (output: string, variant: number): string =>
		`npx remotion still ${entry} ${thumbnailComposition} ${output} --image-format=png --props=${shq(JSON.stringify({...base, variant}))}`;
	const builder = `node scripts/thumbnails.ts ${e.channel}/${e.slug} --lang ${e.lang} --out ${media}/thumbnails`;
	const variants = Array.from({length: usesThumbnailBuilder(e) ? DEFAULT_RENDER.thumbnails : e.render.thumbnails}, (_, i) => i);
	const long = `${media}/long.mp4`;
	return [
		{id: 'long', kind: 'long', command: render(composition, long, base), output: long},
		...e.shorts.map((s) => {
			const output = `${media}/short-${s.n}.mp4`;
			const command = shortComposition ? render(shortComposition, output, {...base, shortId: s.id}) : render(`${composition}-Short-${s.n}`, output, base);
			return {id: `short-${s.n}`, kind: 'short' as const, command, output};
		}),
		...variants.map((i) => {
			const output = usesThumbnailBuilder(e) ? `${media}/thumbnails/${e.lang}/v${i}.png` : `${media}/thumb-v${i}.png`;
			return {id: `thumb-v${i}`, kind: 'thumbnail' as const, command: usesThumbnailBuilder(e) ? builder : still(output, i), output};
		}),
	];
};

const LOUDNORM_FN = `# Two-pass EBU R128 loudness normalisation, in place: ${LOUDNESS.integratedLufs} LUFS integrated, ${LOUDNESS.truePeakDb} dBTP true peak, LRA ${LOUDNESS.lra}.
# Pass 1 measures; pass 2 applies the measured values (linear=true). Video is copied; audio becomes AAC 192k, 48 kHz.
loudnorm() {
  local file="$1" tmp stats args
  tmp="\${file%.*}.loudnorm-tmp.mp4"
  if [ -z "$(ffprobe -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 "$file")" ]; then
    echo "loudnorm: $file has no audio stream" >&2
    return 1
  fi
  stats="$(ffmpeg -hide_banner -nostats -i "$file" -map 0:a:0 -af loudnorm=I=${LOUDNESS.integratedLufs}:TP=${LOUDNESS.truePeakDb}:LRA=${LOUDNESS.lra}:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')"
  args="$(printf '%s' "$stats" | node -e '
    const s = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    const keys = ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"];
    if (!keys.every((k) => Number.isFinite(Number(s[k])))) { console.error("loudnorm: no measurable audio in this file"); process.exit(1); }
    process.stdout.write("measured_I=" + s.input_i + ":measured_TP=" + s.input_tp + ":measured_LRA=" + s.input_lra + ":measured_thresh=" + s.input_thresh + ":offset=" + s.target_offset);
  ')"
  ffmpeg -hide_banner -nostats -y -i "$file" -map '0:v:0?' -map 0:a:0 -c:v copy \\
    -af "loudnorm=I=${LOUDNESS.integratedLufs}:TP=${LOUDNESS.truePeakDb}:LRA=${LOUDNESS.lra}:\${args}:linear=true:print_format=summary" \\
    -c:a aac -b:a 192k -ar 48000 -movflags +faststart "$tmp"
  mv "$tmp" "$file"
}`;

export const renderPlanScript = (e: Episode, renders: PublishKit['renders'], generatedAt: string): string => {
	const kitDir = `out/publish/${e.channel}/${e.slug}`;
	const long = renders.filter((r) => r.kind === 'long');
	const shorts = renders.filter((r) => r.kind === 'short');
	const thumbCommands = [...new Set(renders.filter((r) => r.kind === 'thumbnail').map((r) => r.command))];
	const usesEngine = e.render.entry === DEFAULT_RENDER.entry;
	const storyboard = `content/${e.channel}/${e.slug}/${e.lang === 'en' ? 'storyboard.json' : `storyboard.${e.lang}.json`}`;
	const shortNote = (id: string): string => {
		const s = e.shorts.find((x) => `short-${x.n}` === id);
		return s ? `# Short ${s.n}: scenes ${s.sceneIds[0]}-${s.sceneIds[s.sceneIds.length - 1]} (${clock(s.startSec)}-${clock(s.endSec)}, ${clock(s.endSec - s.startSec)})` : '';
	};
	return `#!/usr/bin/env bash
# Render plan for ${e.channel}/${e.slug}: ${e.title.replace(/[\r\n]/g, ' ')}
# Generated ${generatedAt} by scripts/publish-kit. Commands only: nothing has been rendered yet.
# Usage: bash ${kitDir}/render-plan.sh [all|long|shorts|thumbnails|loudnorm <file.mp4>...]
set -euo pipefail
cd "$(dirname "$0")/../../../.."   # projects/video-studio
mkdir -p ${shq(mediaDir(e))}

${LOUDNORM_FN}

preflight() {
  [ -f ${shq(e.render.entry)} ] || { echo "Remotion entry ${e.render.entry} not found" >&2; exit 1; }
${usesEngine ? `  [ -f ${shq(storyboard)} ] || { echo "No ${storyboard}: the episode engine renders from it. Create it before rendering." >&2; exit 1; }\n` : ''}}

render_long() {
  # Long-form 16:9, 1920x1080, 30 fps
${long.map((r) => `  ${r.command}\n  loudnorm ${r.output}`).join('\n')}
}

render_shorts() {
  # Vertical 9:16, 1080x1920, re-composed (never a crop of the landscape render)
${shorts.map((r) => `  ${shortNote(r.id)}\n  ${r.command}\n  loudnorm ${r.output}`).join('\n')}
}

render_thumbnails() {
  # 1280x720 PNG, up to 3 variants for YouTube Test & Compare; each must stay under 2 MB for phone uploads
${
	usesThumbnailBuilder(e)
		? '  # scripts/thumbnails.ts renders v0-v2 and fails on size, contrast or legibility problems (see its header)\n'
		: ''
}${thumbCommands.map((c) => `  ${c}`).join('\n') || '  :'}
}

case "\${1:-all}" in
  all) preflight; render_long; render_shorts; render_thumbnails ;;
  long) preflight; render_long ;;
  shorts) preflight; render_shorts ;;
  thumbnails) preflight; render_thumbnails ;;
  loudnorm) shift; for f in "$@"; do loudnorm "$f"; done ;;
  *) echo "usage: $0 [all|long|shorts|thumbnails|loudnorm <file.mp4>...]" >&2; exit 2 ;;
esac
`;
};
