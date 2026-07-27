/**
 * SnapTrade client.
 *
 * The SDK was bumped to v11 to drop a transitively pinned axios 1.16.1 (ten
 * advisories, one high, none fixable by `npm audit fix` — v11 is the first
 * release on axios >= 1.18.0). v11's only breaking change that reaches this
 * codebase is the constructor: credentials now go through an explicit auth
 * mode instead of sitting at the top level. Every `snaptrade.*` call site is
 * unchanged.
 */
import { Snaptrade, SnaptradeAuth } from "snaptrade-typescript-sdk";

export const snaptrade = new Snaptrade({
  auth: SnaptradeAuth.commercialApiKey({
    clientId: process.env.SNAPTRADE_CLIENT_ID!,
    consumerKey: process.env.SNAPTRADE_CONSUMER_KEY!,
  }),
});
