# 0012 — Customer photos and model choice

Status: accepted (A2b)

## Context

Customers often send a photo or screenshot of what they want (from Instagram, Pinterest or another shop), or a screenshot of a bank transfer. The assistant must find the closest products and must never treat a screenshot as proof of payment (rule 10). Every AI call costs money (rule 12), and the history is rebuilt every turn (0011), so sending photos again on every turn would be wasteful.

## Decision

- **Describe once, then search.** When a turn has new customer photos (up to 3), the cheapest model (`claude-haiku-5-5`, low effort, structured output) looks at each one and returns: kind (`product`, `payment_proof`, `other`), a short description, text written on the photo and catalog search words. Core cleans this and saves it on the message (`payload.photo`, no schema change). The reply model only ever reads that text; it searches the catalog with the words and offers the closest one or two products. A photo that cannot be loaded or read stays "a photo you could not see".
- **No image embeddings for now.** Embeddings would need a vector index and photos of every product, and would not handle "this but in red". Describing and searching is cheap, explainable and works with catalogs that have few photos. Revisit if matching quality is poor with real sellers.
- **Search ranks by matching words.** `searchProducts` gives two points per word found in a product name and one in the description, category or an option's colour, with simple plural handling and filler words removed.
- **Payment screenshots are flagged as "not proof"**; the assistant checks the payment with the tools. Prices written on someone else's photo are not ours: the price guard blocks a reply that repeats them.
- **Photos are stored by the channel.** `InboundMessage.media.image` is our stored copy (the test chat uploads through `/api/uploads`; WhatsApp in A3 downloads the media before queuing). Core only keeps an image whose path belongs to the business.
- **Model choice.** Photos: Haiku (simple vision work, about a fortieth of the reply model's price per token). Replies: Opus 5.5 at low effort until measured. `pnpm --filter @fulcra/agent measure` runs the same customer conversations on each model (`MEASURE_MODELS`) with the real API and prints correct behaviour, cost and time per reply. `AGENT_MODEL` / `AGENT_PHOTO_MODEL` switch models without a code change. Server-side fallback is only sent to models that accept it (Haiku rejects it).

## Consequences

- The reply-model decision needs one measurement run with the owner's API key (a few US cents).
- A3 must download WhatsApp media and call `storeImage` in the worker before the agent runs.
- The assistant cannot yet send product photos back; that can come with WhatsApp image messages in A3.
