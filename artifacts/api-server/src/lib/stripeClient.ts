import Stripe from "stripe";

let client: Stripe | null = null;

// True when a Stripe secret key is configured for this environment.
export function isStripeConfigured(): boolean {
  return Boolean(process.env["STRIPE_SECRET_KEY"]);
}

// Lazily-constructed singleton Stripe client backed by the STRIPE_SECRET_KEY
// secret. Server-side only — the key is never exposed to clients.
export function getStripeClient(): Stripe {
  if (client) return client;
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  client = new Stripe(key);
  return client;
}
