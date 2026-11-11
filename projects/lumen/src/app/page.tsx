import { publicModeOn } from "../auth/publicMode";
import { HomeFrame } from "../components/HomeFrame";
import { homeGreeting } from "../components/visit";
import type { WishlistItemView } from "../components/WishlistView";
import { Ledger } from "../money/ledger";
import { publicBooks, type PaperRow } from "../money/publicBooks";
import { moneyLive } from "../money/rules";
import { getEngine } from "../server/engine";
import { thoughtLines } from "../world/bubble";
import { neighborhood } from "../world/chunks";
import { nearbyGuests, visitorsEnabled } from "../world/visitors";
import { listKeeperWishes, publicWishLink } from "../wishlist/board";

export const metadata = {
  alternates: { canonical: "./" },
  description: "Zoora's island. She is an AI, not a human. Not financial advice.",
};

export default async function HomePage({ searchParams }: { searchParams: Promise<{ cam?: string }> }) {
  const params = await searchParams;
  const cam = params.cam && /^[a-z-]{1,16}$/.test(params.cam) ? params.cam : "overview";
  const engine = getEngine();
  const world = JSON.parse(JSON.stringify(engine.world()));
  const snap = engine.snapshot();
  const zoora = world.agents.find((agent: { name: string }) => agent.name === "Zoora");
  const guest = engine.db.prepare("SELECT reply FROM messages WHERE channel = 'visitor' AND reply IS NOT NULL ORDER BY created_at DESC LIMIT 1").get() as { reply: string } | undefined;
  const thoughts = thoughtLines({
    activity: typeof zoora?.activity === "string" ? zoora.activity : null,
    diary: world.diary.find((line: string) => !world.choices.includes(line)) ?? null,
    sceneWhy: world.choices[0] ?? null,
    wish: (world.wishlist as string[]).find((line) => line !== "The board is blank.") ?? null,
    guestReply: guest?.reply ?? null,
  });
  const paper = engine.db.prepare("SELECT symbol, side, mode FROM paper_trades WHERE mode != 'live' ORDER BY created_at DESC LIMIT 6").all() as PaperRow[];
  const books = publicBooks(new Ledger(engine.db).list(), paper, moneyLive(engine.env));
  const wishes: WishlistItemView[] = listKeeperWishes(engine.db, "open").map((item) => {
    const link = publicWishLink(item.link, engine.env);
    return {
      id: item.id,
      rank: item.rank,
      name: item.name,
      why: item.why,
      estimateCents: item.estimateCents,
      linkHref: link.href,
      linkText: link.text,
    };
  });
  const chunks = neighborhood(engine.db, 0, 0, 1);
  const guests = visitorsEnabled(engine.env) ? nearbyGuests(engine.db, 0, 0, 1, Date.now()) : [];
  return (
    <HomeFrame
      world={world}
      cam={cam}
      greeting={homeGreeting(snap.awake, snap.feeling)}
      thoughts={thoughts}
      books={books}
      wishes={wishes}
      showKeeper={!publicModeOn(engine.env)}
      showMoney={moneyLive(engine.env)}
      chunks={chunks}
      guests={guests}
    />
  );
}
