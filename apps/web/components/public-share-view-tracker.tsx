"use client";

import { useEffect } from "react";

type PublicShareViewTrackerProps = {
  token: string;
};

const PUBLIC_SHARE_VIEW_ENDPOINT = "/api/share/view";

function buildPublicShareViewPayload(token: string): string {
  return JSON.stringify({ token });
}

function buildPublicShareViewBeaconBody(payload: string): Blob | string {
  if (typeof Blob === "function") {
    return new Blob([payload], {
      type: "application/json"
    });
  }

  return payload;
}

export function dispatchPublicShareView(
  token: string,
  options?: {
    fetchImpl?: typeof fetch;
    navigatorImpl?: Pick<Navigator, "sendBeacon"> | null;
  }
): void {
  const payload = buildPublicShareViewPayload(token);
  const navigatorImpl = options?.navigatorImpl ?? (typeof navigator === "undefined" ? null : navigator);

  if (navigatorImpl?.sendBeacon) {
    const accepted = navigatorImpl.sendBeacon(PUBLIC_SHARE_VIEW_ENDPOINT, buildPublicShareViewBeaconBody(payload));

    if (accepted) {
      return;
    }
  }

  const fetchImpl = options?.fetchImpl ?? (typeof fetch === "function" ? fetch : null);

  if (!fetchImpl) {
    return;
  }

  // Share rendering must stay resilient even if best-effort view tracking fails.
  void fetchImpl(PUBLIC_SHARE_VIEW_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: payload,
    cache: "no-store",
    keepalive: true
  }).catch(() => {});
}

export function PublicShareViewTracker({ token }: PublicShareViewTrackerProps) {
  useEffect(() => {
    dispatchPublicShareView(token);
  }, [token]);

  return null;
}
