import { getAddress, hexToString, isAddress, parseAbi } from "viem";

/** Metadata key on the ERC-8004 identity that names the address allowed to sign inspection reports. */
export const REPORT_SIGNER_KEY = "reportSigner";

/** The read side of the ERC-8004 Identity Registry used by our scripts (the SDK carries the full ABI). */
export const IDENTITY_REGISTRY_ABI = parseAbi([
  "function name() view returns (string)",
  "function getVersion() view returns (string)",
  "function ownerOf(uint256 agentId) view returns (address)",
  "function tokenURI(uint256 agentId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)",
]);

/**
 * Decode the `reportSigner` metadata value. The SDK encodes metadata values with viem `toBytes`, which turns a 0x hex
 * string into its raw bytes, so an address is stored as 20 bytes; a UTF-8 "0x…" string is accepted too.
 */
export function decodeReportSigner(value: `0x${string}`): `0x${string}` | null {
  if (value.length === 42) return getAddress(value);
  try {
    const text = hexToString(value);
    return isAddress(text) ? getAddress(text) : null;
  } catch {
    return null;
  }
}
