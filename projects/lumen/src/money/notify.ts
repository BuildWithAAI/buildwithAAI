import { randomBytes } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import type { DatabaseSync } from "node:sqlite";

export type OwnerAlert = {
  kind: "reconciliation" | "dispute" | "delivery" | "issuer";
  title: string;
  detail: string;
};

export interface OwnerNotifier {
  notify(alert: OwnerAlert): void;
}

export type MailMessage = { to: string; from: string; subject: string; text: string };
export type MailTransport = (message: MailMessage) => void;
export type TelegramMessage = { token: string; chatId: string; text: string };
export type TelegramTransport = (message: TelegramMessage) => void;

export type AlertEnv = Record<string, string | undefined>;

/** Desk copy of every alert. External channels are separate. */
export function deskNotifier(db: DatabaseSync): OwnerNotifier {
  return {
    notify(alert) {
      db.prepare("INSERT INTO owner_alerts(id, kind, title, detail, created_at) VALUES(?, ?, ?, ?, ?)").run(
        randomBytes(8).toString("hex"),
        alert.kind,
        alert.title,
        alert.detail.slice(0, 500),
        Date.now(),
      );
    },
  };
}

/** Desk clocks show America/Chicago next to the UTC instant. */
export function deskClock(ms: number): string {
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
  return `${local} Chicago · ${new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z")}`;
}

export function listAlerts(db: DatabaseSync): { id: string; kind: string; title: string; detail: string; created_at: number }[] {
  return db.prepare("SELECT id, kind, title, detail, created_at FROM owner_alerts ORDER BY created_at DESC LIMIT 20").all() as {
    id: string;
    kind: string;
    title: string;
    detail: string;
    created_at: number;
  }[];
}

export function emailConfigured(env: AlertEnv): boolean {
  return Boolean(env.LUMEN_ALERT_EMAIL_TO && env.LUMEN_ALERT_EMAIL_FROM && env.LUMEN_SMTP_HOST);
}

export function telegramConfigured(env: AlertEnv): boolean {
  return Boolean(env.LUMEN_ALERT_TELEGRAM_BOT_TOKEN && env.LUMEN_ALERT_TELEGRAM_CHAT_ID);
}

export function emailNotifier(env: AlertEnv, send: MailTransport): OwnerNotifier {
  const to = env.LUMEN_ALERT_EMAIL_TO ?? "";
  const from = env.LUMEN_ALERT_EMAIL_FROM ?? "";
  return {
    notify(alert) {
      send({ to, from, subject: `Zoora: ${alert.title}`, text: alert.detail });
    },
  };
}

export function telegramNotifier(env: AlertEnv, send: TelegramTransport): OwnerNotifier {
  const token = env.LUMEN_ALERT_TELEGRAM_BOT_TOKEN ?? "";
  const chatId = env.LUMEN_ALERT_TELEGRAM_CHAT_ID ?? "";
  return {
    notify(alert) {
      send({ token, chatId, text: `${alert.title}\n${alert.detail}` });
    },
  };
}

/** Default Telegram transport. Tests pass their own and never call this. */
export function telegramApiTransport(fetchImpl: typeof fetch = fetch, onError?: (error: unknown) => void): TelegramTransport {
  return ({ token, chatId, text }) => {
    void fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    }).then((response) => {
      if (!response.ok) throw new Error("TELEGRAM_ALERT_FAILED");
    }).catch((error) => {
      onError?.(error);
    });
  };
}

export function fanout(notifiers: OwnerNotifier[], onError?: (error: unknown) => void): OwnerNotifier {
  return {
    notify(alert) {
      for (const notifier of notifiers) {
        try {
          notifier.notify(alert);
        } catch (error) {
          onError?.(error);
        }
      }
    },
  };
}

export type AlertChannel = "email" | "telegram";

/** About half a minute, then doubling, capped so the whole window stays near 30 minutes. */
export function retryDelayMs(attempt: number): number {
  return Math.min(15 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

export const ALERT_GIVE_UP_MS = 30 * 60 * 1000;

type RetryRow = { id: string; kind: string; title: string; detail: string; attempt: number; next_at: number; channel: string; started_at: number };

function giveUpDetail(alert: OwnerAlert, channel: string): string {
  return `${channel}: ${alert.title}: ${alert.detail}`.slice(0, 500);
}

function noteGiveUp(db: DatabaseSync, alert: OwnerAlert, channel: string): void {
  const detail = giveUpDetail(alert, channel);
  const existing = db.prepare("SELECT id FROM owner_alerts WHERE kind = 'delivery' AND title = 'Alert delivery gave up' AND detail = ?").get(detail);
  if (existing) return;
  deskNotifier(db).notify({ kind: "delivery", title: "Alert delivery gave up", detail });
}

export function scheduleAlertRetry(db: DatabaseSync, alert: OwnerAlert, channel: AlertChannel, now = Date.now(), priorAttempt = 0, startedAt = now, giveUpMs = ALERT_GIVE_UP_MS): "scheduled" | "gave_up" {
  const detail = alert.detail.slice(0, 500);
  const existing = db.prepare("SELECT id, attempt, started_at FROM alert_retries WHERE channel = ? AND kind = ? AND title = ? AND detail = ?").get(channel, alert.kind, alert.title, detail) as { id: string; attempt: number; started_at: number } | undefined;
  const began = existing?.started_at || startedAt || now;
  if (now - began >= giveUpMs) {
    if (existing) db.prepare("DELETE FROM alert_retries WHERE id = ?").run(existing.id);
    noteGiveUp(db, alert, channel);
    return "gave_up";
  }
  const attempt = existing ? Math.max(existing.attempt, priorAttempt) + 1 : (priorAttempt > 0 ? priorAttempt + 1 : 1);
  const nextAt = now + retryDelayMs(attempt);
  if (existing) db.prepare("UPDATE alert_retries SET attempt = ?, next_at = ?, started_at = ? WHERE id = ?").run(attempt, nextAt, began, existing.id);
  else db.prepare("INSERT INTO alert_retries(id, kind, title, detail, attempt, next_at, channel, started_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)").run(randomBytes(8).toString("hex"), alert.kind, alert.title, detail, attempt, nextAt, channel, began);
  return "scheduled";
}

/** The desk hears that delivery failed. The retry row keeps the original alert. */
export function reportDeliveryFailure(db: DatabaseSync, error: unknown, now = Date.now(), original?: OwnerAlert, channel: AlertChannel = "email"): void {
  const alert = original ?? { kind: "delivery" as const, title: "Alert delivery failed", detail: error instanceof Error ? error.message : "Alert delivery failed." };
  const notice = `Could not deliver "${alert.title}". ${error instanceof Error ? error.message : "Alert delivery failed."}`.slice(0, 500);
  const already = db.prepare("SELECT id FROM owner_alerts WHERE kind = 'delivery' AND title = 'Alert delivery failed' AND detail = ?").get(notice);
  if (!already) deskNotifier(db).notify({ kind: "delivery", title: "Alert delivery failed", detail: notice });
  const row = db.prepare("SELECT id FROM alert_retries WHERE channel = ? AND kind = ? AND title = ? AND detail = ?").get(channel, alert.kind, alert.title, alert.detail.slice(0, 500));
  if (!row) scheduleAlertRetry(db, alert, channel, now);
}

/** Re-send each channel's copy of the original alert. A throw backs off. Each channel, and each later alert, gets its own give-up notice. */
export function drainAlertRetries(db: DatabaseSync, deliver: (alert: OwnerAlert, channel: AlertChannel, attempt: number, startedAt: number) => void, now = Date.now(), giveUpMs = ALERT_GIVE_UP_MS): { sent: number; gaveUp: number } {
  const due = db.prepare("SELECT id, kind, title, detail, attempt, next_at, channel, started_at FROM alert_retries WHERE next_at <= ? ORDER BY next_at ASC").all(now) as RetryRow[];
  let sent = 0;
  let gaveUp = 0;
  for (const row of due) {
    const alert: OwnerAlert = { kind: row.kind as OwnerAlert["kind"], title: row.title, detail: row.detail };
    const channel: AlertChannel = row.channel === "telegram" ? "telegram" : "email";
    const began = row.started_at || now;
    if (now - began >= giveUpMs) {
      db.prepare("DELETE FROM alert_retries WHERE id = ?").run(row.id);
      noteGiveUp(db, alert, channel);
      gaveUp += 1;
      continue;
    }
    try {
      deliver(alert, channel, row.attempt, began);
      db.prepare("DELETE FROM alert_retries WHERE id = ?").run(row.id);
      sent += 1;
    } catch {
      if (scheduleAlertRetry(db, alert, channel, now, row.attempt, began, giveUpMs) === "gave_up") gaveUp += 1;
    }
  }
  return { sent, gaveUp };
}

export function deliverDueAlerts(db: DatabaseSync, env: AlertEnv, now = Date.now()): { sent: number; gaveUp: number } {
  return drainAlertRetries(db, (alert, channel, attempt, startedAt) => {
    const again = () => { scheduleAlertRetry(db, alert, channel, Date.now(), attempt, startedAt); };
    if (channel === "email") {
      if (!emailConfigured(env)) throw new Error("EMAIL_NOT_CONFIGURED");
      void deliverSmtp(env, { to: env.LUMEN_ALERT_EMAIL_TO ?? "", from: env.LUMEN_ALERT_EMAIL_FROM ?? "", subject: `Zoora: ${alert.title}`, text: alert.detail }).catch(again);
      return;
    }
    if (!telegramConfigured(env)) throw new Error("TELEGRAM_NOT_CONFIGURED");
    telegramApiTransport(fetch, again)({ token: env.LUMEN_ALERT_TELEGRAM_BOT_TOKEN ?? "", chatId: env.LUMEN_ALERT_TELEGRAM_CHAT_ID ?? "", text: `${alert.title}\n${alert.detail}` });
  }, now);
}

export function buildOwnerNotifier(env: AlertEnv, io: { desk?: OwnerNotifier; db?: DatabaseSync; sendMail?: MailTransport; sendTelegram?: TelegramTransport } = {}): { notifier: OwnerNotifier; externalConfigured: boolean; channels: string[] } {
  const channels: string[] = [];
  const notifiers: OwnerNotifier[] = [];
  if (io.desk) {
    notifiers.push(io.desk);
    channels.push("desk");
  }
  if (emailConfigured(env)) {
    const to = env.LUMEN_ALERT_EMAIL_TO ?? "";
    const from = env.LUMEN_ALERT_EMAIL_FROM ?? "";
    notifiers.push({
      notify(alert) {
        const message = { to, from, subject: `Zoora: ${alert.title}`, text: alert.detail };
        const fail = (error: unknown) => { if (io.db) reportDeliveryFailure(io.db, error, Date.now(), alert, "email"); };
        try {
          if (io.sendMail) io.sendMail(message);
          else void deliverSmtp(env, message).catch(fail);
        } catch (error) {
          fail(error);
        }
      },
    });
    channels.push("email");
  }
  if (telegramConfigured(env)) {
    notifiers.push({
      notify(alert) {
        const fail = (error: unknown) => { if (io.db) reportDeliveryFailure(io.db, error, Date.now(), alert, "telegram"); };
        const send = io.sendTelegram ?? telegramApiTransport(fetch, fail);
        try {
          send({ token: env.LUMEN_ALERT_TELEGRAM_BOT_TOKEN ?? "", chatId: env.LUMEN_ALERT_TELEGRAM_CHAT_ID ?? "", text: `${alert.title}\n${alert.detail}` });
        } catch (error) {
          fail(error);
        }
      },
    });
    channels.push("telegram");
  }
  return {
    notifier: fanout(notifiers),
    externalConfigured: channels.includes("email") || channels.includes("telegram"),
    channels,
  };
}

/** AUTH is allowed only after implicit TLS (465) or a completed STARTTLS (587). */
export function smtpAuthAllowed(encrypted: boolean): boolean {
  return encrypted;
}

/** Port 465 is implicit TLS. Port 587 must STARTTLS before any AUTH. Other ports are refused. */
export function deliverSmtp(env: AlertEnv, message: MailMessage): Promise<void> {
  const host = env.LUMEN_SMTP_HOST ?? "";
  const port = Number(env.LUMEN_SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port <= 0) return Promise.reject(new Error("SMTP_PORT_REFUSED"));
  if (port === 465) {
    return smtpDialogue(tls.connect({ host, port, servername: host }), env, message, true);
  }
  return new Promise((resolve, reject) => {
    const plain = net.connect({ host, port });
    smtpDialogue(plain, env, message, false).then(resolve, reject);
  });
}

function smtpDialogue(socket: net.Socket, env: AlertEnv, message: MailMessage, encrypted: boolean, speakFirst = false): Promise<void> {
  const user = env.LUMEN_SMTP_USER ?? "";
  const password = env.LUMEN_SMTP_PASSWORD ?? "";
  const commands = ["EHLO zoora"];
  if (!encrypted) commands.push("STARTTLS");
  else if (user) commands.push("AUTH LOGIN", Buffer.from(user).toString("base64"), Buffer.from(password).toString("base64"));
  if (encrypted) commands.push(`MAIL FROM:<${message.from}>`, `RCPT TO:<${message.to}>`, "DATA", "BODY", "QUIT");
  return new Promise((resolve, reject) => {
    let buffer = "";
    let index = 0;
    let sentStartTls = false;
    const fail = (error: Error) => { socket.destroy(); reject(error); };
    const sendNext = () => {
      const command = commands[index];
      index += 1;
      if (!command || command === "QUIT") { socket.end("QUIT\r\n"); resolve(); return; }
      if (command === "BODY") {
        socket.write(`From: ${message.from}\r\nTo: ${message.to}\r\nSubject: ${message.subject}\r\n\r\n${message.text.replace(/^\./gm, "..")}\r\n.\r\n`);
        return;
      }
      if (command === "STARTTLS") sentStartTls = true;
      socket.write(`${command}\r\n`);
    };
    socket.setTimeout(10_000, () => fail(new Error("SMTP_TIMEOUT")));
    socket.on("error", fail);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (!buffer.endsWith("\n")) return;
      const last = buffer.trim().split(/\r?\n/).pop() ?? "";
      buffer = "";
      if (sentStartTls) {
        sentStartTls = false;
        if (!last.startsWith("220")) { fail(new Error("SMTP_TLS_REQUIRED")); return; }
        const secure = tls.connect({ socket, servername: env.LUMEN_SMTP_HOST });
        secure.once("secureConnect", () => { smtpDialogue(secure, env, message, true, true).then(resolve, reject); });
        secure.on("error", fail);
        return;
      }
      if (!/^[23]/.test(last)) { fail(new Error("SMTP_REJECTED")); return; }
      sendNext();
    });
    if (speakFirst) sendNext();
  });
}
