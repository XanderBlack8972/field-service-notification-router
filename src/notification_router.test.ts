import assert from "node:assert/strict";
import test from "node:test";
import type { NotificationTransport, RealtimeNotification } from "./infrai_client.js";
import { routeWorkOrderNotification, workOrderNotificationSchema } from "./notification_router.js";

class RecordingTransport implements NotificationTransport {
  realtime: Array<{ notification: RealtimeNotification; key: string }> = [];
  queued: Array<{ payload: unknown; key: string }> = [];

  async publishRealtime(notification: RealtimeNotification, key: string): Promise<void> {
    this.realtime.push({ notification, key });
  }

  async publishQueued(payload: unknown, key: string): Promise<void> {
    this.queued.push({ payload, key });
  }
}

test("queues a dispatch update when the technician is offline", async () => {
  const transport = new RecordingTransport();
  const input = workOrderNotificationSchema.parse({
    workOrderId: "WO-1042",
    technicianId: "tech-17",
    connectionState: "offline",
    kind: "dispatch_changed",
    dispatchStatus: "en_route",
    occurredAt: "2026-09-13T08:30:00.000Z",
  });

  const result = await routeWorkOrderNotification(transport, input);

  assert.equal(result.delivery, "queued");
  assert.equal(result.channel, "technician:tech-17");
  assert.equal(transport.realtime.length, 0);
  assert.equal(transport.queued.length, 1);
  assert.equal(transport.queued[0]?.key, result.notificationId);
  assert.deepEqual(transport.queued[0]?.payload, {
    destination: "technician:tech-17",
    event: "work_order.dispatch_changed",
    accountId: "tech-17",
    data: {
      notificationId: result.notificationId,
      workOrderId: "WO-1042",
      kind: "dispatch_changed",
      photoId: undefined,
      dispatchStatus: "en_route",
      followUpNote: undefined,
      occurredAt: "2026-09-13T08:30:00.000Z",
    },
  });
});

test("rejects a photo event without a photo identifier", () => {
  const parsed = workOrderNotificationSchema.safeParse({
    workOrderId: "WO-1042",
    technicianId: "tech-17",
    connectionState: "online",
    kind: "photo_added",
    occurredAt: "2026-09-13T08:30:00.000Z",
  });

  assert.equal(parsed.success, false);
});
