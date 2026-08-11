import { CalDAVClientCache, CalDAVOptions, Calendar, Event, EventRef, SyncChangesResult, SyncTodosResult, Todo, TodoRef } from "./models";
type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export declare class CalDAVClient {
    private options;
    private baseUrl;
    private defaultHeaders;
    private timeout;
    private logRequests;
    private prodId;
    private parser;
    calendarHome: string | null;
    userPrincipal: string | null;
    requestTimeout: number;
    private constructor();
    /**
     * Internal fetch wrapper that handles timeouts, logging, and status validation.
     * Uses duplex: 'half' for all requests with a body to support redirects in edge runtimes.
     */
    private request;
    private resolveRequestUrl;
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
    static create(options: CalDAVOptions): Promise<CalDAVClient>;
    /**
     * Creates a CalDAVClient instance from a cache object.
     * This is useful for restoring a client state without re-fetching the calendar home.
     * @param options - The CalDAV client options.
     * @param cache - The cached client state.
     * @return A new CalDAVClient instance initialized with the cached state.
     * @throws An error if the cache is invalid or incomplete.
     */
    static createFromCache(options: CalDAVOptions, cache: CalDAVClientCache): CalDAVClient;
    getCalendarHome(): string | null;
    /**
     * Exports the current client state to a cache object.
     * This can be used to restore the client state later without re-fetching the calendar home.
     * @returns A CalDAVClientCache object containing the current client state.
     */
    exportCache(): CalDAVClientCache;
    private tryDiscoveryRoots;
    private discover;
    getCalendars(): Promise<Calendar[]>;
    /**
     * Fetches all events from a specific calendar.
     * @param calendarUrl - The URL of the calendar to fetch events from.
     * @param options - Optional parameters for fetching events.
     * @returns An array of Event objects.
     */
    getEvents(calendarUrl: string, options?: {
        start?: Date;
        end?: Date;
        all?: boolean;
    }): Promise<Event[]>;
    /**
     * Creates a new event in the specified calendar.
     * @param calendarUrl - The URL of the calendar to create the event in.
     * @param eventData - The data for the event to create.
     * @returns The created event's metadata.
     */
    createEvent(calendarUrl: string, eventData: PartialBy<Event, "uid" | "href" | "etag">): Promise<{
        uid: string;
        href: string;
        etag: string;
        newCtag: string;
    }>;
    /**
     * Updates an existing event in the specified calendar.
     * @param calendarUrl - The URL of the calendar containing the event.
     * @param event - The event object with updated data.
     * @returns The updated event's metadata.
     */
    updateEvent(calendarUrl: string, event: Event): Promise<{
        uid: string;
        href: string;
        etag: string;
        newCtag: string;
    }>;
    deleteEvent(calendarUrl: string, eventUid: string, etag?: string): Promise<void>;
    /**
     * Fetches all todos from a specific calendar.
     * @param calendarUrl - The URL of the calendar to fetch todos from.
     * @param options - Optional parameters for fetching todos.
     * @returns An array of Todo objects.
     */
    getTodos(calendarUrl: string, options?: {
        start?: Date;
        end?: Date;
        all?: boolean;
    }): Promise<Todo[]>;
    /**
     * Creates a new todo in the specified calendar.
     * @param calendarUrl - The URL of the calendar to create the todo in.
     * @param todoData - The data for the todo to create.
     * @returns The created todo's metadata.
     */
    createTodo(calendarUrl: string, todoData: PartialBy<Todo, "uid" | "href" | "etag">): Promise<{
        uid: string;
        href: string;
        etag: string;
        newCtag: string;
    }>;
    /**
     * Updates an existing todo in the specified calendar.
     * @param calendarUrl - The URL of the calendar containing the todo.
     * @param todo - The todo object with updated data.
     * @returns The updated todo's metadata.
     */
    updateTodo(calendarUrl: string, todo: Todo): Promise<{
        uid: string;
        href: string;
        etag: string;
        newCtag: string;
    }>;
    /**
     * Deletes a todo from the specified calendar.
     * @param calendarUrl - The URL of the calendar containing the todo.
     * @param todoUid - The UID of the todo to delete.
     * @param etag - Optional ETag for concurrency control.
     */
    deleteTodo(calendarUrl: string, todoUid: string, etag?: string): Promise<void>;
    /**
     * Fetches the current ETag for a given event href.
     * Useful when the server does not return an ETag on creation (e.g. Yahoo).
     * @param href - The full CalDAV event URL (ending in .ics).
     * @returns The ETag string, or throws an error if not found.
     */
    getETag(href: string): Promise<string>;
    /**
     * Fetches the current CTag for a given calendar URL.
     * @param calendarUrl - The URL of the calendar.
     * @returns The CTag string.
     */
    getCtag(calendarUrl: string): Promise<string>;
    private diffRefs;
    /**
     * Synchronizes changes between local events and remote calendar.
     * @param calendarUrl - The URL of the calendar to sync with.
     * @param ctag - The current CTag of the calendar.
     * @param localEvents - The local events to compare against remote.
     * @returns An object containing the sync results.
     */
    syncChanges(calendarUrl: string, ctag: string, localEvents: EventRef[]): Promise<SyncChangesResult>;
    /**
     * Synchronizes changes between local todos and remote calendar.
     * @param calendarUrl - The URL of the calendar to sync with.
     * @param ctag - The current CTag of the calendar.
     * @param localTodos - The local todos to compare against remote.
     * @returns An object containing the sync results.
     */
    syncTodoChanges(calendarUrl: string, ctag: string, localTodos: TodoRef[]): Promise<SyncTodosResult>;
    private getComponents;
    private buildICSData;
    private buildTodoICSData;
    private createItem;
    private updateItem;
    private deleteItem;
    private getItemRefs;
    getEventsByHref(calendarUrl: string, hrefs: string[]): Promise<Event[]>;
    getTodosByHref(calendarUrl: string, hrefs: string[]): Promise<Todo[]>;
    private getItemsByHref;
    private absolutize;
    private resolveUrl;
    private getHrefFromProp;
    private isWeak;
    private cleanEtag;
    private propfind;
    private report;
    private mkIcsPut;
    private followRedirectOnce;
}
export {};
