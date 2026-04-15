// ================================================
// ENTRY POINT — Polymarket AI Autonomous Trader
// ================================================

import 'dotenv/config';
import { TradingEngine } from './engine/TradingEngine';
import { DashboardServer } from './dashboard/DashboardServer';

async function main(): Promise<void> {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║     🤖 POLYMARKET AI AUTONOMOUS TRADER       ║
  ║         Powered by Edge + Kelly              ║
  ╚══════════════════════════════════════════════╝
  `);

  // Initialize engine
  const engine = new TradingEngine();
  engineRef = engine;

  // Initialize dashboard server
  const dashboard = new DashboardServer(engine);

  // Start dashboard first (so you can monitor from the start)
  dashboard.start();

  // Start the autonomous trading engine
  await engine.start();
}

// Handle graceful shutdown
let engineRef: import('./engine/TradingEngine').TradingEngine | null = null;

function shutdown(signal: string): void {
  console.log(`\n🛑 ${signal} received, shutting down gracefully...`);
  if (engineRef) engineRef.stop();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  console.error('💀 Fatal error:', err);
  process.exit(1);
});
