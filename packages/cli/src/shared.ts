export type AssetType = 'USDC' | 'ALGO';

export const DEFAULT_CONTROL_PLANE_URL = 'https://modu-to68.onrender.com';
export const DEFAULT_PROXY_URL = 'https://modu-proxy.onrender.com';

export interface CliConfig {
  apiKey?: string;
  controlPlaneUrl?: string;
  proxyUrl?: string;
  payoutAddress?: string;
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

export interface RequestLog {
  id: string;
  endpointId: string;
  timestamp: string;
  payerAddress: string;
  txid: string;
  amount: string;
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
  totalRevenue: string;
  revenueToday: string;
  requestsToday: number;
  revenueByDay: DailyRevenue[];
  topPayers: TopPayer[];
}
