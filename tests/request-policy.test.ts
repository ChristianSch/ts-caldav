import { CalDAVClient } from "../src/client";

describe("CalDAVClient request policy", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("validates each outbound destination before fetching", async () => {
    const validateRequestUrl = jest.fn((url: URL) => {
      if (url.hostname === "127.0.0.1") throw new Error("Blocked destination");
    });
    global.fetch = jest.fn(async () => {
      throw new Error("fetch should not be reached");
    }) as typeof fetch;

    await expect(
      CalDAVClient.create({
        baseUrl: "https://127.0.0.1/caldav",
        auth: { type: "basic", username: "user", password: "password" },
        validateRequestUrl,
      }),
    ).rejects.toThrow("Blocked destination");

    expect(validateRequestUrl).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "127.0.0.1" }),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("does not automatically follow redirects by default", async () => {
    const validateRequestUrl = jest.fn((url: URL) => {
      if (url.hostname === "127.0.0.1") throw new Error("Blocked destination");
    });
    global.fetch = jest.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://127.0.0.1/private" },
      }),
    ) as typeof fetch;

    await expect(
      CalDAVClient.create({
        baseUrl: "https://calendar.example/caldav",
        auth: { type: "basic", username: "user", password: "password" },
        validateRequestUrl,
      }),
    ).rejects.toThrow("Blocked destination");

    expect(validateRequestUrl).toHaveBeenCalledTimes(2);
    expect(validateRequestUrl).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "calendar.example" }),
    );
    expect(validateRequestUrl).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "127.0.0.1" }),
    );
  });
});
