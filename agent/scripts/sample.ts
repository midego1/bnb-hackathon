/** Demo request: the seeded scooter rental's pickup photos (web/public/demo) vs a return where the left side changed. */
export const SAMPLE_REQUEST = {
  deposit: "200000000", // 200 MockUSDT (6 decimals), about 6,800 THB
  decimals: 6,
  currency: "USDT",
  checkIn: [
    { hash: "0x1f06423c9595d4c1551d74f98bf1cf8aa31194d1890ee52372a42547b7cfc04d", label: "Front" },
    { hash: "0x0ed1356fb1939317cd49fd1926013b29cc665f31ebafdd017ec43982eb9059ce", label: "Left side" },
    { hash: "0xd6921c1914ea1cdcc49d4dd105dbc56fe5180c6fdcdc840ea9b00ea75c0780bf", label: "Plate close-up" },
  ],
  checkOut: [
    { hash: "0x1f06423c9595d4c1551d74f98bf1cf8aa31194d1890ee52372a42547b7cfc04d", label: "Front" },
    // sha256("KeyEscrow demo return: left side (scratched)"): a photo that does not match pickup
    { hash: "0xdaa4d7bb530ffaa089eea016fb736e0532c483b0ac0d2b15509bd239f14b3585", label: "Left side" },
    { hash: "0xd6921c1914ea1cdcc49d4dd105dbc56fe5180c6fdcdc840ea9b00ea75c0780bf", label: "Plate close-up" },
  ],
  notes: "Renter says the left side panel was already scratched at pickup.",
};

export const AGENT_URL = (process.env.AGENT_URL || `http://127.0.0.1:${process.env.AGENT_PORT || "8790"}`).replace(/\/+$/, "");
