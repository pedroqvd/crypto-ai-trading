export interface MarketData {
  symbol: string;
  price: number;
  volume24h: number;
  change24h: number;
  timestamp: number;
}

export interface OrderBookData {
  symbol: string;
  bids: [number, number][]; // [price, size]
  asks: [number, number][];
  timestamp: number;
}

export interface TradeData {
  symbol: string;
  price: number;
  size: number;
  side: 'buy' | 'sell';
  timestamp: number;
}

export interface HyperliquidConfig {
  testnet: boolean;
  privateKey?: string;
  wsUrl: string;
  apiUrl: string;
}
