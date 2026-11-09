import { forgetDeviceToken, listDevices } from "../db/devices";
import { sessionPreview } from "../db/sessions";
import { eventHub } from "../events/eventHub";
import { logEvent } from "../observability/logger";
import { apnsSender } from "./apns";
import { TurnNotifier } from "./turnNotifier";

/** Starts pushing turn and approval alerts when APNs is configured. */
export function startPushNotifications() {
  const send = apnsSender();
  if (!send) return;
  const notifier = new TurnNotifier({
    send,
    devices: listDevices,
    forget: forgetDeviceToken,
    watching: (owner) => eventHub.hasSubscribers(owner),
    title: (owner, sessionId) => sessionPreview(owner, sessionId) ?? "Euler",
  });
  eventHub.observe((owner, event) => notifier.observe(owner, event));
  logEvent("info", "push.enabled", {});
}
