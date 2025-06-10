export class MarketDataModel {
  public symbol: string;
  public price: number;
  public volume24h: number;
  public change24h: number;
  public timestamp: number;

  constructor(data: {
    symbol: string;
    price: number;
    volume24h: number;
    change24h: number;
    timestamp?: number;
  }) {
    this.symbol = data.symbol;
    this.price = data.price;
    this.volume24h = data.volume24h;
    this.change24h = data.change24h;
    this.timestamp = data.timestamp || Date.now();
  }

  public isPriceValid(): boolean {
    return this.price > 0 && !isNaN(this.price);
  }

  public getFormattedPrice(): string {
    return `$${this.price.toLocaleString('en-US', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 8 
    })}`;
  }
}
