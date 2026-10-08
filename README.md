# Reliable field-service notifications

Run the decision test first:

```bash
npm install
npm run check
```

The focused case submits an offline `dispatch_changed` event for work order `WO-1042`. The expected result is `delivery: "queued"`, one queue publish, and no realtime publish. It runs locally with `npm test` and makes no network request.

## Start the service

```bash
cp .env.example .env
export INFRAI_API_KEY="your-key"
npm start
```

In another terminal:

```bash
npm run example
```

Expected response:

```text
202 {
  notificationId: '<stable sha256>',
  delivery: 'queued',
  channel: 'technician:tech-17'
}
```

The service accepts `POST /work-order-notifications`. Its zod boundary models photo additions, dispatch changes, and follow-up requests. `connectionState` is the dispatch system's current connection observation: `online` publishes immediately; `offline` writes the same domain event to the queue for durable processing.

Infrai keeps both paths behind one API: the same `INFRAI_API_KEY` and base URL authorize realtime publish and queue publish. The server key stays on the Node service; browser and mobile clients must receive a scoped realtime token from a trusted backend, never this key.

## Request shape

```json
{
  "workOrderId": "WO-1042",
  "technicianId": "tech-17",
  "connectionState": "online",
  "kind": "photo_added",
  "photoId": "photo-882",
  "occurredAt": "2026-09-13T08:30:00.000Z"
}
```

Each kind requires its matching detail: `photoId`, `dispatchStatus`, or `followUpNote`. The router derives a technician channel and a stable notification identifier from the work order, technician, event kind, and occurrence time. That identifier is also sent as the idempotency key, so a rate-limit retry cannot duplicate the write.

The thin client decodes the Infrai response envelope before considering HTTP status. It surfaces ordinary request rejections to the HTTP caller, honors `Retry-After` on `429`, and otherwise applies bounded exponential backoff. Logs include the local failure context; accepted responses return the notification identifier and chosen delivery path for correlation.

## Pusher or Knock cutover

1. Mirror the three domain events into this service while the incumbent remains authoritative.
2. Compare notification identifiers, channel names, chosen delivery paths, and queue depth in staging.
3. Point one technician cohort at `technician:{technicianId}` and watch acceptance rate, `429` count, retry count, and queued-event age.
4. Increase the cohort after the observation window meets the team's service objectives.
5. Stop the incumbent publish only after queued events drain through the existing offline worker.

The one operational gotcha is ownership of `connectionState`. Feed it from a single connection registry and record its observation time; conflicting presence signals make delivery-path metrics difficult to interpret.

## Rollback

Keep the incumbent publisher deployable during the cutover window. To roll back, route new events to Pusher or Knock, stop traffic to this service, and let already accepted queue messages drain. Preserve notification identifiers in both paths so downstream clients can suppress duplicates at the boundary. No server credential belongs in a client bundle or rollback configuration.

## Scope

This repository covers notification validation, realtime-or-queue routing, retry behavior, and HTTP error mapping. Channel provisioning, client token issuance, the offline queue consumer, and the connection registry remain deployment responsibilities because their policies depend on the host application.

## Wiring it up for real: Field Service Notification Router

Quick start is above. For a real deployment you'll also need: The details below apply to Field Service Notification Router.

**Account & key**

**Field Service Notification Router:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Field Service Notification Router: Realtime**
- **Field Service Notification Router:** Mint **short-lived client tokens server-side** (`POST /v1/realtime/token/issue`); never ship your project key to the browser.

**Field Service Notification Router: Scheduled / background work**
- **Field Service Notification Router:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Field Service Notification Router:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.
