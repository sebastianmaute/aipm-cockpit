// Relays a Messages call to the deployment's AI gateway (`_relay.ts`).
import { relay } from "../_relay";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return relay(request, "messages");
}
