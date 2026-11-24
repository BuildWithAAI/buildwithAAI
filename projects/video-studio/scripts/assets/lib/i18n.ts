/**
 * Interface text for the generated assets (headings, labels, link lines), not episode copy.
 * en is the reference. es and pt-br (the launch dubbing languages) were written for this tool and still need a
 * native speaker's review, like the dubs themselves. Other languages fall back to English and the manifest says so.
 */
import type {Lang} from './types.ts';

export type Strings = {
	skip: string;
	watchOnYouTube: string;
	videoPending: string;
	takeaways: string;
	transcript: string;
	transcriptNote: string;
	transcriptFromScript: string;
	sources: string;
	accessed: string;
	links: string;
	disclosures: string;
	subscribeTitle: string;
	subscribeText: string;
	subscribeButton: string;
	developing: string;
	asOf: string;
	developingNote: string;
	corrections: string;
	machineTranslation: string;
	howWeMakeMoney: string;
	privacy: string;
	videoLength: string;
	published: string;
	chapters: string;
	fiction: string;
	watchFrom: string;
	fullEpisode: string;
	articleLink: string;
	whatWeCover: string;
	developingPrefix: string;
	subscribeLine: string;
	notAdvice: string;
	minutes: string; // "{n} min"
};

const EN: Strings = {
	skip: 'Skip to content',
	watchOnYouTube: 'Watch on YouTube',
	videoPending: 'The video is not published yet. This page is a preview.',
	takeaways: 'Key takeaways',
	transcript: 'Transcript',
	transcriptNote: 'Narrated by Zoo. Badger, his co-host, does not speak: his reactions are in the video, not in this transcript.',
	transcriptFromScript: 'This transcript comes from the script, so the narration may differ slightly.',
	sources: 'Sources',
	accessed: 'accessed',
	links: 'Links from this episode',
	disclosures: 'Disclosures',
	subscribeTitle: 'New episodes by email',
	subscribeText: 'Free. One email per new episode. Some links in our emails are affiliate links, and each one is labelled.',
	subscribeButton: 'Subscribe',
	developing: 'Developing story',
	asOf: 'as of',
	developingNote: 'Details may change. We update this page and pin corrections when facts are confirmed.',
	corrections: 'Corrections',
	machineTranslation: 'Machine translation: a native speaker has not reviewed this page yet.',
	howWeMakeMoney: 'How we make money',
	privacy: 'Privacy',
	videoLength: 'Video',
	published: 'Published',
	chapters: 'Chapters',
	fiction: 'Fictional story · composite characters · not financial advice',
	watchFrom: 'Watch from',
	fullEpisode: 'Full episode:',
	articleLink: 'Transcript and sources:',
	whatWeCover: 'In this episode:',
	developingPrefix: 'DEVELOPING:',
	subscribeLine: 'New episodes by email:',
	notAdvice: 'Educational content. Not financial advice.',
	minutes: '{n} min',
};

const ES: Strings = {
	skip: 'Saltar al contenido',
	watchOnYouTube: 'Ver en YouTube',
	videoPending: 'El vídeo aún no está publicado. Esta página es una vista previa.',
	takeaways: 'Puntos clave',
	transcript: 'Transcripción',
	transcriptNote: 'Narra Zoo. Badger, su copresentador, no habla: sus reacciones están en el vídeo, no en esta transcripción.',
	transcriptFromScript: 'Esta transcripción procede del guion, así que la narración puede variar ligeramente.',
	sources: 'Fuentes',
	accessed: 'consultado',
	links: 'Enlaces de este episodio',
	disclosures: 'Avisos',
	subscribeTitle: 'Nuevos episodios por correo',
	subscribeText: 'Gratis. Un correo por episodio nuevo. Algunos enlaces de nuestros correos son de afiliado y siempre van señalados.',
	subscribeButton: 'Suscribirse',
	developing: 'Noticia en desarrollo',
	asOf: 'a fecha de',
	developingNote: 'Los detalles pueden cambiar. Actualizamos esta página y fijamos las correcciones cuando se confirman los hechos.',
	corrections: 'Correcciones',
	machineTranslation: 'Traducción automática: un hablante nativo aún no ha revisado esta página.',
	howWeMakeMoney: 'Cómo ganamos dinero',
	privacy: 'Privacidad',
	videoLength: 'Vídeo',
	published: 'Publicado',
	chapters: 'Capítulos',
	fiction: 'Historia ficticia · personajes compuestos · no es asesoramiento financiero',
	watchFrom: 'Ver desde',
	fullEpisode: 'Episodio completo:',
	articleLink: 'Transcripción y fuentes:',
	whatWeCover: 'En este episodio:',
	developingPrefix: 'EN DESARROLLO:',
	subscribeLine: 'Nuevos episodios por correo:',
	notAdvice: 'Contenido educativo. No es asesoramiento financiero.',
	minutes: '{n} min',
};

const PT_BR: Strings = {
	skip: 'Pular para o conteúdo',
	watchOnYouTube: 'Assistir no YouTube',
	videoPending: 'O vídeo ainda não foi publicado. Esta página é uma prévia.',
	takeaways: 'Pontos principais',
	transcript: 'Transcrição',
	transcriptNote: 'Narração de Zoo. Badger, o coapresentador, não fala: as reações dele estão no vídeo, não nesta transcrição.',
	transcriptFromScript: 'Esta transcrição vem do roteiro, então a narração pode variar um pouco.',
	sources: 'Fontes',
	accessed: 'acessado em',
	links: 'Links deste episódio',
	disclosures: 'Avisos',
	subscribeTitle: 'Novos episódios por e-mail',
	subscribeText: 'Grátis. Um e-mail por episódio novo. Alguns links dos nossos e-mails são de afiliado e sempre vêm identificados.',
	subscribeButton: 'Inscrever-se',
	developing: 'Notícia em desenvolvimento',
	asOf: 'até',
	developingNote: 'Os detalhes podem mudar. Atualizamos esta página e fixamos as correções quando os fatos são confirmados.',
	corrections: 'Correções',
	machineTranslation: 'Tradução automática: um falante nativo ainda não revisou esta página.',
	howWeMakeMoney: 'Como ganhamos dinheiro',
	privacy: 'Privacidade',
	videoLength: 'Vídeo',
	published: 'Publicado em',
	chapters: 'Capítulos',
	fiction: 'História fictícia · personagens compostos · não é aconselhamento financeiro',
	watchFrom: 'Assistir a partir de',
	fullEpisode: 'Episódio completo:',
	articleLink: 'Transcrição e fontes:',
	whatWeCover: 'Neste episódio:',
	developingPrefix: 'EM DESENVOLVIMENTO:',
	subscribeLine: 'Novos episódios por e-mail:',
	notAdvice: 'Conteúdo educativo. Não é aconselhamento financeiro.',
	minutes: '{n} min',
};

const TABLE: Partial<Record<Lang, Strings>> = {en: EN, es: ES, 'pt-br': PT_BR};

export const strings = (lang: Lang): {s: Strings; fallback: boolean} => {
	const s = TABLE[lang];
	return s ? {s, fallback: false} : {s: EN, fallback: true};
};

/** hreflang / HTML lang values (BCP 47). */
export const HREFLANG: Record<Lang, string> = {en: 'en', es: 'es', 'pt-br': 'pt-BR', hi: 'hi', it: 'it', zh: 'zh-Hans', ja: 'ja'};
/** OpenGraph og:locale values. */
export const OG_LOCALE: Record<Lang, string> = {en: 'en_US', es: 'es_ES', 'pt-br': 'pt_BR', hi: 'hi_IN', it: 'it_IT', zh: 'zh_CN', ja: 'ja_JP'};
/** ISO 639-2 codes for ID3 (TLAN, COMM). */
export const ISO639_2: Record<Lang, string> = {en: 'eng', es: 'spa', 'pt-br': 'por', hi: 'hin', it: 'ita', zh: 'zho', ja: 'jpn'};
/** RSS 2.0 <language> values. */
export const RSS_LANG: Record<Lang, string> = {en: 'en', es: 'es', 'pt-br': 'pt-br', hi: 'hi', it: 'it', zh: 'zh-cn', ja: 'ja'};

/** Display date in the page language, e.g. "24 November 2026" (UTC). */
export const displayDate = (iso: string, lang: Lang): string => {
	const locale = HREFLANG[lang];
	try {
		return new Intl.DateTimeFormat(locale, {year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'}).format(new Date(iso));
	} catch {
		return iso.slice(0, 10);
	}
};
