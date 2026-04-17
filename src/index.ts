// ================================================
// ENTRY POINT — Polymarket AI Autonomous Trader
// ================================================

import 'dotenv/config';
import { TradingEngine } from './engine/TradingEngine';
import { DashboardServer } from './dashboard/DashboardServer';

// ------------------------------------------------
// Bootstrap engine + dashboard.
// The engine is always instantiated (dashboard needs it),
// but engine.start() is only called outside Vercel because
// the continuous scan loop is incompatible with serverless.
// Socket.IO real-time updates are also unavailable on Vercel
// (stateless functions can't maintain WebSocket connections).
// Use Railway / Render / Fly.io for the full bot experience.
// ------------------------------------------------
const engine = new TradingEngine();
const dashboard = new DashboardServer(engine);

// ------------------------------------------------
// Vercel serverless: export Express app as the handler.
// Vercel picks this up automatically via @vercel/node.
// ------------------------------------------------
export default dashboard.getExpressApp();

// ------------------------------------------------
// Non-Vercel (Railway, Render, VPS, local): run the
// full autonomous trading loop.
// ------------------------------------------------
if (!process.env.VERCEL) {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║     🤖 POLYMARKET AI AUTONOMOUS TRADER       ║
  ║         Powered by Edge + Kelly              ║
  ╚══════════════════════════════════════════════╝
  `);

  let engineRef: TradingEngine = engine;

  function shutdown(signal: string): void {
    console.log(`\n🛑 ${signal} received, shutting down gracefully...`);
    engineRef.stop();
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
}
