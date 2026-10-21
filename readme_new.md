 Smart Yield demo data

All records in this folder are synthetic demo data. Phone numbers and WhatsApp messages are placeholders; no messages are sent to real customers.

## Files and flow

1. `inventory.json` is the product catalogue: aliases used by message parsing, prices/cost, current demo stock, allergens, product weight, and illustrative emissions factor.
2. `customers.json` and `whatsapp_groups.json` describe opted-in demo recipients and the demo group membership. Send only to customers with WhatsApp consent in a real deployment.
3. `whatsapp_messages.json` contains raw sample messages, including order replies and edits. An agent should read message context and return structured intent, customer, item quantities, and clarification needs.
4. `order_queue.json` stores parsed orders. Keep uncertain orders in `needs_clarification`; negotiated prices need owner review; reserve stock only after customer confirmation. Fulfilled sample orders demonstrate the points flow.
5. `promotions.json` holds daily offer drafts and Manglish/English copy. Offers require owner approval before broadcast.
6. `recommendation_rules.json` and `recommendation_examples.json` define consent, allergen, budget, stock, and preference constraints for customer/product suggestions.
7. `loyalty_config.json`, `loyalty_accounts.json`, and `loyalty_ledger.json` define the points catalogue, balances, and auditable earn/redeem events.
8. `users.json` provides demo owner/staff roles for UI/RBAC demonstrations. A production API must enforce authorization server-side.

## Carbon and points calculation

For each fulfilled surplus item:

`avoided CO2e (kg) = quantity × product.weight_kg × product.co2e_per_kg`

Sum the item results for the order, then award:

`points = floor(order avoided CO2e kg × points_per_kg_co2e)`

The current demo uses 10 points per kg CO2e and the factor in `inventory.json`. For example, two croissants use `2 × 0.08 kg × 2.5 = 0.40 kg CO2e`, which earns 4 points after fulfilment. The factor is an illustrative assumption, not a measured lifecycle assessment. Points are a customer reward, not verified carbon credits. Do not award points for cancelled or uncollected orders, and ensure each order earns only once.

## Suggested agent output

Have the language model return JSON (not free-form prose) with fields such as `intent`, `customer_id`, `items`, `pickup_time`, `confidence`, and `needs_human_review`. Validate product IDs, quantities (`qty` must be a positive integer), stock, consent, price limits, and state transitions in backend code. The model can suggest a reply or promotion, but the backend and owner approval control reservation and sending.

## Demo limitations

This folder demonstrates data contracts only. WhatsApp ingestion/broadcast, identity verification, real customer consent, stock locking, model calls, and reward redemption need backend integrations and server-side validation. Carbon factors should be replaced with a documented, locally appropriate source before making public impact claims.
