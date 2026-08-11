import { afterEach, describe, expect, test, vi } from "vitest";
import { CalDAVClient } from "../../src/client";

// Regression test for #23: with a sub-path baseUrl (e.g. Baikal's /dav.php/),
// passing an absolute-from-root calendar href into getEvents/getTodos used to
// produce a doubled path segment (…/dav.php/dav.php/…) because axios joined
// baseURL by naive string concatenation. The fetch layer resolves URLs with
// WHATWG `new URL(url, baseUrl)`, which replaces the whole path for an
// absolute-path href, so the REPORT must hit the calendar exactly once.

const EMPTY_MULTISTATUS = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:"></d:multistatus>`;

const baseOptions = {
  baseUrl: "http://baikal.host/dav.php/",
  auth: { type: "basic" as const, username: "user", password: "pass" },
};

const cache = {
  userPrincipal: "/dav.php/principals/user/",
  calendarHome: "/dav.php/calendars/user/",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sub-path baseUrl (Baikal)", () => {
  test("getTodos REPORTs the calendar href without doubling the sub-path", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(EMPTY_MULTISTATUS, {
          status: 207,
          headers: { "Content-Type": "application/xml" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = CalDAVClient.createFromCache(baseOptions, cache);
    await client.getTodos("/dav.php/calendars/user/default/", { all: true });

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      "http://baikal.host/dav.php/calendars/user/default/",
    );
    expect(calledUrl).not.toContain("/dav.php/dav.php");
  });
});
