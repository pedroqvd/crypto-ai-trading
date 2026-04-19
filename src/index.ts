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

let isShuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 ${signal} received, shutting down gracefully...`);
  await engine.gracefulShutdown();
  process.exit(0);
}

process.on('SIGINT',  () => { shutdown('SIGINT').catch(() => process.exit(1)); });
process.on('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)); });
process.on('uncaughtException', (err) => {
  console.error('💀 Uncaught exception:', err);
  shutdown('uncaughtException').catch(() => process.exit(1));
});

(async () => {
  dashboard.start();
  await engine.start();
})().catch((err) => {
  console.error('💀 Fatal error:', err);
  process.exit(1);
});
