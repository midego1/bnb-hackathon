import { describe, expect, it, vi } from "vitest";

// A build for an 18-decimal stablecoin (BSC-USD on BSC mainnet): every amount helper follows the deployment's decimals.
vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "56");
vi.mock("@/lib/contracts/deployments.generated.json", () => ({
  default: {
    "56": {
      escrowFactory: "0x00000000000000000000000000000000000000f1",
      mockUsdt: "0x55d398326f99059fF775485246999027B3197955",
      fromBlock: 0,
      tokenDecimals: 18,
      tokenSymbol: "USDT",
    },
  },
}));

describe("18-decimal token", () => {
  it("parses, formats and prices amounts with 18 decimals", async () => {
    const { TOKEN, parseTokenAmount, formatToken } = await import("@/lib/actions/fields");
    const { usdtNumber } = await import("@/lib/format");
    const { toFiat } = await import("@/lib/fiat");
    expect(TOKEN).toEqual({ symbol: "USDT", decimals: 18 });
    const hundred = BigInt(10) ** BigInt(20);
    expect(parseTokenAmount("100")).toBe(hundred);
    expect(parseTokenAmount("0.000000000000000001")).toBe(BigInt(1));
    expect(parseTokenAmount("0.0000000000000000001")).toBeUndefined();
    expect(formatToken(hundred + hundred / BigInt(200))).toBe("100.50 USDT");
    expect(usdtNumber(hundred)).toBe(100);
    const prices = { rates: { USDT: { THB: 33, USD: 1 }, BNB: { THB: 0, USD: 0 } } } as never;
    expect(toFiat(hundred, "USDT", "THB", prices)).toBe(3300);
  });
});
