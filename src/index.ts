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

  // Initialize dashboard server
  const dashboard = new DashboardServer(engine);

  // Start dashboard first (so you can monitor from the start)
  dashboard.start();

  // Start the autonomous trading engine
  await engine.start();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received, shutting down...');
  process.exit(0);
});

main().catch((err) => {
  console.error('💀 Fatal error:', err);
  process.exit(1);
});
