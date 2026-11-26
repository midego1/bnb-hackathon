import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

const plain: Record<string, string> = {
  Unauthorized: "This wallet is not allowed to do that on this rental. Switch to the right account.",
  InvalidStatus: "The rental is not in the right state for this action anymore. Refresh and check its status.",
  InvalidAmount: "That amount is not valid for this rental.",
  InvalidNonce: "The proposal changed while you were reviewing it. Read the new proposal and try again.",
  ProposerCannotAccept: "You made this proposal, so the other party has to accept it.",
  TimeoutNotReached: "The deadline has not been reached yet.",
  ArbiterDeadlinePassed: "The arbiter's deadline has passed. The dispute can now only be closed by the fallback (full deposit to the renter).",
  InvalidArbiterWindow: "The arbiter window must be between 1 and 90 days.",
  ResponseWindowClosed: "The owner's reply window on the renter's proposal has closed. The rental can now only be closed by the timeout (full deposit to the renter).",
  SharesLocked: "Fleet shares stay locked for 7 days after your latest deposit. Income can still be claimed.",
  TimeoutNotApplicable: "The timeout only applies to a proposal made by the renter.",
  NothingToRelease: "There is no funded rent due for release right now.",
  TermFullyFunded: "All months of the rental term are already paid.",
  TransferShortfall: "The token transfer came up short.",
  ZeroAddress: "An address is missing.",
  RolesNotDistinct: "Owner, renter and arbiter must be three different addresses, and the payee cannot be the renter or the arbiter.",
  InvalidTerm: "The term must be between 1 and 60 rent periods.",
  InvalidRentPeriod: "Rent is paid every 7, 14 or 30 days.",
  InvalidResponseWindow: "The response window must be between 1 and 60 days.",
  ERC20InsufficientAllowance: "Approve the USDT amount first.",
  ERC20InsufficientBalance: "Not enough USDT in this wallet. Use the test faucet on anvil.",
  FaucetLimitExceeded: "The faucet gives at most 10,000 test USDT per request.",
  DepositAboveCap: "Pilot limit: this deposit is above KeyScrow's maximum per rental. Lower it.",
  RentAboveCap: "Pilot limit: this rent is above KeyScrow's maximum per rent period. Lower it.",
  ActiveValueAboveCap: "Pilot limit: KeyScrow already holds as much as the pilot allows. Try again once other rentals have settled.",
};

const general = {
  cancelled: "You cancelled the request in your wallet.",
  rejected: (what: string) => `The contract rejected this: ${what}`,
  gas: "This wallet does not have enough gas (BNB) to send the transaction.",
  rpc: "Could not reach the blockchain node. Check that the RPC is running.",
  unknown: "Something went wrong.",
};

/** The sentences friendlyError picks from; Chinese in errors.zh.ts (client code only, so API routes stay English). */
export const EN_ERRORS = { plain, general };
export type ErrorText = typeof EN_ERRORS;

/** Turns any wallet/RPC/contract error into a sentence a renter or owner can act on (English unless given `text`). */
export function friendlyError(err: unknown, text: ErrorText = EN_ERRORS): string {
  const { plain: named, general: g } = text;
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return g.cancelled;
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && named[name]) return named[name];
      if (name) return g.rejected(`${name}.`);
      if (revert.reason) return g.rejected(revert.reason);
    }
    const msg = err.shortMessage || err.message;
    if (/insufficient funds/i.test(msg)) return g.gas;
    if (/fetch|network|ECONNREFUSED|HTTP request failed/i.test(msg)) return g.rpc;
    return msg;
  }
  if (err instanceof Error) {
    if (/user rejected|denied/i.test(err.message)) return g.cancelled;
    return err.message;
  }
  return g.unknown;
}

/** The plain sentence for a contract custom error (by name), shared with the agent tools in lib/actions. */
export function contractErrorReason(errorName: string): string | undefined {
  return plain[errorName];
}
