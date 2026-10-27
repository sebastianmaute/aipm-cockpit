// Relays the model list call to the deployment's AI gateway (`_relay.ts`).
import { relay } from "../_relay";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return relay(request, "models");
}
