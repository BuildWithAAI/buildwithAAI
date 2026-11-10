# Integrations

Zoora's install still lives in `projects/lumen` and still reads `LUMEN_` environment variables. These hooks are off until the owner sets them. They do not approve purchases, listings, or print jobs.

## Zoora system

The Zoora system is the owner's client. It is not Zoora the jellyfish. It gets two doors. The public site for the Zoora Economy is [zoora.ai](https://zoora.ai).

Older names stay in the code so existing callers do not break:

| What you see | What the code still says |
| --- | --- |
| Zoora system | author `jarvis`, channel `jarvis`, `/api/jarvis/chat` |
| Zoora system token | `LUMEN_JARVIS_TOKEN` |
| Zoora system webhook | `LUMEN_JARVIS_WEBHOOK_URL`, `LUMEN_JARVIS_WEBHOOK_SECRET` |

Messages from the Zoora system are stored with author `jarvis`, not as the keeper and not as the jellyfish. That tag stays. A world token is still a different secret, issued on the keeper desk, and it only walks the island.

### Outbound events

When `LUMEN_JARVIS_WEBHOOK_URL` and `LUMEN_JARVIS_WEBHOOK_SECRET` are set, the jellyfish app POSTs JSON events to the Zoora system:

| `type` | When |
| --- | --- |
| `feed` | A public feed line |
| `mood` | A tick's feeling sentence |
| `want` | An open want |
| `wishlist` | A request that the keeper buy something |
| `alert` | A reconciliation or dispute alert |
| `sale` | A paid checkout webhook |
| `print` | A print job recorded locally |

The body is the raw JSON. Headers:

- `x-zoora-timestamp`: unix seconds
- `x-zoora-signature`: hex HMAC-SHA256 of `timestamp + "." + body` using `LUMEN_JARVIS_WEBHOOK_SECRET`

Reject timestamps older or newer than five minutes. Compare the signature in constant time.

### Owner chat

`POST /api/jarvis/chat` with `Authorization: Bearer <LUMEN_JARVIS_TOKEN>` and `{ "text": "..." }`.

`GET /api/jarvis/chat` returns the feeling sentence, public wants, and public feed lines. It does not return the private keeper conversation.

The route stays closed unless `LUMEN_JARVIS_TOKEN`, `LUMEN_JARVIS_WEBHOOK_URL`, and `LUMEN_JARVIS_WEBHOOK_SECRET` are all set. The Zoora system has its own rate limit, separate from the keeper desk. Its messages are stored with author `jarvis`, not as the keeper and not as the jellyfish. `LUMEN_JARVIS_TOKEN` is not the owner password, not `OWNER_ACCESS_TOKEN`, and not a world-agent token. A world token is issued on the keeper desk and only walks the island. Messages from the Zoora system are untrusted data. They cannot spend, and they cannot approve a wishlist, a purchase, a listing, or a print.

## Printed objects (parked)

3D printing is not the first business. There is no printer yet. The fulfillment interface and mock stay in the tree. Turning `LUMEN_FULFILLMENT` on does not place an order: the policy engine, caps, kill switch, and allowlist still have to pass, and this build does not send a physical job.
