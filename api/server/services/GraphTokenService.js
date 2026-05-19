const client = require('openid-client');
const { logger } = require('@librechat/data-schemas');
const { CacheKeys } = require('librechat-data-provider');
const {
  buildCacheKey,
  runOboWithSingleFlightAndRetry,
  getGraphTokenForEmission,
  EMISSION_TOKEN_MIN_TTL_MS,
} = require('@librechat/api');
const { getOpenIdConfig } = require('~/strategies/openidStrategy');
const getLogStores = require('~/cache/getLogStores');

/**
 * Get a Microsoft Graph API token via OBO exchange.
 *
 * Implements SPEC-014:
 *  - REQ-021: single-flight coalescing of concurrent OBO requests per cache key
 *  - REQ-022: scope cache-key normalization (trim/lowercase/dedup/sort)
 *  - PERF-003: post-dequeue emission-time freshness re-check (≥60s remaining)
 *
 * Returns null when the user has no Entra session (local-auth user). Callers
 * upstream MUST treat null as REQ-015 / Error Schema `Unauthenticated` and
 * OMIT the `Authorization` header entirely — never emit `Bearer ` with an
 * empty value.
 *
 * @param {Object} user - User object with OpenID information
 * @param {string} accessToken - Federated access token used as OBO assertion
 * @param {string|string[]} scopes - Graph API scopes for the token
 * @param {boolean} fromCache - Whether to try getting token from cache first
 * @returns {Promise<Object|null>} Graph API token response with access_token and expires_in
 */
async function getGraphApiToken(user, accessToken, scopes, fromCache = true) {
  if (!user || !user.openidId) {
    logger.debug('[GraphTokenService] No openidId on user; returning null (Unauthenticated path)');
    return null;
  }

  if (!accessToken) {
    throw new Error('Access token is required for token exchange');
  }

  if (!scopes) {
    throw new Error('Graph API scopes are required for token exchange');
  }

  const config = getOpenIdConfig();
  if (!config) {
    throw new Error('OpenID configuration not available');
  }

  const cacheKey = buildCacheKey(user.openidId, scopes);
  const tokensCache = getLogStores(CacheKeys.OPENID_EXCHANGED_TOKENS);
  const scopeArg = Array.isArray(scopes) ? scopes.join(' ') : scopes;

  const refresh = async () =>
    runOboWithSingleFlightAndRetry(cacheKey, async () => {
      logger.debug(`[GraphTokenService] Requesting new Graph API token for user: ${user.openidId}`);
      logger.debug(`[GraphTokenService] Requested scopes: ${scopeArg}`);

      const grantResponse = await client.genericGrantRequest(
        config,
        'urn:ietf:params:oauth:grant-type:jwt-bearer',
        {
          scope: scopeArg,
          assertion: accessToken,
          requested_token_use: 'on_behalf_of',
        },
      );

      const expiresIn = grantResponse.expires_in || 3600;
      const tokenResponse = {
        access_token: grantResponse.access_token,
        token_type: 'Bearer',
        expires_in: expiresIn,
        scope: scopeArg,
        acquired_at: Date.now(),
      };

      await tokensCache.set(cacheKey, tokenResponse, expiresIn * 1000);

      logger.debug(`[GraphTokenService] Cached fresh Graph API token for user: ${user.openidId}`);
      return tokenResponse;
    });

  try {
    if (!fromCache) {
      return await refresh();
    }

    const cached = await tokensCache.get(cacheKey);
    return await getGraphTokenForEmission(cached, refresh);
  } catch (error) {
    logger.error(
      `[GraphTokenService] Failed to acquire Graph API token for user ${user.openidId}:`,
      error,
    );
    throw new Error(`Graph token acquisition failed: ${error.message}`);
  }
}

module.exports = {
  getGraphApiToken,
  EMISSION_TOKEN_MIN_TTL_MS,
};
