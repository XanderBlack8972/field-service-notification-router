const response = await fetch("http://localhost:3000/work-order-notifications", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    workOrderId: "WO-1042",
    technicianId: "tech-17",
    connectionState: "offline",
    kind: "dispatch_changed",
    dispatchStatus: "en_route",
    occurredAt: "2026-09-13T08:30:00.000Z",
  }),
});

console.log(response.status, await response.json());
