import { EmailMessage } from "cloudflare:email";
import type { Env } from "./env.ts";

/**
 * Email Julius (ALERT_EMAIL, a verified Email Routing address kept in
 * Cloudflare settings). Never throws: an alert must not break a report.
 */
export async function sendAlert(env: Env, subject: string, body: string): Promise<void> {
  if (!env.ALERTS || !env.ALERT_EMAIL) {
    console.log(`[alert] ${subject}`);
    return;
  }
  const domain = env.ALERT_FROM.split("@")[1] ?? "zaisma.com";
  const mime = [
    `From: Zaisma <${env.ALERT_FROM}>`,
    `To: ${env.ALERT_EMAIL}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
  try {
    await env.ALERTS.send(new EmailMessage(env.ALERT_FROM, env.ALERT_EMAIL, mime));
  } catch (err) {
    console.error("alert email failed", err);
  }
}

function encodeHeader(text: string): string {
  const clean = text.replace(/[\r\n]+/g, " ");
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(clean)));
  return `=?UTF-8?B?${b64}?=`;
}
