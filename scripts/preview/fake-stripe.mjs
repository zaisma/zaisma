// A stand-in for Stripe's API and Stripe Connect sign-in, for local previews only, so the buy sheet runs with no
// outside call and no real card. It answers the few paths Zaisma calls (apps/site/src/stripe.ts) as Stripe does,
// with the fields Zaisma reads: /v1/... for the API and /oauth/... for Connect, both on one port (stripe.ts's
// stripeOrigins points both at STRIPE_API_ORIGIN while the site is on localhost). Objects live in memory by ID,
// so a restart forgets them (a pending sale's payment then answers resource_missing, as an expired one would).
// The preview's "Test card" button stands in for Stripe's card form, so a setup is already done when it's made.
// A payment_method that starts with pm_preview_declined is refused as a declined card, to try the failure.
// A payment without confirm waits (the wallet path); POST /v1/payment_intents/:id/confirm, which Stripe's own
// page calls from the browser, pays it, for the preview's wallet stand-in.
import { randomBytes } from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";

/** Stripe's form encoding read back: key[sub][0]=value as nested objects (a list is an object of its indexes). */
function parseForm(text) {
  const form = {};
  for (const [key, value] of new URLSearchParams(text)) {
    const names = (key.match(/^[^[]+|\[[^\]]*\]/g) ?? [key]).map((name) => name.replace(/^\[|\]$/g, ""));
    let into = form;
    names.forEach((name, i) => {
      const at = name === "" ? String(Object.keys(into).length) : name;
      if (i === names.length - 1) into[at] = value;
      else into = into[at] && typeof into[at] === "object" ? into[at] : (into[at] = {});
    });
  }
  return form;
}

/** A list in a parsed form (expand[0]=x), as an array. */
const listOf = (value) => (value === undefined ? [] : typeof value === "object" ? Object.values(value) : [value]);

export function startFakeStripe(port) {
  const newId = (prefix) => `${prefix}_preview_${randomBytes(6).toString("hex")}`;
  const now = () => Math.floor(Date.now() / 1000);
  const startedAtSec = now();
  const objects = new Map();
  // The first answer to a call with an Idempotency-Key, given again to the same key on the same path.
  const answered = new Map();
  const accounts = new Map();

  const keep = (object) => {
    objects.set(object.id, object);
    return object;
  };
  const cardMethod = (customer, from, idPrefix = "pm") => keep({ id: newId(idPrefix), object: "payment_method", type: "card", customer: customer ?? null, created: now(), card: { brand: from?.card.brand ?? "visa", last4: from?.card.last4 ?? "4242", exp_month: 12, exp_year: new Date().getFullYear() + 3, funding: "credit", country: "US" } });
  const accountFor = (id) => {
    if (!accounts.has(id)) accounts.set(id, { id, object: "account", type: "standard", charges_enabled: true, payouts_enabled: true, details_submitted: true, country: "US", default_currency: "usd", email: "owner@preview-studio.example", business_profile: { name: "Preview Studio", support_email: "support@preview-studio.example" }, settings: { dashboard: { display_name: "Preview Studio" } } });
    return accounts.get(id);
  };
  const missing = (kind, id) => ({ status: 404, body: { error: { type: "invalid_request_error", code: "resource_missing", param: kind, message: `No such ${kind}: '${id}'` } } });
  const declined = () => ({ status: 402, body: { error: { type: "card_error", code: "card_declined", decline_code: "generic_decline", message: "Your card was declined." } } });

  /** The PaymentIntent as Stripe answers it: latest_charge an ID, or the charge itself when asked to expand it. */
  const intentJson = (intent, expand) => {
    const charge = intent.charge_id ? { id: intent.charge_id, object: "charge", amount: intent.amount, currency: intent.currency, paid: true, status: "succeeded", payment_intent: intent.id, billing_details: { email: intent.billing_email ?? null, name: null } } : null;
    const { charge_id: _, billing_email: __, ...shown } = intent;
    return { ...shown, latest_charge: charge ? (expand.includes("latest_charge") ? charge : charge.id) : null };
  };
  const pay = (intent, paymentMethod, billingEmail) => {
    intent.status = "succeeded";
    intent.payment_method = paymentMethod;
    intent.charge_id = newId("ch");
    intent.billing_email = billingEmail;
    return intent;
  };

  /** One API call: answers { status, body }, or { redirect } for the Connect sign-in's page. */
  function route(method, path, form, query, headers) {
    // /v1/<kind>/<id>/<action>, where tax and checkout kinds have two words (tax/calculations).
    const [root, first, ...rest] = path.split("/").slice(1);
    const kind = first === "tax" || first === "checkout" ? `${first}/${rest.shift()}` : first;
    const [id, action] = rest;
    const found = () => objects.get(id) ?? null;

    if (root === "oauth") {
      if (kind === "authorize" && method === "GET") {
        const target = new URL(query.get("redirect_uri") ?? "");
        target.searchParams.set("code", "ac_preview");
        if (query.get("state")) target.searchParams.set("state", query.get("state"));
        return { redirect: target.toString() };
      }
      if (kind === "token" && method === "POST") {
        const stripeUserId = newId("acct");
        accountFor(stripeUserId);
        return { status: 200, body: { access_token: "sk_test_preview_connected", livemode: false, refresh_token: "rt_preview", token_type: "bearer", stripe_publishable_key: "pk_test_preview", stripe_user_id: stripeUserId, scope: "read_write" } };
      }
      if (kind === "deauthorize" && method === "POST") return { status: 200, body: { stripe_user_id: form.stripe_user_id ?? null } };
      return { status: 404, body: { error: "invalid_request", error_description: `There is no ${method} ${path} on this stand-in.` } };
    }

    if (kind === "customers" && !id && method === "POST") return { status: 200, body: keep({ id: newId("cus"), object: "customer", created: now(), metadata: form.metadata ?? {} }) };

    if (kind === "checkout/sessions" && !id && method === "POST") {
      // Like Stripe: Managed Payments refuses these Checkout options.
      const refused = ["custom_text", "automatic_tax", "tax_id_collection", "payment_method_collection", "payment_method_configuration", "payment_method_options", "payment_method_types", "saved_payment_method_options", "shipping_address_collection", "shipping_options"].find((name) => form[name] !== undefined);
      if (form.managed_payments?.enabled === "true" && refused) return { status: 400, body: { error: { type: "invalid_request_error", param: refused, message: `You cannot use ${refused} with Managed Payments.` } } };
      return { status: 200, body: keep({ id: newId("cs"), object: "checkout.session", mode: form.mode ?? "payment", url: form.success_url ?? "", success_url: form.success_url ?? "", expires_at: now() + 86_400, created: now(), metadata: form.metadata ?? {} }) };
    }

    if (kind === "subscriptions" && id && !action && method === "POST") {
      const subscription = objects.get(id) ?? keep({ id, object: "subscription", status: "active", cancel_at_period_end: false, created: now() });
      if (form.cancel_at_period_end !== undefined) subscription.cancel_at_period_end = form.cancel_at_period_end === "true";
      return { status: 200, body: subscription };
    }

    if (kind === "subscriptions" && id && !action && method === "DELETE") {
      const subscription = objects.get(id) ?? keep({ id, object: "subscription", created: now() });
      subscription.status = "canceled";
      return { status: 200, body: subscription };
    }
    // Zaisma Pro's invoices: the preview's Pro (sub_preview_pro) was paid once, 3 days before the stand-in started.
    if (kind === "invoices" && !id && method === "GET") {
      const paidAtSec = startedAtSec - 3 * 86_400;
      return { status: 200, body: { object: "list", data: [{ id: "in_preview_pro", object: "invoice", status: "paid", amount_paid: 1000, currency: "usd", customer: query.get("customer"), status_transitions: { paid_at: paidAtSec }, parent: { type: "subscription_details", subscription_details: { subscription: "sub_preview_pro" } }, payments: { object: "list", data: [{ object: "invoice_payment", status: "paid", payment: { type: "payment_intent", payment_intent: "pi_preview_pro" } }] } }] } };
    }

    if (kind === "refunds" && !id && method === "POST") {
      const intent = objects.get(form.payment_intent);
      return { status: 200, body: keep({ id: newId("re"), object: "refund", status: "succeeded", amount: Number(form.amount ?? intent?.amount ?? 0), currency: intent?.currency ?? "usd", payment_intent: form.payment_intent ?? null, charge: intent?.charge_id ?? null, created: now() }) };
    }

    // A connected account's money: the account's ID says which story the preview tells (manual payouts have no next payout, euro holds a second currency).
    if (kind === "balance" && !id && method === "GET") {
      const accountId = headers["stripe-account"] ?? "";
      return { status: 200, body: { object: "balance", available: [{ amount: 31240, currency: "usd" }, ...(accountId.includes("euro") ? [{ amount: 8000, currency: "eur" }] : [])], pending: [{ amount: 4800, currency: "usd" }] } };
    }
    if (kind === "payouts" && !id && method === "GET") {
      const accountId = headers["stripe-account"] ?? "";
      return { status: 200, body: { object: "list", data: accountId.includes("manual") ? [] : [{ id: newId("po"), object: "payout", status: "in_transit", amount: 31240, currency: "usd", arrival_date: now() + 3 * 86400 }] } };
    }
    if (kind === "accounts" && id && !action && method === "GET") return { status: 200, body: accountFor(id) };
    if (kind === "payment_method_domains" && !id && method === "POST") return { status: 200, body: keep({ id: newId("pmd"), object: "payment_method_domain", domain_name: form.domain_name ?? "", enabled: true, created: now() }) };

    if (kind === "setup_intents") {
      if (!id && method === "POST") {
        const card = cardMethod(form.customer);
        return { status: 200, body: keep({ id: newId("seti"), object: "setup_intent", status: "succeeded", customer: form.customer ?? null, usage: form.usage ?? "off_session", payment_method: card.id, client_secret: null, metadata: form.metadata ?? {}, created: now() }) };
      }
      if (id && !action && method === "GET") {
        const intent = found();
        if (!intent) return missing("setup_intent", id);
        return { status: 200, body: { ...intent, payment_method: listOf(form.expand).includes("payment_method") ? objects.get(intent.payment_method) : intent.payment_method } };
      }
    }

    if (kind === "payment_methods") {
      if (!id && method === "POST") {
        // A clone of the player's saved card (a saved pm_… from the seed isn't in memory) is a new method on the connected account.
        const isDeclined = String(form.payment_method).startsWith("pm_preview_declined");
        return { status: 200, body: cardMethod(null, objects.get(form.payment_method), isDeclined ? "pm_preview_declined" : "pm") };
      }
      if (id && action === "detach" && method === "POST") return { status: 200, body: { ...(objects.get(id) ?? { id, object: "payment_method" }), customer: null } };
    }

    if (kind === "payment_intents") {
      if (!id && method === "POST") {
        const intent = keep({ id: newId("pi"), object: "payment_intent", status: "requires_payment_method", amount: Number(form.amount), currency: String(form.currency ?? "usd").toLowerCase(), description: form.description ?? null, metadata: form.metadata ?? {}, customer: form.customer ?? null, payment_method: null, last_payment_error: null, client_secret: null, created: now() });
        intent.client_secret = `${intent.id}_secret_${randomBytes(8).toString("hex")}`;
        if (form.confirm === "true") {
          if (String(form.payment_method ?? "").startsWith("pm_preview_declined")) return declined();
          pay(intent, form.payment_method ?? null, null);
        }
        return { status: 200, body: intentJson(intent, []) };
      }
      if (id && !action && method === "GET") return objects.has(id) ? { status: 200, body: intentJson(objects.get(id), listOf(form.expand)) } : missing("payment_intent", id);
      if (id && action === "cancel" && method === "POST") {
        const intent = found();
        if (!intent) return missing("payment_intent", id);
        if (intent.status === "succeeded") return { status: 400, body: { error: { type: "invalid_request_error", code: "payment_intent_unexpected_state", message: "You cannot cancel this PaymentIntent because it has a status of succeeded." } } };
        intent.status = "canceled";
        return { status: 200, body: intentJson(intent, []) };
      }
      if (id && action === "confirm" && method === "POST") {
        const intent = found();
        if (!intent) return missing("payment_intent", id);
        if (intent.status === "requires_payment_method") pay(intent, form.payment_method ?? cardMethod(null).id, "wallet-player@example.test");
        return { status: 200, body: intentJson(intent, []) };
      }
    }

    if (kind === "tax/calculations" && !id && method === "POST") {
      const lines = Object.values(form.line_items ?? {});
      const amountTotal = lines.reduce((sum, line) => sum + Number(line.amount ?? 0), 0);
      return { status: 200, body: keep({ id: newId("taxcalc"), object: "tax.calculation", currency: form.currency ?? "usd", amount_total: amountTotal, tax_amount_inclusive: 0, tax_amount_exclusive: 0, expires_at: now() + 86_400 }) };
    }
    if (kind === "tax/transactions" && id === "create_from_calculation" && method === "POST") {
      return { status: 200, body: keep({ id: newId("tax_txn"), object: "tax.transaction", type: "transaction", reference: form.reference ?? null, created: now() }) };
    }

    return { status: 404, body: { error: { type: "invalid_request_error", message: `Unrecognized request URL (${method}: ${path}). This stand-in answers only the calls Zaisma makes.` } } };
  }

  http
    .createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const url = new URL(req.url, "http://localhost");
        const body = Buffer.concat(chunks).toString();
        // A GET carries its fields in the query, as stripeForm writes them.
        const form = parseForm(req.method === "GET" ? url.search.slice(1) : body);
        const idempotencyKey = req.headers["idempotency-key"];
        const answerKey = idempotencyKey ? `${req.headers["stripe-account"] ?? ""} ${req.method} ${url.pathname} ${idempotencyKey}` : null;
        let result = answerKey ? answered.get(answerKey) : undefined;
        if (!result) {
          result = route(req.method, url.pathname.replace(/\/+$/, ""), form, url.searchParams, req.headers);
          if (answerKey) answered.set(answerKey, result);
        }
        if (result.redirect) {
          res.writeHead(302, { location: result.redirect });
          return res.end();
        }
        res.writeHead(result.status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.body));
      });
    })
    .listen(port, "127.0.0.1");
}

// Started inside run.mjs's process; or on its own: node fake-stripe.mjs <port> …
if (process.argv[1] === fileURLToPath(import.meta.url)) startFakeStripe(Number(process.argv[2]));
