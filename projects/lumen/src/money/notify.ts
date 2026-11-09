import { randomBytes } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import type { DatabaseSync } from "node:sqlite";

export type OwnerAlert = {
  kind: "reconciliation" | "dispute";
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
      send({ to, from, subject: `Lumen: ${alert.title}`, text: alert.detail });
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
export function telegramApiTransport(fetchImpl: typeof fetch = fetch): TelegramTransport {
  return ({ token, chatId, text }) => {
    void fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  };
}

export function fanout(notifiers: OwnerNotifier[]): OwnerNotifier {
  return {
    notify(alert) {
      for (const notifier of notifiers) {
        try {
          notifier.notify(alert);
        } catch {
          /* one channel failing must not drop the others */
        }
      }
    },
  };
}

export function buildOwnerNotifier(env: AlertEnv, io: { desk?: OwnerNotifier; sendMail?: MailTransport; sendTelegram?: TelegramTransport } = {}): { notifier: OwnerNotifier; externalConfigured: boolean; channels: string[] } {
  const channels: string[] = [];
  const notifiers: OwnerNotifier[] = [];
  if (io.desk) {
    notifiers.push(io.desk);
    channels.push("desk");
  }
  if (emailConfigured(env)) {
    notifiers.push(emailNotifier(env, io.sendMail ?? ((message) => { void deliverSmtp(env, message); })));
    channels.push("email");
  }
  if (telegramConfigured(env)) {
    notifiers.push(telegramNotifier(env, io.sendTelegram ?? telegramApiTransport()));
    channels.push("telegram");
  }
  return { notifier: fanout(notifiers), externalConfigured: channels.includes("email") || channels.includes("telegram"), channels };
}

/** Minimal SMTP submission. Port 465 uses TLS. Other ports speak plain SMTP, which is enough for a local relay. */
export function deliverSmtp(env: AlertEnv, message: MailMessage): Promise<void> {
  const host = env.LUMEN_SMTP_HOST ?? "";
  const port = Number(env.LUMEN_SMTP_PORT ?? 587);
  const user = env.LUMEN_SMTP_USER ?? "";
  const password = env.LUMEN_SMTP_PASSWORD ?? "";
  const commands = ["EHLO lumen"];
  if (user) commands.push("AUTH LOGIN", Buffer.from(user).toString("base64"), Buffer.from(password).toString("base64"));
  commands.push(`MAIL FROM:<${message.from}>`, `RCPT TO:<${message.to}>`, "DATA", "BODY", "QUIT");
  return new Promise((resolve, reject) => {
    const socket = port === 465 ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buffer = "";
    let index = 0;
    const fail = (error: Error) => { socket.destroy(); reject(error); };
    const sendNext = () => {
      const command = commands[index];
      index += 1;
      if (command === "BODY") {
        const text = `From: ${message.from}\r\nTo: ${message.to}\r\nSubject: ${message.subject}\r\n\r\n${message.text.replace(/^\./gm, "..")}\r\n.\r\n`;
        socket.write(text);
        return;
      }
      if (command === "QUIT") { socket.end("QUIT\r\n"); resolve(); return; }
      socket.write(`${command}\r\n`);
    };
    socket.setTimeout(10_000, () => fail(new Error("SMTP_TIMEOUT")));
    socket.on("error", fail);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (!buffer.endsWith("\n")) return;
      const lines = buffer.trim().split(/\r?\n/);
      buffer = "";
      const last = lines[lines.length - 1] ?? "";
      if (!/^[23]/.test(last)) { fail(new Error("SMTP_REJECTED")); return; }
      sendNext();
    });
  });
}
