export type AssetType = 'USDC' | 'ALGO';

export interface PaymentAccept {
  scheme: 'exact';
  network: 'algorand-testnet' | 'algorand-mainnet';
  maxAmountRequired: string; // in micro-units (e.g. 10000 = 0.01 USDC)
  asset: string; // ASA ID string or "0" for ALGO
  payTo: string; // Algorand address
  resource: string; // URL being accessed
  description: string;
  maxTimeoutSeconds: number;
  nonce?: string;
}

export interface X402Challenge {
  x402Version: number;
  accepts: PaymentAccept[];
}

export interface PaymentReceipt {
  status: 'settled';
  txid: string;
  payer: string;
  amount: string;
  asset: string;
  timestamp: string;
}

export interface Endpoint {
  id: string;
  slug: string;
  originUrl: string;
  price: string; // standard unit decimal string (e.g. "0.01")
  asset: AssetType;
  isActive: boolean;
  payoutAddress: string;
  accountId: string;
  createdAt: string;
  updatedAt: string;
  proxyUrl?: string;
}

export interface RequestLog {
  id: string;
  endpointId: string;
  timestamp: string;
  payerAddress: string;
  txid: string;
  amount: string; // micro-units
  status: number;
  latencyMs: number;
}

export interface DailyRevenue {
  date: string;
  amount: string;
  requests: number;
}

export interface TopPayer {
  address: string;
  requests: number;
  totalAmount: string;
}

export interface EndpointStats {
  endpointId: string;
  totalRequests: number;
  paidRequests: number;
  totalRevenue: string; // standard units
  revenueToday: string; // standard units
  requestsToday: number;
  revenueByDay: DailyRevenue[];
  topPayers: TopPayer[];
}

export interface EndpointSummary {
  id: string;
  slug: string;
  proxyUrl: string;
  originUrl: string;
  price: string;
  asset: AssetType;
  requestsToday: number;
  revenueToday: string;
  isActive: boolean;
}

export interface Account {
  id: string;
  email?: string;
  payoutAddress?: string;
  apiKey: string;
  createdAt: string;
}

export interface CliTokenResponse {
  token: string;
  authUrl: string;
  pollUrl: string;
}

export interface CliPollResponse {
  status: 'pending' | 'claimed' | 'expired';
  apiKey?: string;
  payoutAddress?: string;
}

export interface RegisterEndpointDto {
  originUrl: string;
  price: string | number;
  asset: AssetType;
  path?: string;
}

export interface RegisterEndpointResponse {
  endpointId: string;
  slug: string;
  proxyUrl: string;
  originUrl: string;
  price: string;
  asset: AssetType;
  payoutAddress: string;
}

export interface CliConfig {
  apiKey?: string;
  controlPlaneUrl?: string;
  proxyUrl?: string;
  payoutAddress?: string;
}
