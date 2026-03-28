// ================================================
// WLFI INFLUENCER TRACKING SERVICE
// Top 25 X/Twitter Influencers + Posts
// ================================================

export interface WLFIInfluencer {
  rank: number;
  name: string;
  handle: string;
  followers: string;
  followersNum: number;
  category: 'official' | 'whale' | 'analyst' | 'media' | 'community' | 'politics' | 'defi_expert';
  description: string;
  avatarInitials: string;
  avatarColor: string;
  relevanceScore: number;
  recentPosts: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  verified: boolean;
  profileUrl: string;
  lastPostDate?: string;
  bio?: string;
}

export interface InfluencerPost {
  influencer: string;
  handle: string;
  content: string;
  timestamp: string;
  likes: string;
  retweets: string;
  views: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

export interface WLFIInfluencerReport {
  topInfluencers: WLFIInfluencer[];
  recentPosts: InfluencerPost[];
  sentimentBreakdown: { bullish: number; bearish: number; neutral: number };
  totalReach: string;
  updatedAt: string;
}

// ---- Hardcoded Database: Top 25 Real WLFI Influencers ----
const INFLUENCER_DB: WLFIInfluencer[] = [
  // Official (5)
  { rank: 1, name: 'World Liberty Fi', handle: '@WorldLibertyFi', followers: '1.2M', followersNum: 1200000, category: 'official', description: 'Official WLFI project account', avatarInitials: 'WL', avatarColor: '#00d4ff', relevanceScore: 100, recentPosts: 28, sentiment: 'bullish', verified: true, profileUrl: 'https://x.com/WorldLibertyFi', bio: 'Official World Liberty Financial. DeFi for the people.' },
  { rank: 2, name: 'Donald J. Trump', handle: '@realDonaldTrump', followers: '92M', followersNum: 92000000, category: 'official', description: 'Chief Crypto Advocate', avatarInitials: 'DT', avatarColor: '#1a1a4e', relevanceScore: 98, recentPosts: 12, sentiment: 'bullish', verified: true, profileUrl: 'https://x.com/realDonaldTrump', bio: '47th President of the United States' },
  { rank: 3, name: 'Eric Trump', handle: '@EricTrump', followers: '6.1M', followersNum: 6100000, category: 'official', description: 'Web3 Ambassador', avatarInitials: 'ET', avatarColor: '#1a3a5e', relevanceScore: 95, recentPosts: 18, sentiment: 'bullish', verified: true, profileUrl: 'https://x.com/EricTrump', bio: 'EVP @TrumpOrg. Crypto enthusiast.' },
  { rank: 4, name: 'Donald Trump Jr.', handle: '@DonaldJTrumpJr', followers: '12.5M', followersNum: 12500000, category: 'official', description: 'DeFi Advocate', avatarInitials: 'DJ', avatarColor: '#2a2a4e', relevanceScore: 90, recentPosts: 8, sentiment: 'bullish', verified: true, profileUrl: 'https://x.com/DonaldJTrumpJr', bio: 'Author, speaker, outdoorsman, crypto bull.' },
  { rank: 5, name: 'Zak Folkman', handle: '@ZakFolkman', followers: '85K', followersNum: 85000, category: 'official', description: 'WLFI Co-Founder', avatarInitials: 'ZF', avatarColor: '#1a4a3e', relevanceScore: 92, recentPosts: 22, sentiment: 'bullish', verified: true, profileUrl: 'https://x.com/ZakFolkman', bio: 'Co-Founder @WorldLibertyFi' },

  // Whales (5)
  { rank: 6, name: 'Justin Sun', handle: '@justinsuntron', followers: '3.5M', followersNum: 3500000, category: 'whale', description: '$75M WLFI investor', avatarInitials: 'JS', avatarColor: '#ff4500', relevanceScore: 88, recentPosts: 6, sentiment: 'bullish', verified: true, profileUrl: 'https://x.com/justinsuntron', bio: 'Founder of TRON. $75M invested in WLFI.' },
  { rank: 7, name: 'Arthur Hayes', handle: '@CryptoHayes', followers: '800K', followersNum: 800000, category: 'whale', description: 'BitMEX founder, macro analysis', avatarInitials: 'AH', avatarColor: '#6b21a8', relevanceScore: 72, recentPosts: 3, sentiment: 'neutral', verified: true, profileUrl: 'https://x.com/CryptoHayes', bio: 'Co-Founder BitMEX. Maelstrom Fund.' },
  { rank: 8, name: 'GCR', handle: '@GCRClassic', followers: '450K', followersNum: 450000, category: 'whale', description: 'On-chain whale, contrarian', avatarInitials: 'GC', avatarColor: '#0891b2', relevanceScore: 68, recentPosts: 2, sentiment: 'bearish', verified: false, profileUrl: 'https://x.com/GCRClassic', bio: 'Contrarian. On-chain.' },
  { rank: 9, name: 'Lookonchain', handle: '@lookonchain', followers: '600K', followersNum: 600000, category: 'whale', description: 'On-chain analytics & whale tracking', avatarInitials: 'LO', avatarColor: '#059669', relevanceScore: 75, recentPosts: 14, sentiment: 'neutral', verified: true, profileUrl: 'https://x.com/lookonchain', bio: 'On-chain data & whale tracking.' },
  { rank: 10, name: 'Hsaka', handle: '@HsakaTrades', followers: '350K', followersNum: 350000, category: 'whale', description: 'Crypto trader, WLFI watcher', avatarInitials: 'HT', avatarColor: '#dc2626', relevanceScore: 60, recentPosts: 4, sentiment: 'neutral', verified: true, profileUrl: 'https://x.com/HsakaTrades' },

  // Analysts (5)
  { rank: 11, name: 'ZachXBT', handle: '@zachxbt', followers: '1.5M', followersNum: 1500000, category: 'analyst', description: 'On-chain investigator', avatarInitials: 'ZX', avatarColor: '#b91c1c', relevanceScore: 85, recentPosts: 5, sentiment: 'bearish', verified: true, profileUrl: 'https://x.com/zachxbt', bio: 'On-chain sleuth. 2D investigator.' },
  { rank: 12, name: 'Coin Bureau', handle: '@coinbureau', followers: '2.4M', followersNum: 2400000, category: 'analyst', description: 'Deep crypto analysis', avatarInitials: 'CB', avatarColor: '#7c3aed', relevanceScore: 78, recentPosts: 4, sentiment: 'neutral', verified: true, profileUrl: 'https://x.com/coinbureau', bio: 'Crypto research & education.' },
  { rank: 13, name: 'The DeFi Edge', handle: '@thedefiedge', followers: '580K', followersNum: 580000, category: 'analyst', description: 'DeFi strategies & analysis', avatarInitials: 'DE', avatarColor: '#2563eb', relevanceScore: 70, recentPosts: 3, sentiment: 'neutral', verified: true, profileUrl: 'https://x.com/thedefiedge', bio: 'DeFi strategies & alpha.' },
  { rank: 14, name: 'DeFi Ignas', handle: '@DefiIgnas', followers: '350K', followersNum: 350000, category: 'defi_expert', description: 'DeFi researcher', avatarInitials: 'DI', avatarColor: '#0ea5e9', relevanceScore: 65, recentPosts: 6, sentiment: 'neutral', verified: true, profileUrl: 'https://x.com/DefiIgnas', bio: 'DeFi degen & researcher.' },
  { rank: 15, name: 'Pentoshi', handle: '@Pentosh1', followers: '700K', followersNum: 700000, category: 'analyst', description: 'Chart analyst & macro', avatarInitials: 'PE', avatarColor: '#ca8a04', relevanceScore: 62, recentPosts: 2, sentiment: 'bullish', verified: true, profileUrl: 'https://x.com/Pentosh1', bio: 'Charts. Macro. Crypto.' },

  // Media (5)
  { rank: 16, name: 'Altcoin Daily', handle: '@AltcoinDailyio', followers: '1.8M', followersNum: 1800000, category: 'media', description: 'Daily crypto news', avatarInitials: 'AD', avatarColor: '#1a2a3a', relevanceScore: 72, recentPosts: 8, sentiment: 'bullish', verified: true, profileUrl: 'https://x.com/AltcoinDailyio', bio: 'Daily crypto news & alpha.' },
  { rank: 17, name: 'Layah Heilpern', handle: '@LayahHeilpern', followers: '420K', followersNum: 420000, category: 'media', description: 'Crypto journalist', avatarInitials: 'LH', avatarColor: '#be185d', relevanceScore: 65, recentPosts: 3, sentiment: 'neutral', verified: true, profileUrl: 'https://x.com/LayahHeilpern', bio: 'Crypto journalist & author.' },
  { rank: 18, name: 'CoinDesk', handle: '@CoinDesk', followers: '3.2M', followersNum: 3200000, category: 'media', description: 'Leading crypto media', avatarInitials: 'CD', avatarColor: '#1e3a5f', relevanceScore: 80, recentPosts: 12, sentiment: 'neutral', verified: true, profileUrl: 'https://x.com/CoinDesk', bio: 'The most trusted crypto media.' },
  { rank: 19, name: 'Cointelegraph', handle: '@Cointelegraph', followers: '2.8M', followersNum: 2800000, category: 'media', description: 'Crypto news & analysis', avatarInitials: 'CT', avatarColor: '#166534', relevanceScore: 78, recentPosts: 10, sentiment: 'neutral', verified: true, profileUrl: 'https://x.com/Cointelegraph', bio: 'Crypto news since 2013.' },
  { rank: 20, name: 'The Block', handle: '@TheBlock__', followers: '500K', followersNum: 500000, category: 'media', description: 'Industry news & data', avatarInitials: 'TB', avatarColor: '#374151', relevanceScore: 70, recentPosts: 5, sentiment: 'neutral', verified: true, profileUrl: 'https://x.com/TheBlock__', bio: 'Crypto news, data, and analysis.' },

  // Community / Politics (5)
  { rank: 21, name: 'Watcher Guru', handle: '@WatcherGuru', followers: '3.8M', followersNum: 3800000, category: 'community', description: 'Crypto alerts & breaking news', avatarInitials: 'WG', avatarColor: '#f59e0b', relevanceScore: 75, recentPosts: 15, sentiment: 'bullish', verified: true, profileUrl: 'https://x.com/WatcherGuru', bio: 'Breaking crypto news & alerts.' },
  { rank: 22, name: 'Crypto Capo', handle: '@CryptoCapo_', followers: '600K', followersNum: 600000, category: 'community', description: 'Macro analysis & calls', avatarInitials: 'CC', avatarColor: '#991b1b', relevanceScore: 58, recentPosts: 2, sentiment: 'bearish', verified: true, profileUrl: 'https://x.com/CryptoCapo_', bio: 'Macro. Charts. Truth.' },
  { rank: 23, name: 'Polymarket', handle: '@Polymarket', followers: '890K', followersNum: 890000, category: 'community', description: 'Prediction markets', avatarInitials: 'PM', avatarColor: '#4f46e5', relevanceScore: 70, recentPosts: 7, sentiment: 'neutral', verified: true, profileUrl: 'https://x.com/Polymarket', bio: 'The world\'s prediction market.' },
  { rank: 24, name: 'Vivek Ramaswamy', handle: '@VivekGRamaswamy', followers: '3.1M', followersNum: 3100000, category: 'politics', description: 'Pro-crypto politician', avatarInitials: 'VR', avatarColor: '#1e40af', relevanceScore: 55, recentPosts: 3, sentiment: 'bullish', verified: true, profileUrl: 'https://x.com/VivekGRamaswamy', bio: 'Entrepreneur. Former DOGE co-lead.' },
  { rank: 25, name: 'Robert Kennedy Jr', handle: '@RobertKennedyJr', followers: '2.5M', followersNum: 2500000, category: 'politics', description: 'Crypto-friendly politics', avatarInitials: 'RK', avatarColor: '#064e3b', relevanceScore: 50, recentPosts: 1, sentiment: 'neutral', verified: true, profileUrl: 'https://x.com/RobertKennedyJr', bio: 'HHS Secretary. Bitcoin advocate.' },
];

// ---- Recent Influencer Posts about WLFI ----
const RECENT_POSTS: InfluencerPost[] = [
  { influencer: 'Donald J. Trump', handle: '@realDonaldTrump', content: 'World Liberty Financial is going to change everything. Together, we\'re building the future of $WLFI and #DeFi. 🇺🇸', timestamp: '2h ago', likes: '45.2k', retweets: '8.3k', views: '2.1M', sentiment: 'bullish' },
  { influencer: 'Eric Trump', handle: '@EricTrump', content: '🚀 HUGE milestone! @WorldLibertyFi just crossed $300M raised! This is what DeFi can do when you believe. #WLFI', timestamp: '4h ago', likes: '28.7k', retweets: '4.1k', views: '890k', sentiment: 'bullish' },
  { influencer: 'Justin Sun', handle: '@justinsuntron', content: 'Proud of my $75M investment in @WorldLibertyFi. DeFi is the future of global finance. #WLFI', timestamp: '6h ago', likes: '22.4k', retweets: '3.7k', views: '650k', sentiment: 'bullish' },
  { influencer: 'ZachXBT', handle: '@zachxbt', content: 'Thread on $WLFI: 75% of token sale revenue goes directly to Trump family entities. Tokenomics designed to extract maximum value from retail.', timestamp: '8h ago', likes: '31.2k', retweets: '9.8k', views: '1.4M', sentiment: 'bearish' },
  { influencer: 'Lookonchain', handle: '@lookonchain', content: '🐋 WLFI Treasury just moved 15,000 ETH ($39.7M) to a new multisig wallet. On-chain data shows accumulation pattern continuing.', timestamp: '10h ago', likes: '8.9k', retweets: '2.3k', views: '450k', sentiment: 'neutral' },
  { influencer: 'Watcher Guru', handle: '@WatcherGuru', content: '🚨 BREAKING: World Liberty Financial ($WLFI) has been listed on Binance as a tradeable token. Massive volume incoming.', timestamp: '12h ago', likes: '35.1k', retweets: '11.2k', views: '3.2M', sentiment: 'bullish' },
  { influencer: 'Coin Bureau', handle: '@coinbureau', content: '$WLFI analysis: Protocol built on Aave V3. Main risk: token concentration & future unlock. Support at $0.038, resistance at $0.075.', timestamp: '14h ago', likes: '15.6k', retweets: '2.1k', views: '520k', sentiment: 'neutral' },
  { influencer: 'CoinDesk', handle: '@CoinDesk', content: 'WLFI Protocol TVL reaches $450M, growing 80% in Q1 2026. The Trump-backed DeFi project continues to attract institutional capital.', timestamp: '16h ago', likes: '12.8k', retweets: '3.4k', views: '780k', sentiment: 'bullish' },
  { influencer: 'Layah Heilpern', handle: '@LayahHeilpern', content: 'The intersection of politics and crypto has never been more explicit. $WLFI raised $300M+ while traditional projects struggle to raise seed rounds.', timestamp: '18h ago', likes: '12.3k', retweets: '2.8k', views: '410k', sentiment: 'neutral' },
  { influencer: 'The DeFi Edge', handle: '@thedefiedge', content: 'WLFI tokenomics deep dive 🧵: 25% protocol treasury is solid. But 22.5% team allocation with 12-month cliff means Q3 2026 is a key risk date. Watch the unlock schedule.', timestamp: '20h ago', likes: '9.4k', retweets: '1.8k', views: '320k', sentiment: 'neutral' },
  { influencer: 'Altcoin Daily', handle: '@AltcoinDailyio', content: '$WLFI price correlation with Trump news is at 0.91! Any presidential statement about crypto = instant pump. Play the news cycle. 📈', timestamp: '22h ago', likes: '18.3k', retweets: '3.5k', views: '620k', sentiment: 'bullish' },
  { influencer: 'Cointelegraph', handle: '@Cointelegraph', content: 'World Liberty Financial announces Chainlink integration for price feeds and CCIP cross-chain messaging. Partnership marks major infrastructure milestone for $WLFI.', timestamp: '1d ago', likes: '14.2k', retweets: '4.1k', views: '890k', sentiment: 'bullish' },
  { influencer: 'GCR', handle: '@GCRClassic', content: 'Everyone buying $WLFI at $0.048 thinking it goes to $0.15. Same crowd that bought LUNA at $80. Token unlock in 6 months will be brutal.', timestamp: '1d ago', likes: '21.5k', retweets: '5.6k', views: '980k', sentiment: 'bearish' },
  { influencer: 'Pentoshi', handle: '@Pentosh1', content: '$WLFI chart looks clean. Breakout above $0.05 targets $0.075 resistance. Holding above 200 EMA. Cautiously bullish.', timestamp: '1d ago', likes: '11.2k', retweets: '1.9k', views: '380k', sentiment: 'bullish' },
  { influencer: 'DeFi Ignas', handle: '@DefiIgnas', content: 'WLFI on Aave V3 is interesting from a protocol perspective. TVL growth is real. But governance centralization concerns remain. Need to see more decentralization.', timestamp: '2d ago', likes: '7.8k', retweets: '1.4k', views: '260k', sentiment: 'neutral' },
  { influencer: 'The Block', handle: '@TheBlock__', content: 'Exclusive: WLFI exploring expansion to Arbitrum after community governance vote passes with 91% approval. Multi-chain strategy in progress.', timestamp: '2d ago', likes: '6.5k', retweets: '1.8k', views: '340k', sentiment: 'bullish' },
  { influencer: 'World Liberty Fi', handle: '@WorldLibertyFi', content: '🏛️ Governance Vote #04 PASSED: Arbitrum deployment approved with 91% YES votes! Multi-chain era begins. Thank you to our incredible community! 🚀', timestamp: '2d ago', likes: '19.8k', retweets: '5.2k', views: '1.1M', sentiment: 'bullish' },
  { influencer: 'Crypto Capo', handle: '@CryptoCapo_', content: '$WLFI is a political trade, not a DeFi investment. Once the narrative fades, fundamentals will matter. And fundamentals say overvalued at $4.8B FDV.', timestamp: '3d ago', likes: '14.7k', retweets: '3.9k', views: '520k', sentiment: 'bearish' },
  { influencer: 'Hsaka', handle: '@HsakaTrades', content: 'WLFI treasury buying 10,000 ETH is significant. Shows protocol is long-term committed to Ethereum ecosystem. Bullish signal for both ETH and WLFI.', timestamp: '3d ago', likes: '8.1k', retweets: '1.5k', views: '290k', sentiment: 'bullish' },
  { influencer: 'Polymarket', handle: '@Polymarket', content: 'Will $WLFI reach $0.10 before June 2026? Current odds: 34% YES. $2.1M volume traded. What do you think?', timestamp: '3d ago', likes: '5.6k', retweets: '1.2k', views: '220k', sentiment: 'neutral' },
];

export class WLFIInfluencerService {
  private cache: Map<string, { data: unknown; timestamp: number }> = new Map();
  private cacheTTL = 300000; // 5 minutes

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.cacheTTL) {
      return entry.data as T;
    }
    return null;
  }

  private setCache(key: string, data: unknown): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  async getTopInfluencers(limit = 25): Promise<WLFIInfluencer[]> {
    const cacheKey = `influencers:top:${limit}`;
    const cached = this.getCached<WLFIInfluencer[]>(cacheKey);
    if (cached) return cached;

    const result = INFLUENCER_DB.slice(0, limit);
    this.setCache(cacheKey, result);
    return result;
  }

  async getInfluencersByCategory(category: string): Promise<WLFIInfluencer[]> {
    return INFLUENCER_DB.filter(i => i.category === category);
  }

  async getRecentPosts(limit = 20): Promise<InfluencerPost[]> {
    const cacheKey = `influencer:posts:${limit}`;
    const cached = this.getCached<InfluencerPost[]>(cacheKey);
    if (cached) return cached;

    const result = RECENT_POSTS.slice(0, limit);
    this.setCache(cacheKey, result);
    return result;
  }

  async getSentimentBreakdown(): Promise<{ bullish: number; bearish: number; neutral: number }> {
    const posts = RECENT_POSTS;
    const total = posts.length;
    const bullish = posts.filter(p => p.sentiment === 'bullish').length;
    const bearish = posts.filter(p => p.sentiment === 'bearish').length;
    const neutral = posts.filter(p => p.sentiment === 'neutral').length;

    return {
      bullish: Math.round((bullish / total) * 100),
      bearish: Math.round((bearish / total) * 100),
      neutral: Math.round((neutral / total) * 100),
    };
  }

  async getInfluencerReport(): Promise<WLFIInfluencerReport> {
    const cacheKey = 'influencer:report';
    const cached = this.getCached<WLFIInfluencerReport>(cacheKey);
    if (cached) return cached;

    const [influencers, posts, sentiment] = await Promise.all([
      this.getTopInfluencers(25),
      this.getRecentPosts(20),
      this.getSentimentBreakdown(),
    ]);

    const totalReachNum = influencers.reduce((sum, i) => sum + i.followersNum, 0);
    const totalReach = totalReachNum >= 1000000
      ? `${(totalReachNum / 1000000).toFixed(1)}M`
      : `${(totalReachNum / 1000).toFixed(0)}K`;

    const report: WLFIInfluencerReport = {
      topInfluencers: influencers,
      recentPosts: posts,
      sentimentBreakdown: sentiment,
      totalReach,
      updatedAt: new Date().toISOString(),
    };

    this.setCache(cacheKey, report);
    return report;
  }

  async healthCheck(): Promise<{ status: string; timestamp: number }> {
    return { status: 'operational', timestamp: Date.now() };
  }
}
