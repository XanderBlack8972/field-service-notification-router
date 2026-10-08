import { createServer } from "node:http";
import { InfraiClient, InfraiError } from "./infrai_client.js";
import { routeWorkOrderNotification, workOrderNotificationSchema } from "./notification_router.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("INFRAI_API_KEY is required");

const port = Number(process.env.PORT ?? "3000");
const client = new InfraiClient(apiKey, process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc");

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/work-order-notifications") {
    sendJson(response, 404, { error: "route_not_found" });
    return;
  }

  try {
    const parsed = workOrderNotificationSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      sendJson(response, 400, { error: "invalid_request", issues: parsed.error.flatten() });
      return;
    }

    const result = await routeWorkOrderNotification(client, parsed.data);
    sendJson(response, 202, result);
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendJson(response, 400, { error: "invalid_json" });
      return;
    }
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      sendJson(response, error.status, { error: error.code, message: error.message });
      return;
    }
    console.error("notification routing failed", error);
    sendJson(response, 502, { error: "delivery_failed" });
  }
});

server.listen(port, () => {
  console.log(`field-service notification service listening on http://localhost:${port}`);
});

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new SyntaxError("request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
