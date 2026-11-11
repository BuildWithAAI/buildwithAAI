import { WishlistView } from "../../components/WishlistView";
import { getEngine } from "../../server/engine";
import { listKeeperWishes, publicWishLink } from "../../wishlist/board";

export default function WishlistPage() {
  const engine = getEngine();
  const items = listKeeperWishes(engine.db, "open").map((item) => {
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
  return <WishlistView items={items} wants={engine.snapshot().publicWants} />;
}
