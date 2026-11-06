/**
 * Structural mirrors of the host services this plugin reads.
 *
 * The plugin imports only `@deepseek-ai/cordis`, `@deepseek-ai/schemastery`, and
 * `@deepseek-ai/dsh-tools` at runtime, so these types mirror only the fields it
 * uses from `@deepseek-ai/dsh-session` (header), `@deepseek-ai/dsh-agent`,
 * `@deepseek-ai/dsh-agent-preset-registry`, `@deepseek-ai/dsh-session-projection`,
 * `@deepseek-ai/dsh-sandbox-policy`, `@deepseek-ai/dsh-working-directory`,
 * `@deepseek-ai/dsh-subagent`, and `@deepseek-ai/dsh-llm`. Each mirror names its
 * source for the next reader, and says so when a field is missing from the
 * oldest supported host, 0.2.1-rc.5.
 * @module complete-subagent/host/types
 */
/** This plugin's delegation tools and the backend each starts children on. */
export const DELEGATE_TOOLS = {
    delegate: 'spawn',
    delegate_fork: 'fork',
};
/** The child's tool for asking its parent. */
export const REQUEST_TOOL = 'request_write_access';
/** The parent's tool for answering a request. */
export const ANSWER_TOOL = 'answer_write_request';
/** The parent's tool for granting without a request. */
export const GRANT_TOOL = 'grant_write_access';
/** The parent's tool for taking grants back. */
export const REVOKE_TOOL = 'revoke_write_access';
