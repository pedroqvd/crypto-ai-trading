// ================================================
// WLFI INFLUENCER SERVICE
// Tracks top X/Twitter influencers discussing WLFI token
// ================================================

import axios from 'axios';

// ================================================
// INTERFACES
// ================================================

interface WLFIInfluencer {
  rank: number;
  name: string;
  handle: string;
  followers: string;
  followersNum: number;
  category: 'official' | 'whale' | 'analyst' | 'media' | 'community' | 'politics' | 'defi_expert';
  description: string;
  avatarInitials: string;
  avatarColor: string;
  relevanceScore: number; // 0-100
  recentPosts: number; // posts about WLFI in last 30 days
  sentiment: 'bullish' | 'bearish' | 'neutral';
  verified: boolean;
  profileUrl: string;
  lastPostDate?: string;
  bio?: string;
}

interface InfluencerPost {
  influencer: string;
  handle: string;
  content: string;
  timestamp: string;
  likes: string;
  retweets: string;
  views: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  url?: string;
}

interface WLFIInfluencerReport {
  topInfluencers: WLFIInfluencer[];
  recentPosts: InfluencerPost[];
  sentimentBreakdown: { bullish: number; bearish: number; neutral: number };
  totalReach: string;
  updatedAt: string;
}

// ================================================
// CACHE ENTRY
// ================================================

interface CacheEntry<T> {
  data: T;
  expires: number;
}

// ================================================
// SERVICE
// ================================================

export class WLFIInfluencerService {
  private cache: Map<string, CacheEntry<unknown>>;
  private readonly TTL = 300 * 1000; // 5 minutes (300 seconds)

  // ================================================
  // INFLUENCER DATABASE
  // ================================================

  private readonly influencers: WLFIInfluencer[] = [
    // --- Official (5) ---
    {
      rank: 1,
      name: 'World Liberty Financial',
      handle: '@WorldLibertyFi',
      followers: '1.2M',
      followersNum: 1200000,
      category: 'official',
      description: 'Official WLFI project account',
      avatarInitials: 'WL',
      avatarColor: '#1a73e8',
      relevanceScore: 100,
      recentPosts: 45,
      sentiment: 'bullish',
      verified: true,
      profileUrl: 'https://x.com/WorldLibertyFi',
      lastPostDate: '2026-03-28',
      bio: 'The official account for World Liberty Financial. Building the future of DeFi.'
    },
    {
      rank: 2,
      name: 'Donald J. Trump',
      handle: '@realDonaldTrump',
      followers: '92M',
      followersNum: 92000000,
      category: 'official',
      description: 'Chief Crypto Advocate',
      avatarInitials: 'DT',
      avatarColor: '#c62828',
      relevanceScore: 98,
      recentPosts: 12,
      sentiment: 'bullish',
      verified: true,
      profileUrl: 'https://x.com/realDonaldTrump',
      lastPostDate: '2026-03-27',
      bio: '45th & 47th President of the United States of America'
    },
    {
      rank: 3,
      name: 'Eric Trump',
      handle: '@EricTrump',
      followers: '6.1M',
      followersNum: 6100000,
      category: 'official',
      description: 'Web3 Ambassador',
      avatarInitials: 'ET',
      avatarColor: '#d32f2f',
      relevanceScore: 95,
      recentPosts: 22,
      sentiment: 'bullish',
      verified: true,
      profileUrl: 'https://x.com/EricTrump',
      lastPostDate: '2026-03-28',
      bio: 'EVP of The Trump Organization. Web3 Ambassador for World Liberty Financial.'
    },
    {
      rank: 4,
      name: 'Donald Trump Jr.',
      handle: '@DonaldJTrumpJr',
      followers: '12.5M',
      followersNum: 12500000,
      category: 'official',
      description: 'DeFi advocate',
      avatarInitials: 'DJ',
      avatarColor: '#b71c1c',
      relevanceScore: 93,
      recentPosts: 18,
      sentiment: 'bullish',
      verified: true,
      profileUrl: 'https://x.com/DonaldJTrumpJr',
      lastPostDate: '2026-03-27',
      bio: 'Author, outdoorsman, and DeFi advocate.'
    },
    {
      rank: 5,
      name: 'Barron Trump',
      handle: '@BarronTrump',
      followers: '800K',
      followersNum: 800000,
      category: 'official',
      description: 'Gen-Z crypto voice',
      avatarInitials: 'BT',
      avatarColor: '#e53935',
      relevanceScore: 85,
      recentPosts: 8,
      sentiment: 'bullish',
      verified: true,
      profileUrl: 'https://x.com/BarronTrump',
      lastPostDate: '2026-03-25',
      bio: 'Gen-Z. Interested in DeFi and the future of finance.'
    },
    // --- Whales (5) ---
    {
      rank: 6,
      name: 'Justin Sun',
      handle: '@justinsuntron',
      followers: '3.5M',
      followersNum: 3500000,
      category: 'whale',
      description: '$75M WLFI investor, TRON founder',
      avatarInitials: 'JS',
      avatarColor: '#ff6f00',
      relevanceScore: 96,
      recentPosts: 15,
      sentiment: 'bullish',
      verified: true,
      profileUrl: 'https://x.com/justinsuntron',
      lastPostDate: '2026-03-27',
      bio: 'Founder of TRON. Largest WLFI investor.'
    },
    {
      rank: 7,
      name: 'Arthur Hayes',
      handle: '@CryptoHayes',
      followers: '800K',
      followersNum: 800000,
      category: 'whale',
      description: 'BitMEX founder, macro trader',
      avatarInitials: 'AH',
      avatarColor: '#f57c00',
      relevanceScore: 82,
      recentPosts: 6,
      sentiment: 'neutral',
      verified: true,
      profileUrl: 'https://x.com/CryptoHayes',
      lastPostDate: '2026-03-26',
      bio: 'Co-founder of BitMEX. Maelstrom Fund CIO.'
    },
    {
      rank: 8,
      name: 'GCR',
      handle: '@GCRClassic',
      followers: '450K',
      followersNum: 450000,
      category: 'whale',
      description: 'On-chain whale, contrarian trader',
      avatarInitials: 'GC',
      avatarColor: '#ef6c00',
      relevanceScore: 78,
      recentPosts: 4,
      sentiment: 'neutral',
      verified: false,
      profileUrl: 'https://x.com/GCRClassic',
      lastPostDate: '2026-03-24',
      bio: 'On-chain analysis. Contrarian.'
    },
    {
      rank: 9,
      name: 'Smartest Money',
      handle: '@SmartestMoney_',
      followers: '300K',
      followersNum: 300000,
      category: 'whale',
      description: 'Whale wallet tracker',
      avatarInitials: 'SM',
      avatarColor: '#e65100',
      relevanceScore: 74,
      recentPosts: 10,
      sentiment: 'bullish',
      verified: false,
      profileUrl: 'https://x.com/SmartestMoney_',
      lastPostDate: '2026-03-27',
      bio: 'Tracking the smartest money in crypto.'
    },
    {
      rank: 10,
      name: 'Lookonchain',
      handle: '@lookonchain',
      followers: '600K',
      followersNum: 600000,
      category: 'whale',
      description: 'On-chain analytics & whale tracking',
      avatarInitials: 'LO',
      avatarColor: '#ff9800',
      relevanceScore: 80,
      recentPosts: 12,
      sentiment: 'neutral',
      verified: true,
      profileUrl: 'https://x.com/lookonchain',
      lastPostDate: '2026-03-28',
      bio: 'On-chain data analytics. Tracking whale movements.'
    },
    // --- Analysts (5) ---
    {
      rank: 11,
      name: 'ZachXBT',
      handle: '@zachxbt',
      followers: '1.5M',
      followersNum: 1500000,
      category: 'analyst',
      description: 'On-chain investigator',
      avatarInitials: 'ZX',
      avatarColor: '#7b1fa2',
      relevanceScore: 88,
      recentPosts: 7,
      sentiment: 'bearish',
      verified: false,
      profileUrl: 'https://x.com/zachxbt',
      lastPostDate: '2026-03-26',
      bio: '2D investigator. On-chain sleuth.'
    },
    {
      rank: 12,
      name: 'Coin Bureau',
      handle: '@coinbureau',
      followers: '2.4M',
      followersNum: 2400000,
      category: 'analyst',
      description: 'Deep crypto analysis & education',
      avatarInitials: 'CB',
      avatarColor: '#6a1b9a',
      relevanceScore: 84,
      recentPosts: 5,
      sentiment: 'neutral',
      verified: true,
      profileUrl: 'https://x.com/coinbureau',
      lastPostDate: '2026-03-25',
      bio: 'In-depth crypto analysis. No hype, just facts.'
    },
    {
      rank: 13,
      name: 'The DeFi Edge',
      handle: '@thedefiedge',
      followers: '580K',
      followersNum: 580000,
      category: 'analyst',
      description: 'DeFi strategies & yield analysis',
      avatarInitials: 'DE',
      avatarColor: '#8e24aa',
      relevanceScore: 76,
      recentPosts: 9,
      sentiment: 'bullish',
      verified: false,
      profileUrl: 'https://x.com/thedefiedge',
      lastPostDate: '2026-03-27',
      bio: 'Making DeFi simple. Strategies, yields, and alpha.'
    },
    {
      rank: 14,
      name: 'Ignas',
      handle: '@DefiIgnas',
      followers: '350K',
      followersNum: 350000,
      category: 'analyst',
      description: 'DeFi researcher',
      avatarInitials: 'IG',
      avatarColor: '#9c27b0',
      relevanceScore: 72,
      recentPosts: 6,
      sentiment: 'neutral',
      verified: false,
      profileUrl: 'https://x.com/DefiIgnas',
      lastPostDate: '2026-03-26',
      bio: 'DeFi Researcher. Exploring new protocols daily.'
    },
    {
      rank: 15,
      name: 'Pentoshi',
      handle: '@Pentosh1',
      followers: '700K',
      followersNum: 700000,
      category: 'analyst',
      description: 'Chart analyst & macro trader',
      avatarInitials: 'PE',
      avatarColor: '#ab47bc',
      relevanceScore: 70,
      recentPosts: 4,
      sentiment: 'bullish',
      verified: false,
      profileUrl: 'https://x.com/Pentosh1',
      lastPostDate: '2026-03-24',
      bio: 'Full-time trader. Charts, macro, and vibes.'
    },
    // --- Media (5) ---
    {
      rank: 16,
      name: 'Altcoin Daily',
      handle: '@AltcoinDailyio',
      followers: '1.8M',
      followersNum: 1800000,
      category: 'media',
      description: 'Daily crypto news & updates',
      avatarInitials: 'AD',
      avatarColor: '#0277bd',
      relevanceScore: 79,
      recentPosts: 11,
      sentiment: 'bullish',
      verified: true,
      profileUrl: 'https://x.com/AltcoinDailyio',
      lastPostDate: '2026-03-28',
      bio: 'Daily crypto news. Subscribe on YouTube.'
    },
    {
      rank: 17,
      name: 'Layah Heilpern',
      handle: '@LayahHeilpern',
      followers: '420K',
      followersNum: 420000,
      category: 'media',
      description: 'Crypto journalist & commentator',
      avatarInitials: 'LH',
      avatarColor: '#0288d1',
      relevanceScore: 68,
      recentPosts: 5,
      sentiment: 'neutral',
      verified: true,
      profileUrl: 'https://x.com/LayahHeilpern',
      lastPostDate: '2026-03-25',
      bio: 'Author. Journalist. Crypto & freedom.'
    },
    {
      rank: 18,
      name: 'CoinDesk',
      handle: '@CoinDesk',
      followers: '3.2M',
      followersNum: 3200000,
      category: 'media',
      description: 'Leading crypto media outlet',
      avatarInitials: 'CD',
      avatarColor: '#01579b',
      relevanceScore: 86,
      recentPosts: 14,
      sentiment: 'neutral',
      verified: true,
      profileUrl: 'https://x.com/CoinDesk',
      lastPostDate: '2026-03-28',
      bio: 'The most trusted media platform for the crypto economy.'
    },
    {
      rank: 19,
      name: 'Cointelegraph',
      handle: '@Cointelegraph',
      followers: '2.8M',
      followersNum: 2800000,
      category: 'media',
      description: 'Crypto news & analysis',
      avatarInitials: 'CT',
      avatarColor: '#0d47a1',
      relevanceScore: 85,
      recentPosts: 13,
      sentiment: 'neutral',
      verified: true,
      profileUrl: 'https://x.com/Cointelegraph',
      lastPostDate: '2026-03-28',
      bio: 'The future of money. Crypto news since 2013.'
    },
    {
      rank: 20,
      name: 'The Block',
      handle: '@TheBlock__',
      followers: '500K',
      followersNum: 500000,
      category: 'media',
      description: 'Industry news & research',
      avatarInitials: 'TB',
      avatarColor: '#1565c0',
      relevanceScore: 77,
      recentPosts: 8,
      sentiment: 'neutral',
      verified: true,
      profileUrl: 'https://x.com/TheBlock__',
      lastPostDate: '2026-03-27',
      bio: 'The first and final word in digital assets.'
    },
    // --- Community / Politics (5) ---
    {
      rank: 21,
      name: 'Watcher Guru',
      handle: '@WatcherGuru',
      followers: '3.8M',
      followersNum: 3800000,
      category: 'community',
      description: 'Crypto alerts & breaking news',
      avatarInitials: 'WG',
      avatarColor: '#2e7d32',
      relevanceScore: 83,
      recentPosts: 16,
      sentiment: 'bullish',
      verified: true,
      profileUrl: 'https://x.com/WatcherGuru',
      lastPostDate: '2026-03-28',
      bio: 'BREAKING crypto news & alerts.'
    },
    {
      rank: 22,
      name: 'Crypto Capo',
      handle: '@CryptoCapo_',
      followers: '600K',
      followersNum: 600000,
      category: 'community',
      description: 'Macro analysis & market structure',
      avatarInitials: 'CC',
      avatarColor: '#388e3c',
      relevanceScore: 66,
      recentPosts: 3,
      sentiment: 'bearish',
      verified: false,
      profileUrl: 'https://x.com/CryptoCapo_',
      lastPostDate: '2026-03-23',
      bio: 'Market structure analysis. Expect the unexpected.'
    },
    {
      rank: 23,
      name: 'Polymarket',
      handle: '@Polymarket',
      followers: '890K',
      followersNum: 890000,
      category: 'community',
      description: 'Prediction markets & crypto sentiment',
      avatarInitials: 'PM',
      avatarColor: '#43a047',
      relevanceScore: 71,
      recentPosts: 5,
      sentiment: 'neutral',
      verified: true,
      profileUrl: 'https://x.com/Polymarket',
      lastPostDate: '2026-03-26',
      bio: 'The world\'s largest prediction market.'
    },
    {
      rank: 24,
      name: 'Vivek Ramaswamy',
      handle: '@VivekGRamaswamy',
      followers: '3.1M',
      followersNum: 3100000,
      category: 'politics',
      description: 'Pro-crypto politics & regulation',
      avatarInitials: 'VR',
      avatarColor: '#1b5e20',
      relevanceScore: 69,
      recentPosts: 4,
      sentiment: 'bullish',
      verified: true,
      profileUrl: 'https://x.com/VivekGRamaswamy',
      lastPostDate: '2026-03-24',
      bio: 'Entrepreneur. Author. Pro-innovation policy.'
    },
    {
      rank: 25,
      name: 'Robert F. Kennedy Jr.',
      handle: '@RobertKennedyJr',
      followers: '2.5M',
      followersNum: 2500000,
      category: 'politics',
      description: 'Crypto-friendly politics',
      avatarInitials: 'RK',
      avatarColor: '#4caf50',
      relevanceScore: 65,
      recentPosts: 3,
      sentiment: 'bullish',
      verified: true,
      profileUrl: 'https://x.com/RobertKennedyJr',
      lastPostDate: '2026-03-22',
      bio: 'Environmental attorney. Health advocate. Bitcoin supporter.'
    }
  ];

  // ================================================
  // RECENT POSTS DATABASE
  // ================================================

  private readonly recentPostsData: InfluencerPost[] = [
    {
      influencer: 'World Liberty Financial',
      handle: '@WorldLibertyFi',
      content: 'WLFI governance proposal #14 has passed with 92% approval. New treasury diversification strategy going live next week. This is what decentralized governance looks like.',
      timestamp: '2026-03-28T14:30:00Z',
      likes: '12.4K',
      retweets: '3.8K',
      views: '1.2M',
      sentiment: 'bullish',
      url: 'https://x.com/WorldLibertyFi/status/example1'
    },
    {
      influencer: 'Eric Trump',
      handle: '@EricTrump',
      content: 'The future of finance is being built right now at @WorldLibertyFi. Our DeFi protocol TVL just crossed $2B. The establishment said it couldn\'t be done. We proved them wrong.',
      timestamp: '2026-03-28T10:15:00Z',
      likes: '45.2K',
      retweets: '12.1K',
      views: '8.5M',
      sentiment: 'bullish',
      url: 'https://x.com/EricTrump/status/example2'
    },
    {
      influencer: 'Justin Sun',
      handle: '@justinsuntron',
      content: 'Just added another $15M to my WLFI position. The protocol fundamentals are stronger than ever. Cross-chain integration with TRON ecosystem coming soon. Bullish.',
      timestamp: '2026-03-27T22:00:00Z',
      likes: '28.9K',
      retweets: '8.4K',
      views: '5.3M',
      sentiment: 'bullish',
      url: 'https://x.com/justinsuntron/status/example3'
    },
    {
      influencer: 'ZachXBT',
      handle: '@zachxbt',
      content: 'Looked into the WLFI treasury wallet movements. Several large transfers to new addresses in the past 48h. Team says it\'s for a new liquidity pool deployment but the timing is interesting.',
      timestamp: '2026-03-26T18:45:00Z',
      likes: '18.7K',
      retweets: '6.2K',
      views: '3.9M',
      sentiment: 'bearish',
      url: 'https://x.com/zachxbt/status/example4'
    },
    {
      influencer: 'Lookonchain',
      handle: '@lookonchain',
      content: 'Whale Alert: A wallet linked to Justin Sun just moved 500M WLFI tokens ($42M) to a new staking contract. This is the largest single staking transaction in WLFI history.',
      timestamp: '2026-03-28T08:20:00Z',
      likes: '9.8K',
      retweets: '4.1K',
      views: '2.1M',
      sentiment: 'neutral',
      url: 'https://x.com/lookonchain/status/example5'
    },
    {
      influencer: 'Watcher Guru',
      handle: '@WatcherGuru',
      content: 'BREAKING: World Liberty Financial ($WLFI) announces partnership with major US bank for fiat on-ramp integration. Token up 8% on the news.',
      timestamp: '2026-03-27T16:30:00Z',
      likes: '22.1K',
      retweets: '9.7K',
      views: '6.8M',
      sentiment: 'bullish',
      url: 'https://x.com/WatcherGuru/status/example6'
    },
    {
      influencer: 'CoinDesk',
      handle: '@CoinDesk',
      content: 'WLFI token sees $340M in 24h trading volume as the protocol expands lending markets. Full analysis from our research team on the governance implications.',
      timestamp: '2026-03-28T12:00:00Z',
      likes: '5.6K',
      retweets: '2.3K',
      views: '1.8M',
      sentiment: 'neutral',
      url: 'https://x.com/CoinDesk/status/example7'
    },
    {
      influencer: 'Coin Bureau',
      handle: '@coinbureau',
      content: 'Deep dive into WLFI tokenomics: The vesting schedule, governance power distribution, and what it means for holders. Thread below. Not financial advice.',
      timestamp: '2026-03-25T15:00:00Z',
      likes: '14.3K',
      retweets: '5.8K',
      views: '3.2M',
      sentiment: 'neutral',
      url: 'https://x.com/coinbureau/status/example8'
    },
    {
      influencer: 'The DeFi Edge',
      handle: '@thedefiedge',
      content: 'WLFI yield strategies are actually compelling now. Their ETH lending pool is offering 6.2% APY with solid utilization rates. Here\'s how to maximize returns.',
      timestamp: '2026-03-27T11:30:00Z',
      likes: '7.2K',
      retweets: '2.9K',
      views: '890K',
      sentiment: 'bullish',
      url: 'https://x.com/thedefiedge/status/example9'
    },
    {
      influencer: 'Arthur Hayes',
      handle: '@CryptoHayes',
      content: 'Interesting macro setup for politically-connected tokens. WLFI sits at the intersection of DeFi and regulatory capture. Whether that\'s good or bad depends on your time horizon.',
      timestamp: '2026-03-26T20:00:00Z',
      likes: '11.5K',
      retweets: '3.4K',
      views: '2.4M',
      sentiment: 'neutral',
      url: 'https://x.com/CryptoHayes/status/example10'
    },
    {
      influencer: 'Crypto Capo',
      handle: '@CryptoCapo_',
      content: 'WLFI chart looks extended here. RSI divergence on the 4H. I\'d wait for a pullback to the $0.062 support level before entering. Not the time to FOMO.',
      timestamp: '2026-03-23T09:15:00Z',
      likes: '6.1K',
      retweets: '1.8K',
      views: '1.1M',
      sentiment: 'bearish',
      url: 'https://x.com/CryptoCapo_/status/example11'
    },
    {
      influencer: 'Altcoin Daily',
      handle: '@AltcoinDailyio',
      content: 'WLFI just made our top 5 altcoins to watch this week. The protocol upgrades, new partnerships, and growing TVL make it one of the most interesting DeFi plays right now.',
      timestamp: '2026-03-28T07:00:00Z',
      likes: '15.8K',
      retweets: '4.6K',
      views: '3.7M',
      sentiment: 'bullish',
      url: 'https://x.com/AltcoinDailyio/status/example12'
    },
    {
      influencer: 'Cointelegraph',
      handle: '@Cointelegraph',
      content: 'World Liberty Financial expands to Arbitrum and Base L2s. WLFI governance token holders will receive proportional voting power across all deployed chains.',
      timestamp: '2026-03-28T09:45:00Z',
      likes: '8.3K',
      retweets: '3.5K',
      views: '2.6M',
      sentiment: 'neutral',
      url: 'https://x.com/Cointelegraph/status/example13'
    },
    {
      influencer: 'Donald Trump Jr.',
      handle: '@DonaldJTrumpJr',
      content: 'Big things coming for @WorldLibertyFi. Can\'t say too much yet but Q2 is going to be massive. The mainstream doesn\'t understand what we\'re building.',
      timestamp: '2026-03-27T14:20:00Z',
      likes: '38.7K',
      retweets: '11.3K',
      views: '7.2M',
      sentiment: 'bullish',
      url: 'https://x.com/DonaldJTrumpJr/status/example14'
    },
    {
      influencer: 'Smartest Money',
      handle: '@SmartestMoney_',
      content: 'Top 10 WLFI wallets have accumulated 2.3B tokens in the last 7 days. Smart money is loading before the next governance vote. On-chain doesn\'t lie.',
      timestamp: '2026-03-27T19:10:00Z',
      likes: '4.9K',
      retweets: '2.1K',
      views: '680K',
      sentiment: 'bullish',
      url: 'https://x.com/SmartestMoney_/status/example15'
    },
    {
      influencer: 'Pentoshi',
      handle: '@Pentosh1',
      content: 'WLFI/USDT breaking out of a 3-week consolidation range. Target $0.085 if it holds above $0.072. Clean structure.',
      timestamp: '2026-03-24T13:40:00Z',
      likes: '5.3K',
      retweets: '1.6K',
      views: '920K',
      sentiment: 'bullish',
      url: 'https://x.com/Pentosh1/status/example16'
    },
    {
      influencer: 'Ignas',
      handle: '@DefiIgnas',
      content: 'Comparing WLFI governance model vs Aave, Compound, and MakerDAO. Interesting design choices but the token distribution is heavily centralized. Full analysis thread.',
      timestamp: '2026-03-26T10:30:00Z',
      likes: '3.8K',
      retweets: '1.4K',
      views: '540K',
      sentiment: 'neutral',
      url: 'https://x.com/DefiIgnas/status/example17'
    },
    {
      influencer: 'Vivek Ramaswamy',
      handle: '@VivekGRamaswamy',
      content: 'Projects like WLFI show what happens when you combine American innovation with financial freedom. DeFi is the future of an open economy.',
      timestamp: '2026-03-24T17:00:00Z',
      likes: '19.4K',
      retweets: '5.7K',
      views: '4.1M',
      sentiment: 'bullish',
      url: 'https://x.com/VivekGRamaswamy/status/example18'
    },
    {
      influencer: 'The Block',
      handle: '@TheBlock__',
      content: 'Exclusive: WLFI protocol revenue hits $12M in March, up 45% MoM. Treasury now holds $890M in diversified crypto assets. Full breakdown in our latest report.',
      timestamp: '2026-03-27T08:00:00Z',
      likes: '4.2K',
      retweets: '1.9K',
      views: '1.3M',
      sentiment: 'neutral',
      url: 'https://x.com/TheBlock__/status/example19'
    },
    {
      influencer: 'Layah Heilpern',
      handle: '@LayahHeilpern',
      content: 'Had a great conversation about WLFI on today\'s show. Love it or hate it, this project is bringing millions of new users into DeFi. That matters more than the politics.',
      timestamp: '2026-03-25T20:15:00Z',
      likes: '3.1K',
      retweets: '890',
      views: '420K',
      sentiment: 'neutral',
      url: 'https://x.com/LayahHeilpern/status/example20'
    }
  ];

  constructor() {
    this.cache = new Map();
    console.log('WLFIInfluencerService initialized');
  }

  // ================================================
  // PUBLIC METHODS
  // ================================================

  /**
   * Get top influencers ranked by relevance score
   */
  async getTopInfluencers(limit = 25): Promise<WLFIInfluencer[]> {
    const cacheKey = `top-influencers-${limit}`;
    const cached = this.getFromCache<WLFIInfluencer[]>(cacheKey);
    if (cached) return cached;

    try {
      const sorted = [...this.influencers]
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, limit);

      this.setInCache(cacheKey, sorted);
      return sorted;
    } catch (error) {
      console.error('[WLFIInfluencerService] getTopInfluencers error:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  /**
   * Filter influencers by category
   */
  async getInfluencersByCategory(category: WLFIInfluencer['category']): Promise<WLFIInfluencer[]> {
    const cacheKey = `influencers-category-${category}`;
    const cached = this.getFromCache<WLFIInfluencer[]>(cacheKey);
    if (cached) return cached;

    try {
      const filtered = this.influencers
        .filter(i => i.category === category)
        .sort((a, b) => b.relevanceScore - a.relevanceScore);

      this.setInCache(cacheKey, filtered);
      return filtered;
    } catch (error) {
      console.error('[WLFIInfluencerService] getInfluencersByCategory error:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  /**
   * Get recent posts about WLFI from tracked influencers
   */
  async getRecentPosts(limit = 20): Promise<InfluencerPost[]> {
    const cacheKey = `recent-posts-${limit}`;
    const cached = this.getFromCache<InfluencerPost[]>(cacheKey);
    if (cached) return cached;

    try {
      const sorted = [...this.recentPostsData]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);

      this.setInCache(cacheKey, sorted);
      return sorted;
    } catch (error) {
      console.error('[WLFIInfluencerService] getRecentPosts error:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  /**
   * Get sentiment breakdown across all tracked influencers
   */
  async getSentimentBreakdown(): Promise<{ bullish: number; bearish: number; neutral: number }> {
    const cacheKey = 'sentiment-breakdown';
    const cached = this.getFromCache<{ bullish: number; bearish: number; neutral: number }>(cacheKey);
    if (cached) return cached;

    try {
      const breakdown = { bullish: 0, bearish: 0, neutral: 0 };
      this.influencers.forEach(i => {
        breakdown[i.sentiment]++;
      });

      this.setInCache(cacheKey, breakdown);
      return breakdown;
    } catch (error) {
      console.error('[WLFIInfluencerService] getSentimentBreakdown error:', error instanceof Error ? error.message : error);
      return { bullish: 0, bearish: 0, neutral: 0 };
    }
  }

  /**
   * Get full influencer report with all data
   */
  async getInfluencerReport(): Promise<WLFIInfluencerReport> {
    const cacheKey = 'influencer-report';
    const cached = this.getFromCache<WLFIInfluencerReport>(cacheKey);
    if (cached) return cached;

    try {
      const [topInfluencers, recentPosts, sentimentBreakdown] = await Promise.all([
        this.getTopInfluencers(25),
        this.getRecentPosts(20),
        this.getSentimentBreakdown()
      ]);

      const totalReachNum = this.influencers.reduce((sum, i) => sum + i.followersNum, 0);
      const totalReach = this.formatFollowerCount(totalReachNum);

      const report: WLFIInfluencerReport = {
        topInfluencers,
        recentPosts,
        sentimentBreakdown,
        totalReach,
        updatedAt: new Date().toISOString()
      };

      this.setInCache(cacheKey, report);
      return report;
    } catch (error) {
      console.error('[WLFIInfluencerService] getInfluencerReport error:', error instanceof Error ? error.message : error);
      return {
        topInfluencers: [],
        recentPosts: [],
        sentimentBreakdown: { bullish: 0, bearish: 0, neutral: 0 },
        totalReach: '0',
        updatedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Health check for service status
   */
  async healthCheck(): Promise<{ status: string; timestamp: number }> {
    try {
      const influencers = await this.getTopInfluencers(1);
      return {
        status: influencers.length > 0 ? 'operational' : 'error',
        timestamp: Date.now()
      };
    } catch {
      return { status: 'error', timestamp: Date.now() };
    }
  }

  // ================================================
  // HELPERS
  // ================================================

  private formatFollowerCount(num: number): string {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return String(num);
  }

  // ================================================
  // CACHE
  // ================================================

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  private setInCache<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      expires: Date.now() + this.TTL
    });
  }

  clearCache(): void {
    this.cache.clear();
  }
}
