import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, describe, it} from 'node:test';
import {findClaims} from './claims.ts';
import {approvedDisclosure, loadApprovedDisclosures, localizedDisclosureProblems} from './disclosures.ts';
import {urlsIn} from './inputs.ts';

describe('income-claim rules for upload metadata (en, es, pt)', () => {
	const claims: [string, string][] = [
		['Guaranteed returns every week', 'guaranteed'],
		['Earn $500 a day from your phone', 'an earnings figure'],
		['This 100x gem is next', 'a 100x-style multiplier'],
		['Ganancias garantizadas cada semana', 'garantizado / garantido'],
		['Te garantizo resultados en 7 días', 'garantizado / garantido'],
		['Una inversión sin riesgo', 'sin riesgo / sem risco'],
		['Hazte rico con este truco', 'hacerse rico / ficar rico'],
		['Ingresos pasivos para siempre', 'ingresos pasivos / renda passiva'],
		['Duplica tu dinero en un mes', 'duplica tu dinero / dobre seu dinheiro'],
		['Libertad financiera en 30 días', 'libertad financiera / liberdade financeira'],
		['Gana $500 al día', 'an earnings figure (es/pt)'],
		['ganancias de 500 dólares', 'an earnings figure (es/pt)'],
		['Gana dinero rápido', 'gana dinero rápido / ganhe dinheiro rápido'],
		['20% de rentabilidad mensual', 'a percentage return (es/pt)'],
		['Deja tu trabajo hoy', 'deja tu trabajo / largue seu emprego'],
		['Rumbo a la luna', 'hasta la luna / até a lua'],
		['Precio objetivo de $10', 'a price target (es/pt)'],
		['Es una apuesta segura', 'apuesta segura / aposta certa'],
		['No puedes perder.', 'no puedes perder / não tem como perder'],
		['Es 100% seguro', 'a safety promise (es/pt)'],
		['Ganancias diarias', 'ganancias diarias / lucro todo dia'],
		['Compra ya antes de que suba', 'compra ya / compre já'],
		['Bono de bienvenida', 'bono de bienvenida / bônus de cadastro'],
		['Lucros garantidos', 'garantizado / garantido'],
		['Fique rico rápido', 'hacerse rico / ficar rico'],
		['Renda passiva', 'ingresos pasivos / renda passiva'],
		['Dobre seu dinheiro', 'duplica tu dinero / dobre seu dinheiro'],
		['Ganhe R$ 500 por dia', 'an earnings figure (es/pt)'],
		['Ganhe dinheiro rápido', 'gana dinero rápido / ganhe dinheiro rápido'],
		['10% ao mês', 'a percentage return (es/pt)'],
		['Largue seu emprego', 'deja tu trabajo / largue seu emprego'],
		['Não tem como perder.', 'no puedes perder / não tem como perder'],
		['Compre já', 'compra ya / compre já'],
		['bônus de boas-vindas', 'bono de bienvenida / bônus de cadastro'],
	];
	for (const [text, label] of claims) {
		it(`flags "${text}"`, () => assert.ok(findClaims(text).some((h) => h.label === label), JSON.stringify(findClaims(text))));
	}

	it('leaves honest copy alone: disclosures, warnings, denials, a product warranty', () => {
		for (const text of [
			'Enlace de afiliado: puedo ganar una comisión si compras. No te cuesta nada extra.',
			'Link de afiliado: posso ganhar uma comissão se você comprar. Não custa nada a mais para você.',
			'Historia ficticia con personajes compuestos. No es asesoría financiera.',
			'História fictícia com personagens compostos. Não é aconselhamento financeiro.',
			'Ninguna billetera es 100% segura.',
			'Nenhuma carteira é 100% segura.',
			'No puedes perder tu frase semilla.',
			'Billetera física con 2 años de garantía',
			'Contiene un enlace de afiliado (aviso abajo).',
			'10% de descuento',
			'No wallet is 100% safe.',
		]) {
			assert.deepEqual(findClaims(text), [], text);
		}
	});
});

describe('owner-approved disclosures for translations (the asset tools\' config)', () => {
	const root = mkdtempSync(join(tmpdir(), 'uploader-disclosures-'));
	after(() => rmSync(root, {recursive: true, force: true}));
	const write = (config: unknown) => {
		mkdirSync(join(root, 'scripts', 'assets', 'config'), {recursive: true});
		writeFileSync(join(root, 'scripts', 'assets', 'config', 'channels.json'), JSON.stringify(config));
	};
	const offer = {id: 'hardware-wallet', hubUrl: 'https://go.zoora.ai/go/hardware-wallet?v=ep&s=yt', disclosure: 'Affiliate link: I may earn a commission.'};

	it('reads defaults and the channel\'s own entries (the channel wins), keyed by BCP-47 tag', () => {
		write({defaults: {offerDisclosures: {'hardware-wallet': {es: 'Defecto.', 'pt-br': 'Padrão.'}}}, channels: {'zoora-ai': {offerDisclosures: {'hardware-wallet': {es: 'Del canal.'}}}}});
		const approved = loadApprovedDisclosures(root, 'zoora-ai');
		assert.equal(approved.problem, null);
		assert.deepEqual(approved.byOffer['hardware-wallet'], {es: 'Del canal.', 'pt-BR': 'Padrão.'});
		assert.equal(approvedDisclosure(approved, offer, 'es-419'), 'Del canal.', 'same language, another region');
		assert.equal(approvedDisclosure(approved, offer, 'en-GB'), offer.disclosure, 'English uses the registry text');
		assert.equal(approvedDisclosure(approved, offer, 'it'), null);
	});

	it('names an unreadable config instead of failing', () => {
		writeFileSync(join(root, 'scripts', 'assets', 'config', 'channels.json'), '{broken');
		assert.match(loadApprovedDisclosures(root, 'zoora-ai').problem ?? '', /not valid JSON/);
		assert.match(loadApprovedDisclosures(join(root, 'nowhere'), 'zoora-ai').problem ?? '', /does not exist/);
	});

	it('refuses a hub link that is not one of the kit offers', () => {
		write({defaults: {offerDisclosures: {}}});
		const problems = localizedDisclosureProblems('Otra: https://go.zoora.ai/go/exchange-x?v=ep&s=yt', 'localizations.es', 'es', {offers: [offer]}, loadApprovedDisclosures(root, 'zoora-ai'), urlsIn);
		assert.match(problems.join(), /not one of the kit's offers/);
	});
});
