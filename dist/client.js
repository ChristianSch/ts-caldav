"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalDAVClient = void 0;
const base_64_1 = require("base-64");
const fast_xml_parser_1 = require("fast-xml-parser");
const ical_js_1 = __importDefault(require("ical.js"));
const uuid_1 = require("uuid");
const encode_1 = require("./utils/encode");
const parser_1 = require("./utils/parser");
const common_1 = require("./utils/common");
const XML_CT = "application/xml; charset=utf-8";
const ICS_CT = "text/calendar; charset=utf-8";
class HTTPError extends Error {
    constructor(message, status, response) {
        super(message);
        this.status = status;
        this.response = response;
        this.name = "HTTPError";
    }
}
class CalDAVClient {
    constructor(options) {
        this.options = options;
        this.parser = new fast_xml_parser_1.XMLParser({
            removeNSPrefix: true,
            ignoreAttributes: false,
        });
        this.baseUrl = options.baseUrl;
        this.timeout = options.requestTimeout || 5000;
        this.logRequests = options.logRequests || false;
        this.prodId = options.prodId || "-//ts-caldav.//CalDAV Client//EN";
        this.calendarHome = null;
        this.userPrincipal = null;
        this.requestTimeout = options.requestTimeout || 5000;
        this.defaultHeaders = {
            Authorization: options.auth.type === "basic"
                ? `Basic ${(0, base_64_1.encode)(`${options.auth.username}:${options.auth.password}`)}`
                : `Bearer ${options.auth.accessToken}`,
            "Content-Type": XML_CT,
        };
    }
    /**
     * Internal fetch wrapper that handles timeouts, logging, and status validation.
     * Uses duplex: 'half' for all requests with a body to support redirects in edge runtimes.
     */
    async request(config) {
        var _a, _b;
        const url = this.resolveRequestUrl(config.url);
        const headers = { ...this.defaultHeaders, ...config.headers };
        await ((_b = (_a = this.options).validateRequestUrl) === null || _b === void 0 ? void 0 : _b.call(_a, new URL(url)));
        if (this.logRequests) {
            console.log(`Request: ${config.method.toUpperCase()} ${url}`);
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        try {
            const fetchOptions = {
                method: config.method,
                headers,
                signal: controller.signal,
                redirect: config.redirect || (this.options.followRedirects ? "follow" : "manual"),
            };
            // Add body with duplex: 'half' for edge runtime redirect support
            if (config.body !== undefined) {
                fetchOptions.body = config.body;
                // duplex: 'half' tells the Fetch API the body is fully buffered
                // and can be replayed on redirect (required for Cloudflare Workers)
                fetchOptions.duplex = "half";
            }
            const response = await fetch(url, fetchOptions);
            const data = await response.text();
            clearTimeout(timeoutId);
            const result = {
                status: response.status,
                headers: response.headers,
                data,
                ok: response.ok,
            };
            const validateStatus = config.validateStatus || ((s) => s >= 200 && s < 300);
            if (!validateStatus(response.status)) {
                throw new HTTPError(`Request failed with status ${response.status}`, response.status, result);
            }
            return result;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error(`Request timeout after ${this.timeout}ms`);
            }
            throw error;
        }
    }
    resolveRequestUrl(urlOrPath) {
        try {
            // If it's already an absolute URL, use it
            new URL(urlOrPath);
            return urlOrPath;
        }
        catch {
            // Otherwise resolve relative to baseUrl
            const base = this.baseUrl.replace(/\/+$/, "");
            const path = urlOrPath.replace(/^\/+/, "");
            return `${base}/${path}`;
        }
    }
    /**
     * Creates a new CalDAVClient instance and validates the provided credentials.
     * @param options - The CalDAV client options.
     * @returns A new CalDAVClient instance.
     * @throws An error if the provided credentials are invalid.
     * @example
     * ```typescript
     * const client = await CalDAVClient.create({
     *  baseUrl: "https://caldav.example.com",
     *  username: "user",
     *  password: "password",
     * });
     * ```
     */
    static async create(options) {
        const client = new CalDAVClient(options);
        await client.discover();
        return client;
    }
    /**
     * Creates a CalDAVClient instance from a cache object.
     * This is useful for restoring a client state without re-fetching the calendar home.
     * @param options - The CalDAV client options.
     * @param cache - The cached client state.
     * @return A new CalDAVClient instance initialized with the cached state.
     * @throws An error if the cache is invalid or incomplete.
     */
    static createFromCache(options, cache) {
        const client = new CalDAVClient(options);
        client.userPrincipal = client.resolveUrl(cache.userPrincipal);
        client.calendarHome = client.resolveUrl(cache.calendarHome);
        if (cache.prodId)
            client.prodId = cache.prodId;
        return client;
    }
    getCalendarHome() {
        return this.calendarHome;
    }
    /**
     * Exports the current client state to a cache object.
     * This can be used to restore the client state later without re-fetching the calendar home.
     * @returns A CalDAVClientCache object containing the current client state.
     */
    exportCache() {
        return {
            userPrincipal: this.userPrincipal,
            calendarHome: this.calendarHome,
            prodId: this.prodId,
        };
    }
    /*
     * Discovery
     */
    async tryDiscoveryRoots() {
        try {
            const wk = this.absolutize("/.well-known/caldav");
            return await this.followRedirectOnce(wk);
        }
        catch {
            /* fall through */
        }
        const candidates = [
            "/",
            "/dav",
            "/caldav",
            "/caldav.php",
            "/remote.php/dav",
        ];
        for (const p of candidates) {
            try {
                const abs = this.absolutize(p);
                const res = await this.request({
                    method: "OPTIONS",
                    url: abs,
                    validateStatus: () => true,
                });
                const allow = (res.headers.get("allow") || "").toUpperCase();
                const dav = (res.headers.get("dav") || "").toLowerCase();
                const looksDav = allow.includes("PROPFIND") || dav.includes("1");
                if (res.status < 500 && looksDav)
                    return abs;
            }
            catch {
                /* try next */
            }
        }
        return this.baseUrl;
    }
    async discover() {
        const discoveryRoot = await this.tryDiscoveryRoots();
        const cupXml = `
      <d:propfind xmlns:d="DAV:">
        <d:prop><d:current-user-principal/></d:prop>
      </d:propfind>`;
        const cup = await this.propfind(discoveryRoot, "0", cupXml);
        const principalHref = this.getHrefFromProp(cup, "current-user-principal");
        if (!principalHref) {
            throw new Error("User principal not found: credentials rejected or server misconfigured.");
        }
        const principalUrl = this.absolutize(principalHref);
        this.userPrincipal = principalUrl;
        const chsXml = `
      <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop><c:calendar-home-set/></d:prop>
      </d:propfind>`;
        const chs = await this.propfind(principalUrl, "0", chsXml);
        const homeHref = this.getHrefFromProp(chs, "calendar-home-set");
        if (!homeHref)
            throw new Error("calendar-home-set not found for principal.");
        const homeUrl = this.absolutize(homeHref);
        this.calendarHome = homeUrl;
        try {
            await this.propfind(homeUrl, "0", `<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>`);
        }
        catch (e) {
            throw new Error(`Authenticated but failed to access calendar home at ${homeUrl}: ${e}`);
        }
    }
    /*
     * Calendars
     */
    async getCalendars() {
        if (!this.calendarHome)
            throw new Error("Calendar home not found.");
        const requestBody = `
      <d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:apple="http://apple.com/ns/ical/">
        <d:prop>
          <d:resourcetype/>
          <d:displayname/>
          <cs:getctag/>
          <c:supported-calendar-component-set/>
          <apple:calendar-color/>
        </d:prop>
      </d:propfind>`;
        const response = await this.request({
            method: "PROPFIND",
            url: this.calendarHome,
            body: requestBody,
            headers: { Depth: "1", "Content-Type": XML_CT },
            validateStatus: (s) => s >= 200 && s < 300,
        });
        const calendars = await (0, parser_1.parseCalendars)(response.data);
        return calendars.map((cal) => ({
            ...cal,
            url: this.resolveUrl(cal.url),
        }));
    }
    /*
     * Event CRUD Operations
     */
    /**
     * Fetches all events from a specific calendar.
     * @param calendarUrl - The URL of the calendar to fetch events from.
     * @param options - Optional parameters for fetching events.
     * @returns An array of Event objects.
     */
    async getEvents(calendarUrl, options) {
        return this.getComponents(calendarUrl, "VEVENT", parser_1.parseEvents, options);
    }
    /**
     * Creates a new event in the specified calendar.
     * @param calendarUrl - The URL of the calendar to create the event in.
     * @param eventData - The data for the event to create.
     * @returns The created event's metadata.
     */
    async createEvent(calendarUrl, eventData) {
        return this.createItem(calendarUrl, eventData, this.buildICSData.bind(this), "event");
    }
    /**
     * Updates an existing event in the specified calendar.
     * @param calendarUrl - The URL of the calendar containing the event.
     * @param event - The event object with updated data.
     * @returns The updated event's metadata.
     */
    async updateEvent(calendarUrl, event) {
        return this.updateItem(calendarUrl, event, this.buildICSData.bind(this), "event");
    }
    async deleteEvent(calendarUrl, eventUid, etag) {
        return this.deleteItem(calendarUrl, eventUid, "event", etag);
    }
    /*
     * Todo CRUD Operations
     */
    /**
     * Fetches all todos from a specific calendar.
     * @param calendarUrl - The URL of the calendar to fetch todos from.
     * @param options - Optional parameters for fetching todos.
     * @returns An array of Todo objects.
     */
    async getTodos(calendarUrl, options) {
        return this.getComponents(calendarUrl, "VTODO", parser_1.parseTodos, {
            all: true,
            ...options,
        });
    }
    /**
     * Creates a new todo in the specified calendar.
     * @param calendarUrl - The URL of the calendar to create the todo in.
     * @param todoData - The data for the todo to create.
     * @returns The created todo's metadata.
     */
    async createTodo(calendarUrl, todoData) {
        return this.createItem(calendarUrl, todoData, this.buildTodoICSData.bind(this), "todo");
    }
    /**
     * Updates an existing todo in the specified calendar.
     * @param calendarUrl - The URL of the calendar containing the todo.
     * @param todo - The todo object with updated data.
     * @returns The updated todo's metadata.
     */
    async updateTodo(calendarUrl, todo) {
        return this.updateItem(calendarUrl, todo, this.buildTodoICSData.bind(this), "todo");
    }
    /**
     * Deletes a todo from the specified calendar.
     * @param calendarUrl - The URL of the calendar containing the todo.
     * @param todoUid - The UID of the todo to delete.
     * @param etag - Optional ETag for concurrency control.
     */
    async deleteTodo(calendarUrl, todoUid, etag) {
        return this.deleteItem(calendarUrl, todoUid, "todo", etag);
    }
    /*
     * Synchronization
     */
    /**
     * Fetches the current ETag for a given event href.
     * Useful when the server does not return an ETag on creation (e.g. Yahoo).
     * @param href - The full CalDAV event URL (ending in .ics).
     * @returns The ETag string, or throws an error if not found.
     */
    async getETag(href) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        try {
            const data = await this.propfind(href, "0", `<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parsed = data;
            const etagRaw = (_e = (_d = (_c = (_b = (_a = parsed === null || parsed === void 0 ? void 0 : parsed.multistatus) === null || _a === void 0 ? void 0 : _a.response) === null || _b === void 0 ? void 0 : _b.propstat) === null || _c === void 0 ? void 0 : _c.prop) === null || _d === void 0 ? void 0 : _d.getetag) !== null && _e !== void 0 ? _e : (_k = (_j = (_h = (_g = (_f = parsed === null || parsed === void 0 ? void 0 : parsed.multistatus) === null || _f === void 0 ? void 0 : _f.response) === null || _g === void 0 ? void 0 : _g[0]) === null || _h === void 0 ? void 0 : _h.propstat) === null || _j === void 0 ? void 0 : _j.prop) === null || _k === void 0 ? void 0 : _k.getetag;
            if (!etagRaw)
                throw new Error("ETag not found in PROPFIND response.");
            return String(etagRaw).replace(/^W\//, "");
        }
        catch (error) {
            throw new Error(`Failed to retrieve ETag for ${href}: ${error}`);
        }
    }
    /**
     * Fetches the current CTag for a given calendar URL.
     * @param calendarUrl - The URL of the calendar.
     * @returns The CTag string.
     */
    async getCtag(calendarUrl) {
        var _a, _b, _c, _d;
        const requestBody = `
      <d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
        <d:prop><cs:getctag/></d:prop>
      </d:propfind>`;
        const res = await this.request({
            method: "PROPFIND",
            url: calendarUrl,
            body: requestBody,
            headers: { Depth: "0", "Content-Type": XML_CT },
            validateStatus: (s) => s === 207,
        });
        const json = this.parser.parse(res.data);
        return (_d = (_c = (_b = (_a = json === null || json === void 0 ? void 0 : json.multistatus) === null || _a === void 0 ? void 0 : _a.response) === null || _b === void 0 ? void 0 : _b.propstat) === null || _c === void 0 ? void 0 : _c.prop) === null || _d === void 0 ? void 0 : _d.getctag;
    }
    diffRefs(remoteRefs, localRefs) {
        const localMap = new Map(localRefs.map((i) => [i.href, i.etag]));
        const remoteMap = new Map(remoteRefs.map((i) => [i.href, i.etag]));
        const newItems = [];
        const updatedItems = [];
        const deletedItems = [];
        for (const { href, etag } of remoteRefs) {
            if (!localMap.has(href))
                newItems.push(href);
            else if (localMap.get(href) !== etag)
                updatedItems.push(href);
        }
        for (const { href } of localRefs) {
            if (!remoteMap.has(href))
                deletedItems.push(href);
        }
        return { newItems, updatedItems, deletedItems };
    }
    /**
     * Synchronizes changes between local events and remote calendar.
     * @param calendarUrl - The URL of the calendar to sync with.
     * @param ctag - The current CTag of the calendar.
     * @param localEvents - The local events to compare against remote.
     * @returns An object containing the sync results.
     */
    async syncChanges(calendarUrl, ctag, localEvents) {
        const remoteCtag = await this.getCtag(calendarUrl);
        if (ctag === remoteCtag) {
            return {
                changed: false,
                newCtag: remoteCtag,
                newEvents: [],
                updatedEvents: [],
                deletedEvents: [],
            };
        }
        const remoteRefs = await this.getItemRefs(calendarUrl, "VEVENT");
        const { newItems, updatedItems, deletedItems } = this.diffRefs(remoteRefs, localEvents);
        return {
            changed: true,
            newCtag: remoteCtag,
            newEvents: newItems,
            updatedEvents: updatedItems,
            deletedEvents: deletedItems,
        };
    }
    /**
     * Synchronizes changes between local todos and remote calendar.
     * @param calendarUrl - The URL of the calendar to sync with.
     * @param ctag - The current CTag of the calendar.
     * @param localTodos - The local todos to compare against remote.
     * @returns An object containing the sync results.
     */
    async syncTodoChanges(calendarUrl, ctag, localTodos) {
        const remoteCtag = await this.getCtag(calendarUrl);
        if (ctag === remoteCtag) {
            return {
                changed: false,
                newCtag: remoteCtag,
                newTodos: [],
                updatedTodos: [],
                deletedTodos: [],
            };
        }
        const remoteRefs = await this.getItemRefs(calendarUrl, "VTODO");
        const { newItems, updatedItems, deletedItems } = this.diffRefs(remoteRefs, localTodos);
        return {
            changed: true,
            newCtag: remoteCtag,
            newTodos: newItems,
            updatedTodos: updatedItems,
            deletedTodos: deletedItems,
        };
    }
    /*
     * Internal Methods
     */
    async getComponents(calendarUrl, component, parseFn, options) {
        const now = new Date();
        const defaultEnd = new Date(now.getTime() + 3 * 7 * 24 * 60 * 60 * 1000);
        const { start = now, end = defaultEnd, all } = options || {};
        const timeRangeFilter = start && end && !all
            ? `<c:comp-filter name="${component}">
             <c:time-range start="${(0, encode_1.formatDate)(start)}" end="${(0, encode_1.formatDate)(end)}"/>
           </c:comp-filter>`
            : `<c:comp-filter name="${component}"/>`;
        const requestBody = `
      <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop>
          <d:getetag/>
          <c:calendar-data/>
        </d:prop>
        <c:filter>
          <c:comp-filter name="VCALENDAR">
            ${timeRangeFilter}
          </c:comp-filter>
        </c:filter>
      </c:calendar-query>`;
        try {
            const xml = await this.report(calendarUrl, requestBody, "1");
            return await parseFn(xml);
        }
        catch (error) {
            throw new Error(`Failed to retrieve ${component.toLowerCase()}s from the CalDAV server. ${error}`);
        }
    }
    buildICSData(event, uid) {
        const vcalendar = new ical_js_1.default.Component(["vcalendar", [], []]);
        vcalendar.addPropertyWithValue("version", "2.0");
        vcalendar.addPropertyWithValue("prodid", this.prodId);
        const vevent = new ical_js_1.default.Component("vevent");
        const e = new ical_js_1.default.Event(vevent);
        e.uid = uid;
        vevent.addPropertyWithValue("dtstamp", ical_js_1.default.Time.fromJSDate(new Date(), true));
        if (event.wholeDay) {
            const startDateStr = event.start.toISOString().split("T")[0];
            const endDateStr = event.end
                ? event.end.toISOString().split("T")[0]
                : startDateStr;
            const endExclusive = new Date(endDateStr + "T00:00:00Z");
            endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
            e.startDate = ical_js_1.default.Time.fromDateString(startDateStr);
            e.endDate = ical_js_1.default.Time.fromDateString(endExclusive.toISOString().split("T")[0]);
        }
        else {
            const start = ical_js_1.default.Time.fromJSDate(event.start, true);
            const end = ical_js_1.default.Time.fromJSDate(event.end, true);
            if (event.startTzid) {
                const prop = vevent.addPropertyWithValue("dtstart", start);
                prop.setParameter("tzid", event.startTzid);
            }
            else {
                e.startDate = start;
            }
            if (event.endTzid) {
                const prop = vevent.addPropertyWithValue("dtend", end);
                prop.setParameter("tzid", event.endTzid);
            }
            else {
                e.endDate = end;
            }
        }
        e.summary = event.summary;
        e.description = event.description || "";
        e.location = event.location || "";
        if (event.recurrenceRule) {
            const r = event.recurrenceRule;
            const rruleProps = {};
            if (r.freq)
                rruleProps.FREQ = r.freq;
            if (r.interval)
                rruleProps.INTERVAL = r.interval;
            if (r.count)
                rruleProps.COUNT = r.count;
            if (event.wholeDay && r.until) {
                rruleProps.UNTIL = ical_js_1.default.Time.fromDateString(r.until.toISOString().split("T")[0]).toString();
            }
            else if (r.until) {
                rruleProps.UNTIL = ical_js_1.default.Time.fromJSDate(r.until, true).toString();
            }
            if (r.byday)
                rruleProps.BYDAY = r.byday.join(",");
            if (r.bymonthday)
                rruleProps.BYMONTHDAY = r.bymonthday.join(",");
            if (r.bymonth)
                rruleProps.BYMONTH = r.bymonth.join(",");
            vevent.addPropertyWithValue("rrule", rruleProps);
        }
        if (event.alarms) {
            for (const alarm of event.alarms) {
                const valarm = new ical_js_1.default.Component("valarm");
                valarm.addPropertyWithValue("trigger", alarm.trigger);
                valarm.addPropertyWithValue("action", alarm.action);
                if (alarm.action === "DISPLAY" && alarm.description) {
                    valarm.addPropertyWithValue("description", alarm.description);
                }
                else if (alarm.action === "EMAIL") {
                    if (alarm.summary)
                        valarm.addPropertyWithValue("summary", alarm.summary);
                    if (alarm.description)
                        valarm.addPropertyWithValue("description", alarm.description);
                    for (const attendee of alarm.attendees) {
                        valarm.addPropertyWithValue("attendee", attendee);
                    }
                }
                vevent.addSubcomponent(valarm);
            }
        }
        vcalendar.addSubcomponent(vevent);
        return vcalendar.toString();
    }
    buildTodoICSData(todo, uid) {
        const vcalendar = new ical_js_1.default.Component(["vcalendar", [], []]);
        vcalendar.addPropertyWithValue("version", "2.0");
        vcalendar.addPropertyWithValue("prodid", this.prodId);
        const vtodo = new ical_js_1.default.Component("vtodo");
        vtodo.addPropertyWithValue("uid", uid);
        vtodo.addPropertyWithValue("dtstamp", ical_js_1.default.Time.fromJSDate(new Date(), true));
        if (todo.start)
            vtodo.addPropertyWithValue("dtstart", ical_js_1.default.Time.fromJSDate(todo.start, true));
        if (todo.due)
            vtodo.addPropertyWithValue("due", ical_js_1.default.Time.fromJSDate(todo.due, true));
        if (todo.completed)
            vtodo.addPropertyWithValue("completed", ical_js_1.default.Time.fromJSDate(todo.completed, true));
        vtodo.addPropertyWithValue("summary", todo.summary);
        if (todo.description)
            vtodo.addPropertyWithValue("description", todo.description);
        if (todo.location)
            vtodo.addPropertyWithValue("location", todo.location);
        if (todo.status)
            vtodo.addPropertyWithValue("status", todo.status);
        if (todo.sortOrder !== undefined)
            vtodo.addPropertyWithValue("X-APPLE-SORT-ORDER", todo.sortOrder);
        if (todo.alarms) {
            for (const alarm of todo.alarms) {
                const valarm = new ical_js_1.default.Component("valarm");
                valarm.addPropertyWithValue("trigger", alarm.trigger);
                valarm.addPropertyWithValue("action", alarm.action);
                if (alarm.action === "DISPLAY" && alarm.description) {
                    valarm.addPropertyWithValue("description", alarm.description);
                }
                else if (alarm.action === "EMAIL") {
                    if (alarm.summary)
                        valarm.addPropertyWithValue("summary", alarm.summary);
                    if (alarm.description)
                        valarm.addPropertyWithValue("description", alarm.description);
                    for (const attendee of alarm.attendees) {
                        valarm.addPropertyWithValue("attendee", attendee);
                    }
                }
                vtodo.addSubcomponent(valarm);
            }
        }
        vcalendar.addSubcomponent(vtodo);
        return vcalendar.toString();
    }
    async createItem(calendarUrl, data, buildFn, itemType) {
        if (!calendarUrl)
            throw new Error(`Calendar URL is required to create a ${itemType}.`);
        const base = (0, common_1.normalizeSlashEnd)(calendarUrl);
        const uid = data.uid || (0, uuid_1.v4)();
        const href = `${base}/${uid}.ics`;
        const ics = buildFn(data, uid);
        try {
            const response = await this.mkIcsPut(href, ics, { "If-None-Match": "*" }, (s) => s === 201 || s === 204);
            const etag = response.headers.get("etag") || "";
            const newCtag = await this.getCtag(base);
            return { uid, href: `${base}/${uid}.ics`, etag, newCtag };
        }
        catch (error) {
            if (error instanceof HTTPError && error.status === 412) {
                throw new Error(`${itemType[0].toUpperCase() + itemType.slice(1)} with the specified uid already exists.`);
            }
            throw new Error(`Failed to create ${itemType}: ${error}`);
        }
    }
    async updateItem(calendarUrl, item, buildFn, itemType) {
        if (!item.uid || !item.href) {
            throw new Error(`Both 'uid' and 'href' are required to update a ${itemType}.`);
        }
        const base = (0, common_1.normalizeSlashEnd)(calendarUrl);
        const ics = buildFn(item, item.uid);
        const ifMatch = this.cleanEtag(item.etag);
        const extraHeaders = {};
        if (ifMatch && !this.isWeak(ifMatch)) {
            extraHeaders["If-Match"] = ifMatch;
        }
        try {
            const response = await this.mkIcsPut(item.href, ics, extraHeaders);
            const newEtag = response.headers.get("etag") || "";
            const newCtag = await this.getCtag(base);
            return { uid: item.uid, href: item.href, etag: newEtag, newCtag };
        }
        catch (error) {
            if (error instanceof HTTPError && error.status === 412) {
                throw new Error(`${itemType[0].toUpperCase() + itemType.slice(1)} with the specified uid does not match.`);
            }
            throw new Error(`Failed to update ${itemType}: ${error}`);
        }
    }
    async deleteItem(calendarUrl, uid, itemType, etag) {
        const base = (0, common_1.normalizeSlashEnd)(calendarUrl);
        const href = `${base}/${uid}.ics`;
        try {
            await this.request({
                method: "DELETE",
                url: href,
                headers: { "If-Match": etag !== null && etag !== void 0 ? etag : "*" },
                validateStatus: (s) => s === 200 || s === 204,
            });
        }
        catch (error) {
            throw new Error(`Failed to delete ${itemType}: ${error}`);
        }
    }
    async getItemRefs(calendarUrl, component) {
        var _a, _b, _c;
        const requestBody = `
      <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop><d:getetag/></d:prop>
        <c:filter>
          <c:comp-filter name="VCALENDAR">
            <c:comp-filter name="${component}"/>
          </c:comp-filter>
        </c:filter>
      </c:calendar-query>`;
        const data = await this.report(calendarUrl, requestBody, "1");
        const jsonData = this.parser.parse(data);
        const raw = (_a = jsonData === null || jsonData === void 0 ? void 0 : jsonData.multistatus) === null || _a === void 0 ? void 0 : _a.response;
        const responses = Array.isArray(raw) ? raw : raw ? [raw] : [];
        const refs = [];
        for (const obj of responses) {
            if (!obj || typeof obj !== "object")
                continue;
            const href = obj["href"];
            const etag = (_c = (_b = obj === null || obj === void 0 ? void 0 : obj.propstat) === null || _b === void 0 ? void 0 : _b.prop) === null || _c === void 0 ? void 0 : _c.getetag;
            if (href && etag)
                refs.push({ href, etag });
        }
        return refs;
    }
    async getEventsByHref(calendarUrl, hrefs) {
        return this.getItemsByHref(calendarUrl, hrefs, parser_1.parseEvents);
    }
    async getTodosByHref(calendarUrl, hrefs) {
        return this.getItemsByHref(calendarUrl, hrefs, parser_1.parseTodos);
    }
    async getItemsByHref(calendarUrl, hrefs, parseFn) {
        if (!hrefs.length)
            return [];
        const filtered = hrefs.filter((h) => h.endsWith(".ics"));
        if (!filtered.length)
            return [];
        const requestBody = `
      <c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop>
          <d:getetag/>
          <c:calendar-data/>
        </d:prop>
        ${filtered.map((h) => `<d:href>${h}</d:href>`).join("")}
      </c:calendar-multiget>`;
        const xml = await this.report(calendarUrl, requestBody, "1");
        return await parseFn(xml);
    }
    /*
     * Utility Methods
     */
    absolutize(urlOrPath) {
        try {
            return new URL(urlOrPath).toString();
        }
        catch {
            return new URL(urlOrPath, this.baseUrl).toString();
        }
    }
    resolveUrl(path) {
        const basePath = new URL(this.baseUrl).pathname;
        if (path.startsWith(basePath) && basePath !== "/") {
            const stripped = path.substring(basePath.length);
            return stripped.startsWith("/") ? stripped : "/" + stripped;
        }
        return path;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getHrefFromProp(parsed, propName) {
        const ms = parsed === null || parsed === void 0 ? void 0 : parsed.multistatus;
        const resp = (0, common_1.first)(ms === null || ms === void 0 ? void 0 : ms.response);
        const pstat = (0, common_1.first)(resp === null || resp === void 0 ? void 0 : resp.propstat);
        const prop = pstat === null || pstat === void 0 ? void 0 : pstat.prop;
        const node = prop === null || prop === void 0 ? void 0 : prop[propName];
        if (!node)
            return null;
        if (typeof node === "string")
            return node;
        if (typeof (node === null || node === void 0 ? void 0 : node.href) === "string")
            return node.href;
        const maybe = (0, common_1.first)(node);
        if (typeof maybe === "string")
            return maybe;
        if (maybe && typeof maybe.href === "string")
            return maybe.href;
        return null;
    }
    isWeak(etag) {
        return !!etag && (etag.startsWith('W/"') || etag.startsWith("W/"));
    }
    cleanEtag(etag) {
        if (!etag)
            return undefined;
        return etag.replace(/^W\//, "").trim();
    }
    /*
     * HTTP Methods
     */
    async propfind(url, depth, body) {
        const res = await this.request({
            method: "PROPFIND",
            url,
            body,
            headers: {
                Depth: depth,
                Prefer: "return=minimal",
                "Content-Type": XML_CT,
            },
            validateStatus: (s) => s === 207 || s === 200,
        });
        return this.parser.parse(res.data);
    }
    async report(url, body, depth = "1") {
        const res = await this.request({
            method: "REPORT",
            url,
            body,
            headers: { Depth: depth, "Content-Type": XML_CT },
            validateStatus: (s) => s >= 200 && s < 300,
        });
        return res.data;
    }
    async mkIcsPut(href, ics, headers, validate) {
        return this.request({
            method: "PUT",
            url: href,
            body: ics,
            headers: { "Content-Type": ICS_CT, ...(headers || {}) },
            validateStatus: validate !== null && validate !== void 0 ? validate : ((s) => s >= 200 && s < 300),
        });
    }
    async followRedirectOnce(url) {
        const res = await this.request({
            method: "GET",
            url,
            redirect: "manual",
            validateStatus: (s) => (s >= 200 && s < 300) || (s >= 300 && s < 400),
        });
        if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get("location");
            if (!loc)
                throw new Error(`Redirect without Location from ${url}`);
            return this.absolutize(loc);
        }
        return url;
    }
}
exports.CalDAVClient = CalDAVClient;
//# sourceMappingURL=client.js.map