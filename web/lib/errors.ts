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
  TimeoutNotApplicable: "The timeout only applies to a proposal made by the renter.",
  NothingToRelease: "There is no funded rent due for release right now.",
  TermFullyFunded: "All months of the rental term are already paid.",
  TransferShortfall: "The token transfer came up short.",
  ZeroAddress: "An address is missing.",
  RolesNotDistinct: "Owner, renter and arbiter must be three different addresses.",
  InvalidTerm: "The term must be between 1 and 60 months.",
  InvalidResponseWindow: "The response window must be between 1 and 60 days.",
  ERC20InsufficientAllowance: "Approve the USDT amount first.",
  ERC20InsufficientBalance: "Not enough USDT in this wallet. Use the test faucet on anvil.",
  FaucetLimitExceeded: "The faucet gives at most 10,000 test USDT per request.",
};

/** Turns any wallet/RPC/contract error into a sentence a renter or owner can act on. */
export function friendlyError(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return "You cancelled the request in your wallet.";
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && plain[name]) return plain[name];
      if (name) return `The contract rejected this: ${name}.`;
      if (revert.reason) return `The contract rejected this: ${revert.reason}`;
    }
    const msg = err.shortMessage || err.message;
    if (/insufficient funds/i.test(msg)) return "This wallet does not have enough gas (BNB) to send the transaction.";
    if (/fetch|network|ECONNREFUSED|HTTP request failed/i.test(msg))
      return "Could not reach the blockchain node. Check that the RPC is running.";
    return msg;
  }
  if (err instanceof Error) {
    if (/user rejected|denied/i.test(err.message)) return "You cancelled the request in your wallet.";
    return err.message;
  }
  return "Something went wrong.";
}

/** The plain sentence for a contract custom error (by name), shared with the agent tools in lib/actions. */
export function contractErrorReason(errorName: string): string | undefined {
  return plain[errorName];
}
