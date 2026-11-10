# Integrations

Zoora's install still lives in `projects/lumen` and still reads `LUMEN_` environment variables. These hooks are off until the owner sets them. They do not approve purchases, listings, or print jobs.

## Jarvis

Jarvis is the owner's future client. It gets two doors.

### Outbound events

When `LUMEN_JARVIS_WEBHOOK_URL` and `LUMEN_JARVIS_WEBHOOK_SECRET` are set, Zoora POSTs JSON events:

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

`GET /api/jarvis/chat` with the same header returns recent replies, the feeling sentence, and public wants.

`LUMEN_JARVIS_TOKEN` is not the owner password and not `OWNER_ACCESS_TOKEN`. A missing token closes the route. Jarvis messages use the same keeper-chat path: they are untrusted data, they cannot spend, and they cannot approve a wishlist, a purchase, a listing, or a print. Those buttons stay on the keeper desk.

## Printed objects (parked)

3D printing is not the first business. There is no printer yet. The fulfillment interface and mock stay in the tree, off unless `LUMEN_FULFILLMENT` is set, and this build will not grow them. No physical job is sent.
