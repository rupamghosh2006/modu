export const ALGORAND_TESTNET_USDC_ASA_ID = '10458941';
export const ALGORAND_MAINNET_USDC_ASA_ID = '31566704';
export const ALGORAND_ALGO_ASSET_ID = '0';

// CAIP-2 network identifiers (official x402 v2 standard)
export const ALGORAND_TESTNET_CAIP2 = 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=';
export const ALGORAND_MAINNET_CAIP2 = 'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=';

// Legacy V1 network identifiers (maintained for backwards compatibility)
export const DEFAULT_NETWORK = 'algorand-testnet';
export const DEFAULT_INDEXER_URL = 'https://testnet-idx.algonode.cloud';
export const DEFAULT_FACILITATOR_URL = 'https://facilitator.goplausible.xyz';

export const DEFAULT_CONTROL_PLANE_URL = 'https://modu-to68.onrender.com';
export const DEFAULT_PROXY_URL = 'https://modu-proxy.onrender.com';

export const DECIMALS: Record<string, number> = {
  USDC: 6,
  ALGO: 6,
};

export const X402_VERSION = 2;
export const X402_VERSION_V1 = 1;
export const DEFAULT_CHALLENGE_TIMEOUT_SECONDS = 300; // 5 minutes

