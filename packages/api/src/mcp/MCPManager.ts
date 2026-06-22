import pick from 'lodash/pick';
import { logger } from '@librechat/data-schemas';
import { CallToolResultSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { TokenMethods, IUser } from '@librechat/data-schemas';
import type { GraphTokenResolver } from '~/utils/graph';
import type { FlowStateManager } from '~/flow/manager';
import type { MCPOAuthTokens } from './oauth';
import type { RequestBody } from '~/types';
import type * as t from './types';
import { MCPServersInitializer } from './registry/MCPServersInitializer';
import { MCPServerInspector } from './registry/MCPServerInspector';
import { MCPServersRegistry } from './registry/MCPServersRegistry';
import { UserConnectionManager } from './UserConnectionManager';
import { ConnectionsRepository } from './ConnectionsRepository';
import { MCPConnectionFactory } from './MCPConnectionFactory';
import { preProcessGraphTokens } from '~/utils/graph';
import {
  MCPCallQueue,
  MICROSOFT365_QUEUE_DEFAULTS,
  type QueueGraphTokenResolver,
} from './queue';
import {
  QueueDepthExceededError,
  QueueWaitTimedOutError,
  QueueCancelledError,
  ProtocolMismatchError,
  MissingCallContextError,
} from './errorEnvelope';
import { formatToolContent } from './parsers';
import { MCPConnection } from './connection';
import { processMCPEnv } from '~/utils/env';
import { isUserSourced, isOAuthServer } from './utils';

/**
 * SPEC-014 REQ-027 — pinned MCP protocol version literal for the
 * `Microsoft365` server. Re-evaluated as a versioning event on any
 * `@librechat/agents` or MCP SDK upgrade per the spec's "upstream-bump
 * policy".
 *
 * Three-locus pinning (drift fails CI):
 *   1. This constant
 *   2. `librechat.yaml` Microsoft365 entry (REQ-027 comment header)
 *   3. `mcp-m365/VERSION` (`MCP_PROTOCOL_VERSION=` line)
 *
 * `2025-11-25` is the `LATEST_PROTOCOL_VERSION` exported by the installed
 * `@modelcontextprotocol/sdk` and is the version advertised by Softeria
 * 0.110.0 on first connect (verified 2026-05-19 by running the sidecar
 * locally). A mismatch perma-trips the ProtocolMismatch short-circuit and
 * renders Microsoft365 tools unavailable until next deploy — keep all
 * three loci synchronized on every SDK bump.
 */
export const MICROSOFT365_EXPECTED_PROTOCOL_VERSION = '2025-11-25';

/** SPEC-014 — the `mcpServers` key under which the Softeria sidecar lives. */
export const MICROSOFT365_SERVER_NAME = 'Microsoft365';

/**
 * Centralized manager for MCP server connections and tool execution.
 * Extends UserConnectionManager to handle both app-level and user-specific connections.
 */
export class MCPManager extends UserConnectionManager {
  private static instance: MCPManager | null;

  /**
   * SPEC-014 REQ-024 — Per-server `MCPCallQueue` instances. Only the
   * `Microsoft365` server is queued in phase 1; other servers retain their
   * pre-SPEC-014 unbounded behavior.
   */
  private callQueues: Map<string, MCPCallQueue> = new Map();

  /**
   * SPEC-014 REQ-027 — Servers for which a ProtocolMismatch was detected
   * on connect. Short-circuits the circuit-breaker retry loop: subsequent
   * tool calls fail fast with `code: "ProtocolMismatch"` until next deploy
   * or manual reconnect.
   */
  private protocolMismatchServers: Map<string, { expected: string; advertised: string }> =
    new Map();

  /** Creates and initializes the singleton MCPManager instance */
  public static async createInstance(configs: t.MCPServers): Promise<MCPManager> {
    if (MCPManager.instance) throw new Error('MCPManager has already been initialized.');
    MCPManager.instance = new MCPManager();
    await MCPManager.instance.initialize(configs);
    return MCPManager.instance;
  }

  /** Returns the singleton MCPManager instance */
  public static getInstance(): MCPManager {
    if (!MCPManager.instance) throw new Error('MCPManager has not been initialized.');
    return MCPManager.instance;
  }

  /** Initializes the MCPManager by setting up server registry and app connections */
  public async initialize(configs: t.MCPServers): Promise<void> {
    await MCPServersInitializer.initialize(configs);
    this.appConnections = new ConnectionsRepository(undefined);
  }

  /** Retrieves an app-level or user-specific connection based on provided arguments */
  public async getConnection(
    args: {
      serverName: string;
      user?: IUser;
      forceNew?: boolean;
      flowManager?: FlowStateManager<MCPOAuthTokens | null>;
      /** Pre-resolved config for config-source servers not in YAML/DB */
      serverConfig?: t.ParsedServerConfig;
    } & Omit<t.OAuthConnectionOptions, 'useOAuth' | 'user' | 'flowManager'>,
  ): Promise<MCPConnection> {
    //the get method checks if the config is still valid as app level
    const existingAppConnection = await this.appConnections!.get(args.serverName);
    if (existingAppConnection) {
      return existingAppConnection;
    } else if (args.user?.id) {
      return this.getUserConnection(args as Parameters<typeof this.getUserConnection>[0]);
    } else {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `No connection found for server ${args.serverName}`,
      );
    }
  }

  /**
   * Discovers tools from an MCP server, even when OAuth is required.
   * Per MCP spec, tool listing should be possible without authentication.
   * Use this for agent initialization to get tool schemas before OAuth flow.
   */
  public async discoverServerTools(args: t.ToolDiscoveryOptions): Promise<t.ToolDiscoveryResult> {
    const { serverName, user } = args;
    const logPrefix = user?.id ? `[MCP][User: ${user.id}][${serverName}]` : `[MCP][${serverName}]`;

    try {
      const existingAppConnection = await this.appConnections?.get(serverName);
      if (existingAppConnection && (await existingAppConnection.isConnected())) {
        const tools = await existingAppConnection.fetchTools();
        return { tools, oauthRequired: false, oauthUrl: null };
      }
    } catch {
      logger.debug(`${logPrefix} [Discovery] App connection not available, trying discovery mode`);
    }

    const serverConfig = await MCPServersRegistry.getInstance().getServerConfig(
      serverName,
      user?.id,
      args.configServers,
    );

    if (!serverConfig) {
      logger.warn(`${logPrefix} [Discovery] Server config not found`);
      return { tools: null, oauthRequired: false, oauthUrl: null };
    }

    const useOAuth = isOAuthServer(serverConfig);

    const registry = MCPServersRegistry.getInstance();
    const useSSRFProtection = registry.shouldEnableSSRFProtection();
    const allowedDomains = registry.getAllowedDomains();
    const allowedAddresses = registry.getAllowedAddresses();
    const dbSourced = isUserSourced(serverConfig);
    const basic: t.BasicConnectionOptions = {
      dbSourced,
      serverName,
      serverConfig,
      useSSRFProtection,
      allowedDomains,
      allowedAddresses,
    };

    if (!useOAuth) {
      const result = await MCPConnectionFactory.discoverTools(basic, {
        user: args.user,
        customUserVars: args.customUserVars,
        requestBody: args.requestBody,
        connectionTimeout: args.connectionTimeout,
      });
      return {
        tools: result.tools,
        oauthRequired: result.oauthRequired,
        oauthUrl: result.oauthUrl,
      };
    }

    if (!user || !args.flowManager) {
      logger.warn(`${logPrefix} [Discovery] OAuth server requires user and flowManager`);
      return { tools: null, oauthRequired: true, oauthUrl: null };
    }

    const result = await MCPConnectionFactory.discoverTools(basic, {
      user,
      useOAuth: true,
      flowManager: args.flowManager,
      tokenMethods: args.tokenMethods,
      signal: args.signal,
      oauthStart: args.oauthStart,
      customUserVars: args.customUserVars,
      requestBody: args.requestBody,
      connectionTimeout: args.connectionTimeout,
    });

    return { tools: result.tools, oauthRequired: result.oauthRequired, oauthUrl: result.oauthUrl };
  }

  /** Returns all available tool functions from app-level connections */
  public async getAppToolFunctions(): Promise<t.LCAvailableTools> {
    const toolFunctions: t.LCAvailableTools = {};
    const configs = await MCPServersRegistry.getInstance().getAllServerConfigs();
    for (const config of Object.values(configs)) {
      if (config.toolFunctions != null) {
        Object.assign(toolFunctions, config.toolFunctions);
      }
    }
    return toolFunctions;
  }

  /** Returns all available tool functions from all connections available to user */
  public async getServerToolFunctions(
    userId: string,
    serverName: string,
  ): Promise<t.LCAvailableTools | null> {
    try {
      //try get the appConnection (if the config is not in the app level anymore any existing connection will disconnect and get will return null)
      const existingAppConnection = await this.appConnections?.get(serverName);
      if (existingAppConnection) {
        return MCPServerInspector.getToolFunctions(serverName, existingAppConnection);
      }

      const userConnections = this.getUserConnections(userId);
      if (!userConnections || userConnections.size === 0) {
        return null;
      }
      if (!userConnections.has(serverName)) {
        return null;
      }

      return MCPServerInspector.getToolFunctions(serverName, userConnections.get(serverName)!);
    } catch (error) {
      logger.warn(
        `[getServerToolFunctions] Error getting tool functions for server ${serverName}`,
        error,
      );
      return null;
    }
  }

  /**
   * Get instructions for MCP servers
   * @param serverNames Optional array of server names. If not provided or empty, returns all servers.
   * @returns Object mapping server names to their instructions
   */
  private async getInstructions(
    serverNames?: string[],
    configServers?: Record<string, t.ParsedServerConfig>,
  ): Promise<Record<string, string>> {
    const instructions: Record<string, string> = {};
    const configs = await MCPServersRegistry.getInstance().getAllServerConfigs(
      undefined,
      configServers,
    );
    for (const [serverName, config] of Object.entries(configs)) {
      if (config.serverInstructions != null) {
        instructions[serverName] = config.serverInstructions as string;
      }
    }
    if (!serverNames) return instructions;
    return pick(instructions, serverNames);
  }

  /**
   * Format MCP server instructions for injection into context
   * @param serverNames Optional array of server names to include. If not provided, includes all servers.
   * @returns Formatted instructions string ready for context injection
   */
  public async formatInstructionsForContext(
    serverNames?: string[],
    configServers?: Record<string, t.ParsedServerConfig>,
  ): Promise<string> {
    const instructionsToInclude = await this.getInstructions(serverNames, configServers);

    if (Object.keys(instructionsToInclude).length === 0) {
      return '';
    }

    // Format instructions for context injection
    const formattedInstructions = Object.entries(instructionsToInclude)
      .map(([serverName, instructions]) => {
        return `## ${serverName} MCP Server Instructions

${instructions}`;
      })
      .join('\n\n');

    return `# MCP Server Instructions

The following MCP servers are available with their specific instructions:

${formattedInstructions}

Please follow these instructions when using tools from the respective MCP servers.`;
  }

  /**
   * Returns (lazily constructs) the SPEC-014 REQ-024 call queue for the given
   * server name. Phase 1 only constructs a queue for `Microsoft365`; other
   * servers return `undefined` and bypass the queue path entirely.
   */
  private getCallQueueFor(
    serverName: string,
    graphTokenResolver?: GraphTokenResolver,
    user?: IUser,
  ): MCPCallQueue | undefined {
    if (serverName !== MICROSOFT365_SERVER_NAME) return undefined;

    const existing = this.callQueues.get(serverName);
    if (existing) return existing;

    /**
     * Adapt the legacy `GraphTokenResolver` (user, accessToken, scopes) signature
     * to the queue's `QueueGraphTokenResolver` ({ userOpenIdId, scopes }) shape.
     * The legacy resolver internally honors PERF-003 emission-time freshness
     * via `getGraphTokenForEmission` (Subagent 2 wired this inside
     * `GraphTokenService.getGraphApiToken`), so no second freshness check is
     * needed here.
     */
    const queueResolver: QueueGraphTokenResolver | undefined =
      graphTokenResolver && user
        ? async ({ scopes }) => {
            try {
              const tokenResponse = await graphTokenResolver(
                user,
                /** accessToken is unused by the SPEC-014 GraphTokenService path */ '',
                Array.isArray(scopes) ? scopes.join(',') : scopes,
              );
              if (!tokenResponse || !tokenResponse.access_token) return null;
              return `Bearer ${tokenResponse.access_token}`;
            } catch (err) {
              logger.error(
                `[MCP][${serverName}] graphTokenResolver threw during queue dispatch`,
                err,
              );
              throw err;
            }
          }
        : undefined;

    const queue = new MCPCallQueue(serverName, MICROSOFT365_QUEUE_DEFAULTS, queueResolver);
    this.callQueues.set(serverName, queue);
    return queue;
  }

  /**
   * SPEC-014 REQ-027 — Post-connect protocol-version check for `Microsoft365`.
   * Compares the advertised protocol version against the pinned literal and
   * records a ProtocolMismatch on divergence so subsequent tool calls short-
   * circuit rather than re-entering the circuit-breaker reconnect loop.
   */
  public checkMicrosoft365ProtocolVersion(advertised: string | undefined | null): void {
    if (!advertised) return;
    if (advertised === MICROSOFT365_EXPECTED_PROTOCOL_VERSION) return;
    logger.error(
      `[MCP][${MICROSOFT365_SERVER_NAME}] mcp.connect.deterministic_failure`,
      {
        event: 'mcp.connect.deterministic_failure',
        server: MICROSOFT365_SERVER_NAME,
        failure: 'ProtocolMismatch',
        expected: MICROSOFT365_EXPECTED_PROTOCOL_VERSION,
        advertised,
      },
    );
    this.protocolMismatchServers.set(MICROSOFT365_SERVER_NAME, {
      expected: MICROSOFT365_EXPECTED_PROTOCOL_VERSION,
      advertised,
    });
  }

  public getProtocolMismatch(
    serverName: string,
  ): { expected: string; advertised: string } | undefined {
    return this.protocolMismatchServers.get(serverName);
  }

  public clearProtocolMismatch(serverName: string): void {
    this.protocolMismatchServers.delete(serverName);
  }

  /**
   * Calls a tool on an MCP server, using either a user-specific connection
   * (if userId is provided) or an app-level connection. Updates the last activity timestamp
   * for user-specific connections upon successful call initiation.
   *
   * @param graphTokenResolver - Optional function to resolve Graph API tokens via OBO flow.
   *   When provided and the server config contains `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` placeholders,
   *   they will be resolved to actual Graph API tokens before the tool call.
   */
  async callTool({
    user,
    serverName,
    serverConfig: providedConfig,
    toolName,
    provider,
    toolArguments,
    options,
    tokenMethods,
    requestBody,
    flowManager,
    oauthStart,
    oauthEnd,
    customUserVars,
    graphTokenResolver,
  }: {
    user?: IUser;
    serverName: string;
    /** Pre-resolved config from tool creation context — avoids readThrough TTL and cross-tenant issues */
    serverConfig?: t.ParsedServerConfig;
    toolName: string;
    provider: t.Provider;
    toolArguments?: Record<string, unknown>;
    options?: RequestOptions;
    requestBody?: RequestBody;
    tokenMethods?: TokenMethods;
    customUserVars?: Record<string, string>;
    flowManager: FlowStateManager<MCPOAuthTokens | null>;
    oauthStart?: (authURL: string) => Promise<void>;
    oauthEnd?: () => Promise<void>;
    graphTokenResolver?: GraphTokenResolver;
  }): Promise<t.FormattedToolResponse> {
    /** User-specific connection */
    let connection: MCPConnection | undefined;
    const userId = user?.id;
    const logPrefix = userId ? `[MCP][User: ${userId}][${serverName}]` : `[MCP][${serverName}]`;

    /**
     * SPEC-014 REQ-027 — short-circuit: if a ProtocolMismatch was previously
     * recorded for this server, fail fast without re-entering the connection
     * or circuit-breaker path.
     */
    const protocolMismatch = this.getProtocolMismatch(serverName);
    if (protocolMismatch) {
      throw new ProtocolMismatchError(protocolMismatch.expected, protocolMismatch.advertised);
    }

    try {
      if (userId && user) this.updateUserLastActivity(userId);

      connection = await this.getConnection({
        serverName,
        user,
        flowManager,
        tokenMethods,
        oauthStart,
        oauthEnd,
        signal: options?.signal,
        customUserVars,
        requestBody,
        serverConfig: providedConfig,
      });

      if (!(await connection.isConnected())) {
        /** May happen if getUserConnection failed silently or app connection dropped */
        throw new McpError(
          ErrorCode.InternalError, // Use InternalError for connection issues
          `${logPrefix} Connection is not active. Cannot execute tool ${toolName}.`,
        );
      }

      const rawConfig =
        providedConfig ??
        (await MCPServersRegistry.getInstance().getServerConfig(serverName, userId));
      if (!rawConfig) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `${logPrefix} Configuration for server "${serverName}" not found.`,
        );
      }
      const isDbSourced = isUserSourced(rawConfig);

      /** Pre-process Graph token placeholders (async) before the synchronous processMCPEnv pass */
      const graphProcessedConfig = isDbSourced
        ? (rawConfig as t.MCPOptions)
        : await preProcessGraphTokens(rawConfig as t.MCPOptions, {
            user,
            graphTokenResolver,
            scopes: process.env.GRAPH_API_SCOPES,
          });
      const currentOptions = processMCPEnv({
        user,
        body: requestBody,
        dbSourced: isDbSourced,
        options: graphProcessedConfig,
        customUserVars,
      });
      /**
       * SPEC-014 MEDIUM-4 fix — per-call header isolation. We compute the
       * desired headers here but apply them INSIDE the executor with a
       * try/finally restoration so concurrent calls on a shared connection
       * (REQ-007's per-call Bearer model) cannot leak one user's
       * Authorization header onto another user's outbound request. The
       * MCP SDK currently surfaces headers only via `connection.setRequestHeaders`;
       * if a future SDK version accepts per-call `headers` in `client.request`,
       * pass them there and remove this dance.
       */
      const callHeaders =
        'headers' in currentOptions ? (currentOptions.headers ?? null) : null;

      /**
       * SPEC-014 REQ-027 — opportunistic post-connect protocol-version
       * check for `Microsoft365`. The MCP SDK's `getServerVersion()`
       * surfaces the advertised initialize-result fields; we cross-check
       * against the pinned literal and short-circuit the circuit-breaker
       * loop on divergence.
       */
      if (serverName === MICROSOFT365_SERVER_NAME && !this.getProtocolMismatch(serverName)) {
        const serverInfo = (connection.client as unknown as {
          getServerVersion?: () => { name?: string; version?: string; protocolVersion?: string } | undefined;
        }).getServerVersion?.();
        const advertised =
          (serverInfo as { protocolVersion?: string } | undefined)?.protocolVersion ?? null;
        this.checkMicrosoft365ProtocolVersion(advertised);
        const postCheck = this.getProtocolMismatch(serverName);
        if (postCheck) {
          throw new ProtocolMismatchError(postCheck.expected, postCheck.advertised);
        }
      }

      /**
       * SPEC-014 REQ-024 — route Microsoft365 tool calls through the queue
       * (in-flight cap + bounded FIFO + cascading-timeout discipline). Other
       * servers bypass the queue and call directly as before.
       */
      const callQueue = this.getCallQueueFor(serverName, graphTokenResolver, user);
      const callConnection = connection;
      const callRunner = async (): Promise<t.FormattedToolResponse> => {
        /**
         * MEDIUM-4 fix — apply headers JUST before `client.request` and
         * restore the previous headers in a finally block so per-call
         * Authorization state cannot leak across users sharing a connection.
         */
        const previousHeaders = callConnection.getRequestHeaders();
        if (callHeaders) callConnection.setRequestHeaders(callHeaders);
        try {
          const result = await callConnection.client.request(
            {
              method: 'tools/call',
              params: {
                name: toolName,
                arguments: toolArguments,
              },
            },
            CallToolResultSchema,
            {
              timeout: callConnection.timeout,
              resetTimeoutOnProgress: true,
              ...options,
            },
          );
          if (userId) this.updateUserLastActivity(userId);
          this.checkIdleConnections();
          return formatToolContent(result as t.MCPToolCallResponse, provider);
        } finally {
          callConnection.setRequestHeaders(previousHeaders ?? {});
        }
      };

      if (callQueue && user && requestBody) {
        /**
         * SPEC-014 REQ-023 — required call-context fields. Previously these
         * fell through to the literal `'unknown'`, which poisoned correlation
         * IDs (`unknown:unknown:tool-...`) and collapsed the per-user cap
         * across anonymous-context callers (covert capacity-attack vector).
         * Throw a typed `MissingCallContextError` instead — the caller maps
         * it to `code: "UpstreamUnavailable"` with the field name in the
         * envelope message. `toolCallId` retains its synthetic fallback
         * because MCP does not always supply one.
         */
        const rawUserId = user.id ?? user.openidId;
        if (!rawUserId) {
          logger.warn(`${logPrefix} mcp.callTool.missing_context`, { field: 'userId' });
          throw new MissingCallContextError('userId');
        }
        const rawConversationId = (requestBody as Partial<{ conversationId: string }>)
          .conversationId;
        if (!rawConversationId) {
          logger.warn(`${logPrefix} mcp.callTool.missing_context`, { field: 'conversationId' });
          throw new MissingCallContextError('conversationId');
        }
        /**
         * SPEC-014 REQ-023 — `requestBody.messageId` is the canonical field name
         * set by `api/server/controllers/agents/client.js` (configurable.requestBody
         * literal: `{ messageId, conversationId, parentMessageId }`). Verified
         * against the agent-loop call site; do not reintroduce a typo-defended
         * fallback chain.
         */
        const rawMessageId = (requestBody as Partial<{ messageId: string }>).messageId;
        if (!rawMessageId) {
          logger.warn(`${logPrefix} mcp.callTool.missing_context`, { field: 'messageId' });
          throw new MissingCallContextError('messageId');
        }
        /**
         * MCP does not guarantee a `__toolCallId` in tool arguments — the
         * synthetic fallback is retained so we always have a deterministic
         * suffix on the correlation ID.
         */
        const toolCallId =
          (toolArguments as Partial<{ __toolCallId: string }> | undefined)?.__toolCallId ??
          `${toolName}-${Date.now()}`;
        return callQueue.enqueue(
          {
            userId: rawUserId,
            userOpenIdId: user.openidId ?? rawUserId,
            conversationId: rawConversationId,
            messageId: rawMessageId,
            toolCallId,
            scopes: process.env.OPENID_GRAPH_SCOPES ?? '',
            abortSignal: options?.signal,
          },
          async () => callRunner(),
        );
      }

      return await callRunner();
    } catch (error) {
      /**
       * SPEC-014 — surface known queue/protocol error classes with a
       * structured marker so the caller layer (`api/server/services/MCP.js`
       * and `createMCPTool`) can map them to the Error Response Schema.
       * The actual envelope is built downstream; here we only log.
       */
      if (
        error instanceof QueueDepthExceededError ||
        error instanceof QueueWaitTimedOutError ||
        error instanceof QueueCancelledError ||
        error instanceof ProtocolMismatchError ||
        error instanceof MissingCallContextError
      ) {
        logger.warn(`${logPrefix}[${toolName}] Tool call rejected by queue/protocol guard`, error);
      } else {
        logger.error(`${logPrefix}[${toolName}] Tool call failed`, error);
      }
      throw error;
    }
  }
}
