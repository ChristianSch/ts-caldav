import { afterEach, describe, expect, test, vi } from "vitest";
import HttpClient from "../../src/http-client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HttpClient request policy", () => {
  test("validates a destination before the network request", async () => {
    const validateRequestUrl = vi.fn((url: URL) => {
      if (url.hostname === "127.0.0.1") throw new Error("Blocked destination");
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient(
      "https://127.0.0.1/caldav",
      { type: "basic", username: "user", password: "password" },
      true,
      {},
      0,
      false,
      validateRequestUrl,
    );

    await expect(
      client.request({ method: "PROPFIND", url: "/calendar/" }),
    ).rejects.toThrow("Blocked destination");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("allows a destination accepted by the policy", async () => {
    const validateRequestUrl = vi.fn();
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient(
      "https://calendar.example/",
      { type: "basic", username: "user", password: "password" },
      true,
      {},
      0,
      false,
      validateRequestUrl,
    );

    await client.request({ method: "PROPFIND", url: "/calendar/" });

    expect(validateRequestUrl).toHaveBeenCalledWith(
      new URL("https://calendar.example/calendar/"),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("uses manual redirects when requested", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 302 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new HttpClient(
      "https://calendar.example/",
      { type: "basic", username: "user", password: "password" },
      true,
      {},
      0,
      false,
      undefined,
      false,
    );

    await client.request({
      method: "PROPFIND",
      url: "/calendar/",
      validateStatus: () => true,
    });

    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ redirect: "manual" }),
    );
  });
});
