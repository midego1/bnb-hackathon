// The Cloudflare Workers build (scripts/cf.mjs) resolves @bnb-chain/greenfield-js-sdk to this stub: the SDK
// (cosmjs, protobuf types, libsodium) is ~5 MiB and Workers store evidence in R2 instead (lib/server/evidence).
const unavailable = () => {
  throw new Error("BNB Greenfield is not available in the Cloudflare Workers build; bind the EVIDENCE R2 bucket instead");
};
export const Client = { create: unavailable };
export const VisibilityType = {};
