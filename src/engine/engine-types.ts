// ================================================
// ENGINE TYPES — Shared types for engine sub-modules
// ================================================

export type SignalSnapshot = { name: string; adjustment: number; weight: number };

export type PositionTrackState = { peakPrice: number; declineCount: number; lastPrice: number };

export type DecisionType = 'scan' | 'opportunity' | 'trade' | 'reject' | 'risk' | 'monitor' | 'system';

export type LogDecisionFn = (type: DecisionType, message: string, data?: Record<string, unknown>) => void;

export type EmitFn = (event: string, data?: unknown) => void;

// Monitoring constants
export const STALE_ORDER_MS        = 24 * 60 * 60 * 1000; // cancel unfilled orders after 24h
export const FORCED_EXIT_AFTER_MS  = 48 * 60 * 60 * 1000; // force-exit unresolved closed markets after 48h
export const MAX_LIQUIDITY_IMPACT  = 0.40;                 // never take more than 40% of order-book depth
export const POLYMARKET_TAKER_FEE  = 0.02;                 // 2% Polymarket taker fee
