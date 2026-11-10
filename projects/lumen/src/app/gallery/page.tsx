import { publicModeOn } from "../../auth/publicMode";
import { buyArt } from "../actions";
import { getEngine } from "../../server/engine";

export default function GalleryPage({ searchParams }: { searchParams: Promise<{ sales?: string }> }) {
  const snap = getEngine().snapshot();
  const publicMode = publicModeOn();
  return (
    <div>
      <h1>Gallery</h1>
      <p className="muted">{publicMode ? "Pieces Zoora made. Nothing here is for sale while the island is public." : `Pieces Zoora made in the ink studio. A price appears only after the keeper approves a listing. Sales mode: ${snap.money.sales}.`}</p>
      <GalleryNote searchParams={searchParams} />
      <div className="gallery">
        {snap.gallery.map((item) => {
          const art = item as { id: string; title: string; svg: string; listed: number; price_cents: number | null; likes: number; favorites: number };
          return (
            <article className="card" key={art.id}>
              <div dangerouslySetInnerHTML={{ __html: art.svg }} />
              <h2>{art.title}</h2>
              <p className="muted">{art.likes} likes · {art.favorites} favorites</p>
              {!publicMode && art.listed && art.price_cents != null ? (
                <form action={buyArt}>
                  <input type="hidden" name="id" value={art.id} />
                  <input type="hidden" name="key" value={`buy-${art.id}-${art.price_cents}`} />
                  <button type="submit">Buy · ${(art.price_cents / 100).toFixed(2)}</button>
                </form>
              ) : (
                <p className="muted">Not for sale.</p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

async function GalleryNote({ searchParams }: { searchParams: Promise<{ sales?: string }> }) {
  const params = await searchParams;
  if (params.sales === "closed") return <p className="warn">Sales are closed. No charge was created.</p>;
  return null;
}
