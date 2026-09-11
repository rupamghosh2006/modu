import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  Account,
  Endpoint,
  EndpointStats,
  RequestLog,
  AssetType,
  fromBaseUnits,
  toBaseUnits,
} from '@modu/shared';

export interface CliSessionRecord {
  id: string;
  token: string;
  claimed: boolean;
  accountId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface EndpointRecord {
  id: string;
  slug: string;
  originUrl: string;
  price: string;
  asset: AssetType;
  isActive: boolean;
  accountId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RequestLogRecord {
  id: string;
  endpointId: string;
  payerAddress: string;
  txid: string;
  amount: string; // in micro-units
  status: number;
  latencyMs: number;
  timestamp: Date;
}

export interface DataStore {
  createAccount(email?: string, payoutAddress?: string): Promise<Account>;
  getAccountById(id: string): Promise<Account | null>;
  getAccountByApiKey(apiKey: string): Promise<Account | null>;
  updatePayoutAddress(accountId: string, payoutAddress: string): Promise<Account>;
  
  createCliSession(token: string, expiresAt: Date): Promise<CliSessionRecord>;
  getCliSession(token: string): Promise<CliSessionRecord | null>;
  claimCliSession(token: string, accountId: string): Promise<CliSessionRecord>;

  createEndpoint(data: {
    accountId: string;
    slug: string;
    originUrl: string;
    price: string;
    asset: AssetType;
  }): Promise<EndpointRecord>;
  getEndpointsByAccount(accountId: string): Promise<EndpointRecord[]>;
  getEndpointById(id: string): Promise<EndpointRecord | null>;
  getEndpointBySlug(slug: string): Promise<EndpointRecord | null>;
  revokeEndpoint(id: string, accountId: string): Promise<boolean>;

  createRequestLog(data: {
    endpointId: string;
    payerAddress: string;
    txid: string;
    amount: string;
    status: number;
    latencyMs: number;
  }): Promise<RequestLogRecord>;
  getLogs(endpointId: string, limit?: number): Promise<RequestLogRecord[]>;
  getStats(endpointId: string): Promise<EndpointStats>;

  saveNonce(nonce: string, endpointId: string, expiresAt: Date): Promise<void>;
  claimNonce(nonce: string): Promise<string | null>; // returns endpointId if valid & not previously claimed
  isTxidSpent(txid: string): Promise<boolean>;
  recordSpentTxid(txid: string, endpointId: string): Promise<void>;
}

export class MemoryDataStore implements DataStore {
  private accounts = new Map<string, Account>();
  private apiKeys = new Map<string, string>(); // apiKey -> accountId
  private cliSessions = new Map<string, CliSessionRecord>(); // token -> session
  private endpoints = new Map<string, EndpointRecord>(); // id -> endpoint
  private slugToId = new Map<string, string>(); // slug -> id
  private logs: RequestLogRecord[] = [];
  private nonces = new Map<string, { endpointId: string; expiresAt: Date; claimed: boolean }>();
  private spentTxids = new Set<string>();
  private persistPath?: string;

  constructor(persistPath?: string) {
    this.persistPath = persistPath;
    if (this.persistPath) {
      this.loadFromDisk();
    }
  }

  private loadFromDisk(): void {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return;
    try {
      const raw = fs.readFileSync(this.persistPath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.accounts)) {
        for (const acc of data.accounts) {
          this.accounts.set(acc.id, acc);
          if (acc.apiKey) this.apiKeys.set(acc.apiKey, acc.id);
        }
      }
      if (Array.isArray(data.endpoints)) {
        for (const ep of data.endpoints) {
          ep.createdAt = new Date(ep.createdAt);
          ep.updatedAt = new Date(ep.updatedAt);
          this.endpoints.set(ep.id, ep);
          this.slugToId.set(ep.slug, ep.id);
        }
      }
      if (Array.isArray(data.cliSessions)) {
        for (const s of data.cliSessions) {
          s.createdAt = new Date(s.createdAt);
          s.expiresAt = new Date(s.expiresAt);
          this.cliSessions.set(s.token, s);
        }
      }
      if (Array.isArray(data.logs)) {
        this.logs = data.logs.map((l: any) => ({ ...l, timestamp: new Date(l.timestamp) }));
      }
      if (Array.isArray(data.nonces)) {
        for (const [nonce, item] of data.nonces) {
          this.nonces.set(nonce, { ...item, expiresAt: new Date(item.expiresAt) });
        }
      }
      if (Array.isArray(data.spentTxids)) {
        this.spentTxids = new Set(data.spentTxids);
      }
    } catch {
      // Ignore corrupt file
    }
  }

  private saveToDisk(): void {
    if (!this.persistPath) return;
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        accounts: Array.from(this.accounts.values()),
        endpoints: Array.from(this.endpoints.values()),
        cliSessions: Array.from(this.cliSessions.values()),
        logs: this.logs,
        nonces: Array.from(this.nonces.entries()),
        spentTxids: Array.from(this.spentTxids),
      };
      fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // Ignore write errors
    }
  }

  async createAccount(email?: string, payoutAddress?: string): Promise<Account> {
    const id = crypto.randomUUID();
    const apiKey = `modu_live_${crypto.randomBytes(24).toString('hex')}`;
    const account: Account = {
      id,
      email,
      payoutAddress,
      apiKey,
      createdAt: new Date().toISOString(),
    };
    this.accounts.set(id, account);
    this.apiKeys.set(apiKey, id);
    this.saveToDisk();
    return account;
  }

  async getAccountById(id: string): Promise<Account | null> {
    return this.accounts.get(id) || null;
  }

  async getAccountByApiKey(apiKey: string): Promise<Account | null> {
    const accountId = this.apiKeys.get(apiKey);
    if (!accountId) return null;
    return this.accounts.get(accountId) || null;
  }

  async updatePayoutAddress(accountId: string, payoutAddress: string): Promise<Account> {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error('Account not found');
    account.payoutAddress = payoutAddress;
    this.saveToDisk();
    return account;
  }

  async createCliSession(token: string, expiresAt: Date): Promise<CliSessionRecord> {
    const session: CliSessionRecord = {
      id: crypto.randomUUID(),
      token,
      claimed: false,
      accountId: null,
      createdAt: new Date(),
      expiresAt,
    };
    this.cliSessions.set(token, session);
    this.saveToDisk();
    return session;
  }

  async getCliSession(token: string): Promise<CliSessionRecord | null> {
    const session = this.cliSessions.get(token);
    if (!session) return null;
    if (new Date() > session.expiresAt) {
      return null;
    }
    return session;
  }

  async claimCliSession(token: string, accountId: string): Promise<CliSessionRecord> {
    const session = this.cliSessions.get(token);
    if (!session) throw new Error('Session not found');
    session.claimed = true;
    session.accountId = accountId;
    this.saveToDisk();
    return session;
  }

  async createEndpoint(data: {
    accountId: string;
    slug: string;
    originUrl: string;
    price: string;
    asset: AssetType;
  }): Promise<EndpointRecord> {
    if (this.slugToId.has(data.slug)) {
      throw new Error(`Endpoint slug "${data.slug}" is already in use`);
    }

    const id = crypto.randomBytes(4).toString('hex'); // compact endpoint id e.g. "8f2a1c"
    const now = new Date();
    const endpoint: EndpointRecord = {
      id,
      slug: data.slug,
      originUrl: data.originUrl,
      price: data.price,
      asset: data.asset,
      isActive: true,
      accountId: data.accountId,
      createdAt: now,
      updatedAt: now,
    };

    this.endpoints.set(id, endpoint);
    this.slugToId.set(data.slug, id);
    this.saveToDisk();
    return endpoint;
  }

  async getEndpointsByAccount(accountId: string): Promise<EndpointRecord[]> {
    return Array.from(this.endpoints.values()).filter((e) => e.accountId === accountId);
  }

  async getEndpointById(id: string): Promise<EndpointRecord | null> {
    return this.endpoints.get(id) || null;
  }

  async getEndpointBySlug(slug: string): Promise<EndpointRecord | null> {
    const id = this.slugToId.get(slug);
    if (!id) return null;
    return this.endpoints.get(id) || null;
  }

  async revokeEndpoint(id: string, accountId: string): Promise<boolean> {
    const endpoint = this.endpoints.get(id);
    if (!endpoint || endpoint.accountId !== accountId) {
      return false;
    }
    endpoint.isActive = false;
    endpoint.updatedAt = new Date();
    this.saveToDisk();
    return true;
  }

  async createRequestLog(data: {
    endpointId: string;
    payerAddress: string;
    txid: string;
    amount: string;
    status: number;
    latencyMs: number;
  }): Promise<RequestLogRecord> {
    const record: RequestLogRecord = {
      id: crypto.randomUUID(),
      endpointId: data.endpointId,
      payerAddress: data.payerAddress,
      txid: data.txid,
      amount: data.amount,
      status: data.status,
      latencyMs: data.latencyMs,
      timestamp: new Date(),
    };
    this.logs.unshift(record);
    this.saveToDisk();
    return record;
  }

  async getLogs(endpointId: string, limit = 50): Promise<RequestLogRecord[]> {
    return this.logs.filter((l) => l.endpointId === endpointId).slice(0, limit);
  }

  async getStats(endpointId: string): Promise<EndpointStats> {
    const logs = this.logs.filter((l) => l.endpointId === endpointId);
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    let totalMicro = BigInt(0);
    let todayMicro = BigInt(0);
    let requestsToday = 0;
    const dailyMap = new Map<string, { amount: bigint; requests: number }>();
    const payerMap = new Map<string, { amount: bigint; requests: number }>();

    for (const log of logs) {
      const logDate = log.timestamp.toISOString().slice(0, 10);
      const amt = BigInt(log.amount || 0);

      totalMicro += amt;

      if (logDate === todayStr) {
        todayMicro += amt;
        requestsToday += 1;
      }

      // Daily
      const day = dailyMap.get(logDate) || { amount: BigInt(0), requests: 0 };
      day.amount += amt;
      day.requests += 1;
      dailyMap.set(logDate, day);

      // Payer
      if (log.payerAddress) {
        const payer = payerMap.get(log.payerAddress) || { amount: BigInt(0), requests: 0 };
        payer.amount += amt;
        payer.requests += 1;
        payerMap.set(log.payerAddress, payer);
      }
    }

    const revenueByDay = Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        amount: fromBaseUnits(data.amount.toString(), 6),
        requests: data.requests,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const topPayers = Array.from(payerMap.entries())
      .map(([address, data]) => ({
        address,
        requests: data.requests,
        totalAmount: fromBaseUnits(data.amount.toString(), 6),
      }))
      .sort((a, b) => (BigInt(toBaseUnits(b.totalAmount)) > BigInt(toBaseUnits(a.totalAmount)) ? 1 : -1))
      .slice(0, 10);

    return {
      endpointId,
      totalRequests: logs.length,
      paidRequests: logs.filter((l) => l.status === 200).length,
      totalRevenue: fromBaseUnits(totalMicro.toString(), 6),
      revenueToday: fromBaseUnits(todayMicro.toString(), 6),
      requestsToday,
      revenueByDay,
      topPayers,
    };
  }

  async saveNonce(nonce: string, endpointId: string, expiresAt: Date): Promise<void> {
    this.nonces.set(nonce, { endpointId, expiresAt, claimed: false });
    this.saveToDisk();
  }

  async claimNonce(nonce: string): Promise<string | null> {
    const item = this.nonces.get(nonce);
    if (!item) return null;
    if (item.claimed || new Date() > item.expiresAt) {
      return null;
    }
    item.claimed = true;
    this.saveToDisk();
    return item.endpointId;
  }

  async isTxidSpent(txid: string): Promise<boolean> {
    return this.spentTxids.has(txid);
  }

  async recordSpentTxid(txid: string, _endpointId: string): Promise<void> {
    this.spentTxids.add(txid);
    this.saveToDisk();
  }
}
