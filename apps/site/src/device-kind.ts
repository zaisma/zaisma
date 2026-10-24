import { DEVICE_KINDS, type DeviceKind } from "@zaisma/core";

/**
 * The viewer's kind of device (phone, tablet or computer), which Browse and the home put games for first. Measured in the browser the way
 * the game page does (a coarse pointer is a phone under 600 px on its short side, else a tablet; otherwise a computer) and kept in
 * DEVICE_KIND_COOKIE; a first visit without it is guessed from the browser's name.
 */

/** The cookie the device's kind is kept in. Not zaisma_device, which holds the sign-in device marks. */
export const DEVICE_KIND_COOKIE = "zaisma_device_kind";

/** What the page scripts measured (the cookie), else a guess from the browser's name, so a first page is in the right order for nearly everyone. */
export function viewerDeviceKind(request: Request): DeviceKind {
  const cookie = (request.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${DEVICE_KIND_COOKIE}=([a-z]+)`))?.[1];
  if ((DEVICE_KINDS as readonly string[]).includes(cookie ?? "")) return cookie as DeviceKind;
  const userAgent = request.headers.get("user-agent") ?? "";
  if (/Mobi/.test(userAgent)) return "phone";
  if (/iPad|Tablet|Android/.test(userAgent)) return "tablet";
  return "computer";
}

/** A page script function, zaismaDeviceKind(), that measures the device, keeps it in the cookie when it changed and answers it. */
export const DEVICE_KIND_SOURCE = String.raw`function zaismaDeviceKind() {
  var deviceKind = matchMedia("(pointer: coarse)").matches ? (Math.min(screen.width, screen.height) < 600 ? "phone" : "tablet") : "computer";
  if (document.cookie.indexOf("${DEVICE_KIND_COOKIE}=" + deviceKind) === -1) document.cookie = "${DEVICE_KIND_COOKIE}=" + deviceKind + "; Max-Age=31536000; Path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
  return deviceKind;
}`;
