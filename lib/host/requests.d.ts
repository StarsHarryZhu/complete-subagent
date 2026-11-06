/**
 * Write-access requests waiting for a parent's answer.
 *
 * A request lives only in memory, from the child's `request_write_access` call
 * until the parent answers, the timeout passes, or the child's call is
 * cancelled. If the process exits, the child's call ends with it, so nothing
 * needs to survive a restart; the grants an answer produces are stored by the
 * caller in the binding store.
 * @module complete-subagent/host/requests
 */
/** One requested path. */
export interface RequestedPath {
    /** Canonical absolute path. */
    readonly path: string;
    /** Whether the whole directory is asked for (an existing directory, or a `dir/` spelling). */
    readonly directory: boolean;
}
/** What a child's call returns. */
export interface WriteAnswer {
    readonly decision: 'allow' | 'deny';
    readonly granted: {
        path: string;
        kind: 'dir' | 'file';
    }[];
    readonly message?: string;
}
/** One open request. */
export interface WriteRequest {
    readonly id: string;
    /** Child session id. */
    readonly child: string;
    /** Parent session id: the only agent that may answer. */
    readonly parent: string;
    /** The child's sub-workspace, for the parent's message. */
    readonly workspace: string | null;
    readonly paths: readonly RequestedPath[];
    readonly reason: string;
    readonly at: number;
}
/** The open requests of this process. */
export declare class RequestBroker {
    private readonly entries;
    /**
     * Open a request.
     * @param fields - everything but the id and time.
     * @returns the open request.
     */
    open(fields: Omit<WriteRequest, 'id' | 'at'>): WriteRequest;
    /**
     * An open request by id.
     * @param id - request id.
     * @returns the request, or undefined once answered, expired, or cancelled.
     */
    get(id: string): WriteRequest | undefined;
    /**
     * The open requests addressed to one parent, oldest first.
     * @param parent - parent session id.
     * @returns its requests.
     */
    pendingFor(parent: string): WriteRequest[];
    /**
     * Answer an open request and close it.
     * @param id - request id.
     * @param answer - the decision the child receives.
     * @returns false when the request was no longer open.
     */
    settle(id: string, answer: WriteAnswer): boolean;
    /**
     * Close a request without an answer (the message to the parent failed).
     * @param id - request id.
     */
    close(id: string): void;
    /**
     * Wait for the answer. A timeout closes the request as denied; cancellation
     * closes it and rejects with the signal's reason.
     * @param id - request id.
     * @param timeoutMs - how long the parent has.
     * @param signal - the child's call cancellation.
     * @returns the parent's answer, or a denial on timeout.
     */
    wait(id: string, timeoutMs: number, signal: AbortSignal): Promise<WriteAnswer>;
}
