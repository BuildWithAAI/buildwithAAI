import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { handleStripeWebhook } from "../src/money/webhook";
import { readDeliveryToken } from "../src/shop/delivery";

const now = Date.UTC(2026, 10, 10, 22);
const secret = "whsec_ids";

function sign(payload: string): string {
  const seconds = Math.floor(now / 1000);
  const v1 = createHmac("sha256", secret).update(`${seconds}.${payload}`).digest("hex");
  return `t=${seconds},v1=${v1}`;
}

function post(db: ReturnType<typeof openDatabase>, id: string, type: string, object: Record<string, unknown>) {
  const payload = JSON.stringify({ id, type, livemode: true, data: { object } });
  return handleStripeWebhook(db, payload, sign(payload), secret, now);
}

function listing(db: ReturnType<typeof openDatabase>, id: string) {
  db.prepare("INSERT INTO shop(id, name, story, hue, form, x, z, open, created_at, updated_at) VALUES('shop-1', 'Stall', 'A stall', 1, 1, 0, 0, 1, ?, ?)").run(now, now);
  db.prepare(
    `INSERT INTO shop_listings(id, shop_id, kind, title, description, price_cents, status, scope, turnaround_hours, file_body, version, created_at, updated_at)
     VALUES(?, 'shop-1', 'writing', 'Lamp note', 'A note', 500, 'published', 'one file', 24, 'the file', 1, ?, ?)`,
  ).run(id, now, now);
}

describe("Stripe payment intent matching", () => {
  it("revokes an art download when the refund names a different charge id", () => {
    const db = openDatabase();
    db.prepare("INSERT INTO creations(id, title, svg, listed, price_cents, likes, favorites, created_at) VALUES('piece-r', 'Ring', '<svg></svg>', 1, 500, 0, 0, 1)").run();
    expect(post(db, "evt_cs", "checkout.session.completed", {
      id: "cs_art",
      object: "checkout.session",
      payment_status: "paid",
      amount_total: 500,
      payment_intent: "pi_art",
      metadata: { creation_id: "piece-r" },
    }).ok).toBe(true);
    const saved = db.prepare("SELECT token, charge_id, payment_intent_id FROM deliveries WHERE creation_id = 'piece-r'").get() as { token: string; charge_id: string | null; payment_intent_id: string | null };
    expect(saved.payment_intent_id).toBe("pi_art");
    expect(saved.charge_id).toBeNull();
    expect(readDeliveryToken(db, saved.token, now)).toEqual({ creationId: "piece-r" });
    expect(post(db, "evt_ch", "charge.refunded", {
      id: "ch_art",
      object: "charge",
      amount: 500,
      amount_refunded: 500,
      refunded: true,
      payment_intent: "pi_art",
      refunds: { object: "list", data: [{ id: "re_art", object: "refund", amount: 500, charge: "ch_art", payment_intent: "pi_art" }] },
    }).ok).toBe(true);
    expect(readDeliveryToken(db, saved.token, now)).toBeNull();
  });

  it("closes the shop order from a refund object and a dispute that carry the charge, not the payment intent", () => {
    const db = openDatabase();
    listing(db, "lamp");
    expect(post(db, "evt_shop", "checkout.session.completed", {
      id: "cs_shop",
      object: "checkout.session",
      payment_status: "paid",
      amount_total: 500,
      payment_intent: "pi_shop",
      metadata: { shop_listing: "lamp" },
    }).ok).toBe(true);
    const first = db.prepare("SELECT status, charge_id, payment_intent_id, delivery_token FROM shop_orders WHERE payment_intent_id = 'pi_shop'").get() as { status: string; charge_id: string | null; payment_intent_id: string; delivery_token: string };
    expect(first).toMatchObject({ status: "delivered", charge_id: null, payment_intent_id: "pi_shop" });
    expect(post(db, "evt_re", "refund.created", {
      id: "re_shop",
      object: "refund",
      amount: 500,
      charge: "ch_shop",
      payment_intent: "pi_shop",
      status: "succeeded",
    }).ok).toBe(true);
    expect((db.prepare("SELECT status FROM shop_orders WHERE payment_intent_id = 'pi_shop'").get() as { status: string }).status).toBe("refunded");
    expect(readDeliveryToken(db, first.delivery_token, now)).toBeNull();

    expect(post(db, "evt_shop2", "checkout.session.completed", {
      id: "cs_shop2",
      object: "checkout.session",
      payment_status: "paid",
      amount_total: 500,
      payment_intent: "pi_shop2",
      metadata: { shop_listing: "lamp" },
    }).ok).toBe(true);
    const second = db.prepare("SELECT delivery_token FROM shop_orders WHERE payment_intent_id = 'pi_shop2'").get() as { delivery_token: string };
    expect(post(db, "evt_dp", "charge.dispute.created", {
      id: "dp_shop2",
      object: "dispute",
      amount: 500,
      charge: "ch_shop2",
      payment_intent: "pi_shop2",
      reason: "fraudulent",
      status: "needs_response",
    }).ok).toBe(true);
    expect((db.prepare("SELECT status FROM shop_orders WHERE payment_intent_id = 'pi_shop2'").get() as { status: string }).status).toBe("disputed");
    expect(readDeliveryToken(db, second.delivery_token, now)).toBeNull();
    expect(readDeliveryToken(db, first.delivery_token, now)).toBeNull();
  });

  it("keeps a download after a partial refund unless the override is set", () => {
    const db = openDatabase();
    db.prepare("INSERT INTO creations(id, title, svg, listed, price_cents, likes, favorites, created_at) VALUES('piece-p', 'Part', '<svg></svg>', 1, 1000, 0, 0, 1)").run();
    expect(post(db, "evt_part_cs", "checkout.session.completed", {
      id: "cs_part",
      object: "checkout.session",
      payment_status: "paid",
      amount_total: 1000,
      payment_intent: "pi_part",
      metadata: { creation_id: "piece-p" },
    }).ok).toBe(true);
    const token = (db.prepare("SELECT token FROM deliveries WHERE payment_intent_id = 'pi_part'").get() as { token: string }).token;
    expect(post(db, "evt_part_ch", "charge.refunded", {
      id: "ch_part",
      object: "charge",
      amount: 1000,
      amount_refunded: 400,
      refunded: false,
      payment_intent: "pi_part",
      refunds: { object: "list", data: [{ id: "re_part", object: "refund", amount: 400, charge: "ch_part", payment_intent: "pi_part" }] },
    }).ok).toBe(true);
    expect(readDeliveryToken(db, token, now)).toEqual({ creationId: "piece-p" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'refund'").get()).toEqual({ n: 1 });
    process.env.LUMEN_REVOKE_ON_PARTIAL_REFUND = "true";
    try {
      expect(post(db, "evt_part_re", "refund.created", {
        id: "re_more",
        object: "refund",
        amount: 100,
        charge: "ch_part",
        payment_intent: "pi_part",
        status: "succeeded",
      }).ok).toBe(true);
    } finally {
      delete process.env.LUMEN_REVOKE_ON_PARTIAL_REFUND;
    }
    expect(readDeliveryToken(db, token, now)).toBeNull();
  });
});
