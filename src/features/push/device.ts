// Does this browser hold a Web Push subscription that the server can use? The in-page Notifier reads it so one
// device never gets both the push and the in-page notification. Written by usePush.ts after every refresh.
export const PUSH_DEVICE_KEY = "mesa.push.device";

export function deviceHoldsPush(): boolean {
  try {
    return window.localStorage.getItem(PUSH_DEVICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markDevicePush(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(PUSH_DEVICE_KEY, "1");
    else window.localStorage.removeItem(PUSH_DEVICE_KEY);
  } catch {
    /* private mode: the in-page Notifier keeps showing, which is the safe side */
  }
}
