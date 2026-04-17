// ================================================
// ENTRY POINT — Polymarket AI Autonomous Trader
// ================================================

import 'dotenv/config';
import { TradingEngine } from './engine/TradingEngine';
import { DashboardServer } from './dashboard/DashboardServer';

const engine = new TradingEngine();
const dashboard = new DashboardServer(engine);

console.log(`
  ╔══════════════════════════════════════════════╗
  ║     🤖 POLYMARKET AI AUTONOMOUS TRADER       ║
  ║         Powered by Edge + Kelly              ║
  ╚══════════════════════════════════════════════╝
`);

function shutdown(signal: string): void {
  console.log(`\n🛑 ${signal} received, shutting down gracefully...`);
  engine.stop();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

(async () => {
  dashboard.start();
  await engine.start();
})().catch((err) => {
  console.error('💀 Fatal error:', err);
  process.exit(1);
});
