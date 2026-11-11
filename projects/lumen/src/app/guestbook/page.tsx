import React from "react";
import { AI_NOTICE } from "../../components/AiNotice";
import { CRISIS_REPLY } from "../../brain/crisis";
import { sendGift, sendNote, sendTouch } from "../actions";
import { getEngine } from "../../server/engine";

const SENT: Record<string, string> = {
  gift: "The gift is in the bowl.",
  note: "Zoora kept the note.",
  wave: "Zoora saw the wave.",
  tap: "Zoora felt the tap.",
};

const ERRORS: Record<string, string> = {
  RATE_LIMIT: "That's enough for this hour. The bowl needs a rest.",
  COOLDOWN: "Give the water a moment before you do that again.",
  EMPTY: "Write a few words first.",
  NOTE_REJECTED: "That note can't be kept.",
  NOTE_TOO_LONG: "That note is too long.",
  UNKNOWN_GIFT: "That gift isn't on the shelf.",
  CRISIS: CRISIS_REPLY,
};

export default async function GuestbookPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const query = await searchParams;
  const engine = getEngine();
  const snap = engine.snapshot();
  const entries = engine.db.prepare(
    "SELECT author, body, reply, created_at FROM messages WHERE channel = 'visitor' AND status != 'dropped' ORDER BY created_at DESC LIMIT 12",
  ).all() as { author: string; body: string; reply: string | null; created_at: number }[];
  const sent = query.sent ? SENT[query.sent] : null;
  const error = query.error ? (ERRORS[query.error] ?? "That didn't land. Try a shorter note.") : null;
  return (
    <div className="grid">
      <section className="card">
        <p className="kicker">Gifts</p>
        <h1>Leave something in the bowl</h1>
        <p className="muted">Notes are untrusted, length-limited, and never able to spend money.</p>
        {sent ? <p role="status">{sent}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
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
        <ul className="feed">
          {entries.length === 0 ? <li className="muted">No notes yet.</li> : null}
          {entries.map((entry) => (
            <li key={`${entry.created_at}-${entry.author}`}>
              <strong>{entry.author}</strong>
              <span> — {entry.body}</span>
              {entry.reply ? <p>{entry.reply} {AI_NOTICE}</p> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}