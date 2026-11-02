/**
 * Outgoing email (actions only — uses fetch).
 *
 * Delivery is configured with Convex deployment environment variables:
 *   RESEND_API_KEY   — Resend API key (https://resend.com); enables delivery.
 *   EMAIL_FROM       — sender, e.g. "Aster Academy <no-reply@school.example>".
 *   EMAIL_TRANSPORT  — optional. "console" (LOCAL DEVELOPMENT ONLY) writes the
 *                      message to the deployment's function logs instead of
 *                      sending it. Never set it on a production deployment:
 *                      anyone who can read the logs could read the codes.
 * Without either, sending fails with EMAIL_UNAVAILABLE and nothing is sent.
 */
import { AppError } from "../core/errors";

export type OutgoingEmail = { to: string; subject: string; text: string };

const RESEND_URL = "https://api.resend.com/emails";

export const emailUnavailable = (message = "Email delivery is not set up for this school yet. Ask your system operator to configure it.") =>
  new AppError("EMAIL_UNAVAILABLE", message);

/** A plausible single address (no display name, no list). */
export function isEmailAddress(value: string): boolean {
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value);
}

export async function sendEmail(message: OutgoingEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.EMAIL_TRANSPORT === "console") {
      console.log(`[email:console] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`);
      return;
    }
    throw emailUnavailable();
  }
  const from = process.env.EMAIL_FROM;
  if (!from) throw emailUnavailable();
  let res: Response;
  try {
    res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
    });
  } catch {
    throw emailUnavailable("We couldn't send the email. Please try again.");
  }
  // The response body is not logged: it may echo the message.
  if (!res.ok) throw emailUnavailable("We couldn't send the email. Please try again.");
}
