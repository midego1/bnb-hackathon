/** Demo request: the seeded lease's check-in photos (web/public/demo) vs a check-out where the kitchen changed. */
export const SAMPLE_REQUEST = {
  deposit: "500000000", // 500 MockUSDT (6 decimals)
  decimals: 6,
  currency: "USDT",
  checkIn: [
    { hash: "0xd36ac8ce53abda4fd2c02158942f6a5bb5aa16c506526090b5e2298350254f2f", label: "Living room" },
    { hash: "0x06b89f7c70f55cc894e0fd8802a8c082dd1cc55e36a26ffbb79f395d09ef694a", label: "Kitchen" },
    { hash: "0x67896c84005631763c65184350cf864ac5296b15424975fc09facaa200bfb975", label: "Bedroom" },
  ],
  checkOut: [
    { hash: "0xd36ac8ce53abda4fd2c02158942f6a5bb5aa16c506526090b5e2298350254f2f", label: "Living room" },
    // sha256("KeyEscrow demo check-out: kitchen (changed)"): a photo that does not match check-in
    { hash: "0xca6dc94df8ff30c94cba4f915230b25c025d8f43081af2ea48192ec725d07012", label: "Kitchen" },
    { hash: "0x67896c84005631763c65184350cf864ac5296b15424975fc09facaa200bfb975", label: "Bedroom" },
  ],
  notes: "Tenant says the oven was already scratched at check-in.",
};

export const AGENT_URL = (process.env.AGENT_URL || `http://127.0.0.1:${process.env.AGENT_PORT || "8790"}`).replace(/\/+$/, "");
