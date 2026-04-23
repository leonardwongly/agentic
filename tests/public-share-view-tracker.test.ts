import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchPublicShareView } from "../apps/web/components/public-share-view-tracker";

describe("public share view tracker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses sendBeacon when the browser accepts the share-view event", () => {
    const sendBeacon = vi.fn(() => true);
    const fetchImpl = vi.fn<typeof fetch>();

    dispatchPublicShareView("share-token", {
      fetchImpl,
      navigatorImpl: { sendBeacon }
    });

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0]?.[0]).toBe("/api/share/view");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls back to a keepalive fetch when sendBeacon declines the request", async () => {
    const sendBeacon = vi.fn(() => false);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));

    dispatchPublicShareView("share-token", {
      fetchImpl,
      navigatorImpl: { sendBeacon }
    });

    await Promise.resolve();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/share/view",
      expect.objectContaining({
        method: "POST",
        keepalive: true,
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ token: "share-token" })
      })
    );
  });

  it("still uses keepalive fetch when sendBeacon is unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));

    dispatchPublicShareView("share-token", {
      fetchImpl,
      navigatorImpl: null
    });

    await Promise.resolve();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
