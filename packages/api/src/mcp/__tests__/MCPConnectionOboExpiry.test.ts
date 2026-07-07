/**
 * Unit tests for MCPConnection.isOboTokenNearExpiry.
 *
 * OBO (On-Behalf-Of) tokens are baked into the transport at connect time and
 * carry no refresh token, so a reused connection must be rebuilt before its
 * token expires rather than handed back to 401 mid-request. This getter is the
 * signal the connection manager uses to decide when to rebuild.
 */

import { MCPConnection } from '~/mcp/connection';
import type { MCPOAuthTokens } from '~/mcp/oauth/types';
import type * as t from '~/mcp/types';

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('~/auth', () => ({
  createSSRFSafeUndiciConnect: jest.fn(() => undefined),
  isOAuthUrlAllowed: jest.fn(() => false),
  isSSRFTarget: jest.fn(() => false),
  resolveHostnameSSRF: jest.fn(async () => false),
}));

jest.mock('~/mcp/mcpConfig', () => ({
  mcpConfig: {
    TOOLS_LIST_MAX_PAGES: 3,
    TOOLS_LIST_MAX_TOOLS: 1000,
    TOOLS_LIST_MAX_BYTES: 5 * 1024 * 1024,
    TOOLS_LIST_TIMEOUT_MS: 30000,
    CONNECTION_CHECK_TTL: 0,
  },
}));

const FIVE_MINUTES = 5 * 60 * 1000;

function createConnection(
  serverConfig: t.MCPOptions,
  oauthTokens?: MCPOAuthTokens | null,
): MCPConnection {
  return new MCPConnection({
    serverName: 'obo-expiry-test',
    serverConfig,
    useSSRFProtection: false,
    oauthTokens,
  });
}

const oboConfig: t.MCPOptions = {
  type: 'streamable-http',
  url: 'http://localhost/mcp',
  obo: { scopes: 'User.Read Mail.Read' },
};

const nonOboConfig: t.MCPOptions = {
  type: 'streamable-http',
  url: 'http://localhost/mcp',
};

const makeTokens = (expiresAt: number): MCPOAuthTokens => ({
  access_token: 'graph-token',
  token_type: 'Bearer',
  obtained_at: Date.now(),
  expires_at: expiresAt,
});

describe('MCPConnection.isOboTokenNearExpiry', () => {
  it('returns true when an OBO token is within the default skew window', () => {
    const conn = createConnection(oboConfig, makeTokens(Date.now() + 2 * 60 * 1000));
    expect(conn.isOboTokenNearExpiry()).toBe(true);
  });

  it('returns true when an OBO token is already expired', () => {
    const conn = createConnection(oboConfig, makeTokens(Date.now() - 1000));
    expect(conn.isOboTokenNearExpiry()).toBe(true);
  });

  it('returns false when an OBO token is comfortably in the future', () => {
    const conn = createConnection(oboConfig, makeTokens(Date.now() + 30 * 60 * 1000));
    expect(conn.isOboTokenNearExpiry()).toBe(false);
  });

  it('returns false for a non-OBO connection even if its token is near expiry', () => {
    const conn = createConnection(nonOboConfig, makeTokens(Date.now() + 1000));
    expect(conn.isOboTokenNearExpiry()).toBe(false);
  });

  it('returns false for an OBO connection with no token', () => {
    const conn = createConnection(oboConfig, null);
    expect(conn.isOboTokenNearExpiry()).toBe(false);
  });

  it('returns false for an OBO token missing expires_at', () => {
    const conn = createConnection(oboConfig, {
      access_token: 'graph-token',
      token_type: 'Bearer',
    });
    expect(conn.isOboTokenNearExpiry()).toBe(false);
  });

  it('honors a custom skew window', () => {
    const conn = createConnection(oboConfig, makeTokens(Date.now() + 10 * 60 * 1000));
    expect(conn.isOboTokenNearExpiry(FIVE_MINUTES)).toBe(false);
    expect(conn.isOboTokenNearExpiry(15 * 60 * 1000)).toBe(true);
  });

  it('normalizes a seconds-based expires_at defensively', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const conn = createConnection(oboConfig, makeTokens(nowSeconds + 120));
    expect(conn.isOboTokenNearExpiry()).toBe(true);
  });

  it('reflects a refreshed token set via setOAuthTokens', () => {
    const conn = createConnection(oboConfig, makeTokens(Date.now() + 1000));
    expect(conn.isOboTokenNearExpiry()).toBe(true);
    conn.setOAuthTokens(makeTokens(Date.now() + 60 * 60 * 1000));
    expect(conn.isOboTokenNearExpiry()).toBe(false);
  });
});
