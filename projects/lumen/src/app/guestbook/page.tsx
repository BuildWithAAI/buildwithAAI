import { sendGift, sendNote, sendTouch } from "../actions";
import { getEngine } from "../../server/engine";

export default function GuestbookPage() {
  const snap = getEngine().snapshot();
  return (
    <div className="grid">
      <section className="card">
        <p className="kicker">Gifts</p>
        <h1>Leave something in the bowl</h1>
        <p className="muted">Notes are untrusted, length-limited, and never able to spend money.</p>
        <form action={sendGift}>
          <input name="author" placeholder="Your name" maxLength={40} />
          <select name="gift">
            {snap.gifts.map((gift) => (
              <option key={gift.id} value={gift.id}>{gift.name}</option>
            ))}
          </select>
          <textarea name="note" maxLength={140} placeholder="A short note (140 characters)" />
          <button type="submit">Leave gift</button>
        </form>
        <div className="row">
          <form action={sendTouch}><input type="hidden" name="kind" value="wave" /><button type="submit">Wave</button></form>
          <form action={sendTouch}><input type="hidden" name="kind" value="tap" /><button type="submit">Tap the water</button></form>
        </div>
      </section>
      <section className="card">
        <p className="kicker">Guestbook</p>
        <form action={sendNote}>
          <input name="author" placeholder="Your name" maxLength={40} />
          <textarea name="note" maxLength={280} placeholder="A note for later. Zoora reads it in its own time." />
          <button type="submit">Leave note</button>
        </form>
      </section>
    </div>
  );
}
