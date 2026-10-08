import { createHash } from "node:crypto";
import { z } from "zod";
import type { NotificationTransport, RealtimeNotification } from "./infrai_client.js";

export const workOrderNotificationSchema = z.object({
  workOrderId: z.string().min(1),
  technicianId: z.string().min(1),
  connectionState: z.enum(["online", "offline"]),
  kind: z.enum(["photo_added", "dispatch_changed", "follow_up_requested"]),
  photoId: z.string().min(1).optional(),
  dispatchStatus: z.enum(["assigned", "en_route", "on_site", "completed"]).optional(),
  followUpNote: z.string().min(1).max(500).optional(),
  occurredAt: z.string().datetime(),
}).superRefine((value, context) => {
  const requiredField = {
    photo_added: "photoId",
    dispatch_changed: "dispatchStatus",
    follow_up_requested: "followUpNote",
  } as const;
  const field = requiredField[value.kind];
  if (!value[field]) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [field],
      message: `${field} is required for ${value.kind}`,
    });
  }
});

export type WorkOrderNotification = z.infer<typeof workOrderNotificationSchema>;
export type DeliveryResult = {
  notificationId: string;
  delivery: "realtime" | "queued";
  channel: string;
};

export async function routeWorkOrderNotification(
  transport: NotificationTransport,
  input: WorkOrderNotification,
): Promise<DeliveryResult> {
  const channel = `technician:${input.technicianId}`;
  const notificationId = stableNotificationId(input);
  const data = {
    notificationId,
    workOrderId: input.workOrderId,
    kind: input.kind,
    photoId: input.photoId,
    dispatchStatus: input.dispatchStatus,
    followUpNote: input.followUpNote,
    occurredAt: input.occurredAt,
  };
  const realtime: RealtimeNotification = {
    channel,
    event: `work_order.${input.kind}`,
    data,
    account_id: input.technicianId,
  };

  if (input.connectionState === "online") {
    await transport.publishRealtime(realtime, notificationId);
    return { notificationId, delivery: "realtime", channel };
  }

  await transport.publishQueued(
    { destination: channel, event: realtime.event, accountId: input.technicianId, data },
    notificationId,
  );
  return { notificationId, delivery: "queued", channel };
}

function stableNotificationId(input: WorkOrderNotification): string {
  return createHash("sha256")
    .update(`${input.workOrderId}\u0000${input.technicianId}\u0000${input.kind}\u0000${input.occurredAt}`)
    .digest("hex");
}
