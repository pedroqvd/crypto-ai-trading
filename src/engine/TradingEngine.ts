// ================================================
// TRADING ENGINE — Autonomous Orchestrator
// The brain that runs the full trading loop
// ================================================

import { EventEmitter } from 'events';
import { config } from './Config';
import { SettingsService } from '../services/SettingsService';
import { logger } from '../utils/Logger';
import { TradeJournal, TradeRecord } from '../utils/TradeJournal';
import { GammaApiClient, ParsedMarket, ParsedEvent } from '../services/GammaApiClient';
import { ClobApiClient } from '../services/ClobApiClient';
import { NotificationService } from '../services/NotificationService';
import { NewsApiClient } from '../services/NewsApiClient';
import { BackupService } from '../services/BackupService';
import { CriticalEventMonitor } from '../services/CriticalEventMonitor';
import { ProbabilityEstimator } from '../analysis/ProbabilityEstimator';
import { EdgeCalculator, EdgeAnalysis } from '../analysis/EdgeCalculator';
import { KellyCalculator } from '../analysis/KellyCalculator';
import { RiskManager } from '../risk/RiskManager';
import { CorrelationAnalyzer } from '../analysis/CorrelationAnalyzer';
import { ClaudeAnalyzer } from '../services/ClaudeAnalyzer';
import { BayesianCalibrator } from '../analysis/BayesianCalibrator';
import { EnsembleWeightTracker } from '../analysis/EnsembleWeightTracker';
import { ConsensusClient } from '../services/ConsensusClient';
import { MarketQualityAnalyzer } from '../analysis/MarketQualityAnalyzer';
import { PerformanceMetrics } from '../utils/PerformanceMetrics';
import { HealthMonitor } from './HealthMonitor';
import { MarketScanner } from './MarketScanner';
import { TradeAnalyzer } from './TradeAnalyzer';
import { TradeExecutor } from './TradeExecutor';
import { PositionMonitor } from './PositionMonitor';
import { SignalSnapshot, PositionTrackState, LogDecisionFn, EmitFn } from './engine-types';


export interface EngineStatus {
  running: boolean;
  dryRun: boolean;
  uptime: number;
  startTime: number;
  cycleCount: number;
  marketsScanned: number;
  opportunitiesFound: number;
  tradesExecuted: number;
  bankroll: number;
  totalPnl: number;
  lastScanAt: string;
}

export interface DecisionLog {
  timestamp: string;
  type: 'scan' | 'opportunity' | 'trade' | 'reject' | 'risk' | 'monitor' | 'system';
  message: string;
  data?: Record<string, unknown>;
}

export class TradingEngine extends EventEmitter {
  // Services
  private gammaApi: GammaApiClient;
  private clobApi: ClobApiClient;
  private notifications: NotificationService;
  private newsApi: NewsApiClient;
  private journal: TradeJournal;
  private backupService: BackupService;
  private eventMonitor: CriticalEventMonitor;

  // Analysis
  private probEstimator: ProbabilityEstimator;
  private edgeCalc: EdgeCalculator;
  private kellyCalc: KellyCalculator;
  private riskManager: RiskManager;
  private correlationAnalyzer: CorrelationAnalyzer;
  private claudeAnalyzer: ClaudeAnalyzer | null = null;
  private calibrator: BayesianCalibrator;
  private ensembleTracker: EnsembleWeightTracker;
  private consensusClient: ConsensusClient;
  private qualityAnalyzer: MarketQualityAnalyzer;
  private performanceMetrics: PerformanceMetrics;
  private healthMonitor: HealthMonitor;
  // In-memory signal snapshots for ensemble learning (tradeId → signals)
  private tradeSignals = new Map<string, SignalSnapshot[]>();

  // State
  private running = false;
  private cycleRunning = false; // guard against concurrent cycles (e.g. slow Claude retries)
  private cycleCount = 0;
  private startTime = 0;
  private marketsScanned = 0;
  private opportunitiesFound = 0;
  private tradesExecuted = 0;
  private lastScanAt = '';
  private sessionStartBankroll = 0;
  private decisionLog: DecisionLog[] = [];
  private maxDecisionLog = 100;
  private activeMarketIds: Set<string> = new Set();
  private lastDailyReportDate = '';
  // Per-position tracking for trailing stop and momentum exit
  private positionState = new Map<string, PositionTrackState>();
  // Stores signal snapshots by marketId for ensemble learning
  private pendingSignals = new Map<string, SignalSnapshot[]>();

  // Sub-modules
  private scanner!: MarketScanner;
  private analyzer!: TradeAnalyzer;
  private executor!: TradeExecutor;
  private monitor!: PositionMonitor;

  constructor() {
    super();
    SettingsService.load();
    this.gammaApi = new GammaApiClient();
    this.clobApi = new ClobApiClient();
    this.notifications = new NotificationService();
    this.newsApi = new NewsApiClient();
    this.backupService = new BackupService();
    this.eventMonitor = new CriticalEventMonitor();
    this.journal = new TradeJournal();
    this.probEstimator = new ProbabilityEstimator();
    this.edgeCalc = new EdgeCalculator();
    this.kellyCalc = new KellyCalculator();
    this.riskManager = new RiskManager(this.journal);
    this.correlationAnalyzer = new CorrelationAnalyzer();
    this.calibrator = new BayesianCalibrator();
    this.ensembleTracker = new EnsembleWeightTracker();
    this.consensusClient = new ConsensusClient();
    this.qualityAnalyzer = new MarketQualityAnalyzer();
    this.performanceMetrics = new PerformanceMetrics();
    this.healthMonitor = new HealthMonitor(!config.dryRun, (health) => {
      const icon = health.status === 'up' ? '✅' : '🔴';
      this.logDecision('system', `${icon} API ${health.name} → ${health.status.toUpperCase()}${health.lastError ? ': ' + health.lastError : ''}`);
      this.notifications.notifySystemEvent(`${icon} ${health.name} ${health.status.toUpperCase()}`)
        .catch(() => {/* non-blocking */});
    });
    if (config.claudeEnabled && config.claudeApiKey) {
      this.claudeAnalyzer = new ClaudeAnalyzer(config.claudeApiKey, config.claudeMaxCallsPerCycle);
      logger.info('Engine', '🤖 Claude AI analysis enabled');
    }

    const openTrades = this.journal.getOpenTrades();
    openTrades.forEach(t => this.activeMarketIds.add(t.marketId));

    const historicalStats = this.journal.getStats();
    if (historicalStats.totalPnl !== 0) {
      this.riskManager.updateBankroll(config.bankroll + historicalStats.totalPnl);
    }

    // Instantiate sub-modules (after all services/analysis/risk are ready)
    const logFn: LogDecisionFn = this.logDecision.bind(this);
    const emitFn: EmitFn = this.emit.bind(this);

    this.scanner = new MarketScanner(this.gammaApi, this.qualityAnalyzer, this.activeMarketIds, logFn, emitFn);
    this.analyzer = new TradeAnalyzer(this.probEstimator, this.edgeCalc, this.calibrator, this.ensembleTracker, this.consensusClient, this.correlationAnalyzer, this.pendingSignals, this.activeMarketIds, logFn);
    this.executor = new TradeExecutor(this.clobApi, this.gammaApi, this.newsApi, this.claudeAnalyzer, this.kellyCalc, this.riskManager, this.edgeCalc, this.journal, this.notifications, this.activeMarketIds, this.pendingSignals, this.tradeSignals, logFn, emitFn);
    this.monitor = new PositionMonitor(this.clobApi, this.gammaApi, this.riskManager, this.calibrator, this.ensembleTracker, this.journal, this.notifications, this.edgeCalc, this.consensusClient, this.activeMarketIds, this.positionState, this.tradeSignals, logFn, emitFn);
  }

  // ========================================
  // MAIN LOOP
  // ========================================
  async start(): Promise<void> {
    this.running = true;
    this.startTime = Date.now();
    this.sessionStartBankroll = this.riskManager.getStatus().bankroll;

    const mode = config.dryRun ? '🏜️ DRY-RUN' : '⚡ LIVE';
    logger.info('Engine', `\n🚀 ========================================`);
    logger.info('Engine', `📊 POLYMARKET AI TRADER — ${mode} MODE`);
    logger.info('Engine', `💰 Bankroll: $${config.bankroll}`);
    logger.info('Engine', `📐 Kelly Fraction: ${(config.kellyFraction * 100).toFixed(0)}%`);
    logger.info('Engine', `🎯 Min Edge: ${(config.minEdge * 100).toFixed(0)}%`);
    logger.info('Engine', `🚪 Exit Target: ${(config.exitPriceTarget * 100).toFixed(0)}%`);
    logger.info('Engine', `📰 News: ${config.newsApiKey ? `✅ (${config.newsRelevanceHours}h window)` : '❌ disabled'}`);
    logger.info('Engine', `🔗 Correlation: ${config.correlationEnabled ? '✅' : '❌'}`);
    logger.info('Engine', `⏱️ Scan Interval: ${config.scanIntervalMs / 1000}s`);
    logger.info('Engine', `🚀 ========================================\n`);

    // PRIVATE_KEY validation — force DRY-RUN if key missing
    if (!config.dryRun && !config.privateKey) {
      logger.warn('Engine', '⚠️ PRIVATE_KEY não configurada — forçando DRY-RUN por segurança.');
      config.dryRun = true;
      this.logDecision('system', '⚠️ Modo forçado para DRY-RUN: PRIVATE_KEY não configurada');
      this.emit('statusUpdate', this.getStatus());
    }

    this.logDecision('system', `Engine iniciado em modo ${mode}. Bankroll: $${config.bankroll}`);
    await this.notifications.notifySystemEvent(`Bot iniciado em modo ${mode}. Bankroll: $${config.bankroll}`);

    this.healthMonitor.start();

    // Initialize CLOB client
    const clobReady = await this.clobApi.initialize();
    if (!clobReady && !config.dryRun) {
      logger.error('Engine', '❌ Falha ao inicializar CLOB client em modo LIVE. Abortando.');
      this.running = false;
      return;
    }

    while (this.running) {
      try {
        await this.runCycle();
      } catch (err) {
        logger.error('Engine', 'Cycle error', err instanceof Error ? err.message : err);
        this.logDecision('system', `Erro no ciclo: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
      await this.sleep(config.scanIntervalMs);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  updateConfig(updates: Partial<{
    dryRun: boolean;
    bankroll: number;
    kellyFraction: number;
    minEdge: number;
    maxPositionPct: number;
    maxTotalExposurePct: number;
    scanIntervalMs: number;
    exitPriceTarget: number;
    stopLossPct: number;
    trailingStopActivation: number;
    trailingStopDistance: number;
    timeDecayHours: number;
    edgeReversalEnabled: boolean;
    momentumExitCycles: number;
    correlationEnabled: boolean;
    claudeEnabled: boolean;
    claudeApiKey: string;
    calibrationEnabled: boolean;
    discordWebhookUrl: string;
    privateKey: string;
    newsApiKey: string;
    tradeMode: string;
  }>): void {
    Object.assign(config, updates);
    SettingsService.save();
    if (updates.bankroll !== undefined) {
      this.riskManager.updateBankroll(updates.bankroll);
    }
    // Reinitialize Claude if key or enabled state changed
    if (updates.claudeApiKey !== undefined || updates.claudeEnabled !== undefined) {
      this.claudeAnalyzer = (config.claudeEnabled && config.claudeApiKey)
        ? new ClaudeAnalyzer(config.claudeApiKey, config.claudeMaxCallsPerCycle)
        : null;
      this.executor.setClaudeAnalyzer(this.claudeAnalyzer);
    }
    logger.info('Engine', `⚙️ Config atualizada: ${JSON.stringify(
      Object.fromEntries(Object.entries(updates).map(([k, v]) =>
        [k, k.includes('Key') || k === 'privateKey' ? '***' : v]
      ))
    )}`);
  }

  getPublicConfig(): Record<string, unknown> {
    return {
      dryRun: config.dryRun,
      bankroll: config.bankroll,
      kellyFraction: config.kellyFraction,
      minEdge: config.minEdge,
      maxPositionPct: config.maxPositionPct,
      maxTotalExposurePct: config.maxTotalExposurePct,
      scanIntervalMs: config.scanIntervalMs,
      exitPriceTarget: config.exitPriceTarget,
      stopLossPct: config.stopLossPct,
      trailingStopActivation: config.trailingStopActivation,
      trailingStopDistance: config.trailingStopDistance,
      timeDecayHours: config.timeDecayHours,
      edgeReversalEnabled: config.edgeReversalEnabled,
      momentumExitCycles: config.momentumExitCycles,
      correlationEnabled: config.correlationEnabled,
      claudeEnabled: config.claudeEnabled,
      calibrationEnabled: config.calibrationEnabled,
      discordWebhookUrl: config.discordWebhookUrl || '',
      privateKey: config.privateKey ? '••••••••••••' : '',
      newsApiKey: config.newsApiKey ? '••••••••••••' : '',
      claudeApiKey: config.claudeApiKey ? '••••••••••••' : '',
    };
  }

  getCalibrationReport() {
    return this.calibrator.getCalibrationReport();
  }

  exportCalibrationData(): object {
    return this.calibrator.exportData();
  }

  importCalibrationData(data: unknown): void {
    this.calibrator.importData(data);
  }

  getEnsembleStats() {
    return this.ensembleTracker.getStats();
  }

  exportEnsembleData(): object {
    return this.ensembleTracker.exportData();
  }

  importEnsembleData(data: unknown): void {
    this.ensembleTracker.importData(data);
  }

  getPerformanceReport() {
    return this.performanceMetrics.compute(
      this.journal.getAllTrades(),
      this.sessionStartBankroll || config.bankroll
    );
  }

  stop(): void {
    this.running = false;
    this.healthMonitor.stop();
    logger.info('Engine', '🛑 Engine stopped');
    this.logDecision('system', 'Engine parado');
  }

  async gracefulShutdown(): Promise<void> {
    this.running = false;
    logger.info('Engine', '🛑 Graceful shutdown iniciado...');

    if (!config.dryRun) {
      const openTrades = this.journal.getOpenTrades();
      if (openTrades.length > 0) {
        logger.warn('Engine', `⚠️ ${openTrades.length} posição(ões) abertas no shutdown. Tentando cancelar ordens CLOB...`);
        for (const trade of openTrades) {
          try {
            const cancelled = await this.clobApi.cancelOrder(trade.id);
            if (cancelled) {
              logger.info('Engine', `   ✅ Ordem ${trade.id.slice(0, 12)} cancelada`);
            } else {
              logger.warn('Engine', `   ⚠️ Falha ao cancelar ordem ${trade.id.slice(0, 12)}`);
            }
          } catch (err) {
            logger.error('Engine', `   ❌ Erro ao cancelar ${trade.id}: ${err instanceof Error ? err.message : err}`);
          }
        }
      }
    }

    await this.notifications.notifySystemEvent('Bot encerrado graciosamente.');
    logger.info('Engine', '✅ Shutdown completo.');
  }

  // ========================================
  // SINGLE CYCLE
  // ========================================
  private async runCycle(): Promise<void> {
    if (this.cycleRunning) {
      logger.warn('Engine', 'Previous cycle still running — skipping this tick.');
      return;
    }
    this.cycleRunning = true;
    try {
      await this.runCycleInner();
    } finally {
      this.cycleRunning = false;
    }
  }

  private async runCycleInner(): Promise<void> {
    this.cycleCount++;
    this.lastScanAt = new Date().toISOString();
    this.claudeAnalyzer?.resetCycleCounter();
    this.executor.resetClaudeCycleCounter();
    this.consensusClient.resetCycleCounter();
    logger.info('Engine', `\n--- Ciclo #${this.cycleCount} ---`);

    const { markets, events } = await this.scanner.scan();
    this.marketsScanned = markets.length;
    if (markets.length === 0) {
      logger.info('Engine', `[Ciclo #${this.cycleCount}] STEP1: Nenhum mercado retornado pela API.`);
      return;
    }
    logger.info('Engine', `[Ciclo #${this.cycleCount}] STEP1: ${markets.length} mercados obtidos da API.`);

    const filtered = this.scanner.filter(markets);
    logger.info('Engine', `[Ciclo #${this.cycleCount}] STEP2: ${markets.length} → ${filtered.length} mercados após filtros de qualidade/liquidez.`);
    if (filtered.length === 0) {
      logger.info('Engine', `[Ciclo #${this.cycleCount}] STEP2: Todos os mercados eliminados nos filtros. Aguardando próximo ciclo.`);
    }

    const opportunities = await this.analyzer.analyze(filtered, markets);
    this.opportunitiesFound = opportunities.length;
    logger.info('Engine', `[Ciclo #${this.cycleCount}] STEP3: ${opportunities.length} oportunidades com edge >= ${(config.minEdge * 100).toFixed(0)}% encontradas.`);

    let correlationOpps: EdgeAnalysis[] = [];
    if (config.correlationEnabled && events.length > 0) {
      correlationOpps = await this.analyzer.analyzeCorrelation(events, markets);
      if (correlationOpps.length > 0) {
        logger.info('Engine', `[Ciclo #${this.cycleCount}] STEP4: +${correlationOpps.length} oportunidades de correlação.`);
      }
    }

    const allOpportunities = [...opportunities];
    for (const corrOpp of correlationOpps) {
      if (!allOpportunities.some(o => o.marketId === corrOpp.marketId)) {
        allOpportunities.push(corrOpp);
      }
    }
    allOpportunities.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
    logger.info('Engine', `[Ciclo #${this.cycleCount}] STEP5: Tentando executar ${Math.min(allOpportunities.length, 3)} oportunidades.`);

    const executedNow = await this.executor.execute(allOpportunities, this.cycleCount);
    this.tradesExecuted += executedNow;
    logger.info('Engine', `[Ciclo #${this.cycleCount}] STEP5: ${executedNow} trade(s) executado(s) neste ciclo. Total acumulado: ${this.tradesExecuted}.`);

    this.pendingSignals.clear();

    await this.monitor.monitor(markets);

    if (this.cycleCount % 10 === 0) await this.syncBalance();
    if (this.cycleCount % 240 === 0) await this.performBackup();
    await this.maybeSendDailyReport();

    this.emit('statusUpdate', this.getStatus());
  }


  // ========================================
  // BACKUP (every 240 cycles)
  // ========================================
  private async performBackup(): Promise<void> {
    const calibration = this.exportCalibrationData();
    const ensemble = this.exportEnsembleData();
    const trades = this.journal.getAllTrades();

    const success = await this.backupService.createBackup(calibration, ensemble, trades);
    if (success) {
      this.logDecision('system', '💾 Backup automático criado com sucesso');
    }
  }

  // ========================================
  // BALANCE SYNC (every 10 cycles)
  // ========================================
  private async syncBalance(): Promise<void> {
    logger.debug('Engine', 'Sincronizando saldo on-chain...');

    const onChainBalance = await this.clobApi.getBalance();
    const engineBalance  = this.riskManager.getStatus().bankroll;

    if (engineBalance <= 0) return;

    const divergencePct = Math.abs(onChainBalance - engineBalance) / engineBalance * 100;

    if (divergencePct > 5) {
      const msg =
        `Divergência de saldo detectada: on-chain $${onChainBalance.toFixed(2)} ` +
        `vs engine $${engineBalance.toFixed(2)} (${divergencePct.toFixed(1)}%)`;

      logger.warn('Engine', msg);
      this.logDecision('system', `⚠️ ${msg}`);
      await this.notifications.notifyRiskAlert(msg);
      this.riskManager.updateBankroll(onChainBalance);
    } else {
      logger.debug('Engine',
        `Saldo sincronizado — on-chain $${onChainBalance.toFixed(2)}, ` +
        `engine $${engineBalance.toFixed(2)} (divergência ${divergencePct.toFixed(1)}%)`
      );
    }
  }

  // ========================================
  // STATE & STATUS
  // ========================================
  getStatus(): EngineStatus {
    const riskStatus = this.riskManager.getStatus();
    return {
      running: this.running,
      dryRun: config.dryRun,
      uptime: Date.now() - this.startTime,
      startTime: this.startTime,
      cycleCount: this.cycleCount,
      marketsScanned: this.marketsScanned,
      opportunitiesFound: this.opportunitiesFound,
      tradesExecuted: this.tradesExecuted,
      bankroll: riskStatus.bankroll,
      totalPnl: riskStatus.bankroll - this.sessionStartBankroll,
      lastScanAt: this.lastScanAt,
    };
  }

  getRecentDecisions(count = 20): DecisionLog[] {
    return this.decisionLog.slice(-count);
  }

  getNotificationService(): NotificationService {
    return this.notifications;
  }

  getBackupService(): BackupService {
    return this.backupService;
  }

  getCriticalEventMonitor(): CriticalEventMonitor {
    return this.eventMonitor;
  }

  getJournal(): TradeJournal {
    return this.journal;
  }

  getRiskManager(): RiskManager {
    return this.riskManager;
  }

  async testAllConnections(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {
      gamma: false,
      clob: false,
      news: false,
      claude: false,
      notifications: false
    };

    try {
      const tests = await Promise.allSettled([
        this.gammaApi.testConnection(),
        this.clobApi.testConnection(),
        this.newsApi.testConnection(),
        this.claudeAnalyzer ? this.claudeAnalyzer.testConnection() : Promise.resolve(false),
        this.notifications.testConnection()
      ]);

      if (tests[0].status === 'fulfilled') results.gamma = tests[0].value;
      if (tests[1].status === 'fulfilled') results.clob = tests[1].value;
      if (tests[2].status === 'fulfilled') results.news = tests[2].value;
      if (tests[3].status === 'fulfilled') results.claude = tests[3].value;
      if (tests[4].status === 'fulfilled') results.notifications = tests[4].value;
    } catch (err) {
      logger.error('Engine', 'Error during connection tests', err);
    }

    return results;
  }

  getApiHealth() {
    return this.healthMonitor.getHealth();
  }

  // ========================================
  // DAILY REPORT
  // ========================================
  private async maybeSendDailyReport(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    if (today === this.lastDailyReportDate) return;

    this.lastDailyReportDate = today;
    const stats = this.journal.getStats();
    const riskStatus = this.riskManager.getStatus();

    await this.notifications.notifyDailyReport({
      date: today,
      trades: stats.totalTrades,
      openTrades: stats.openTrades,
      wins: stats.wins,
      losses: stats.losses,
      winRate: stats.winRate.toFixed(1),
      pnl: stats.totalPnl.toFixed(2),
      bankroll: riskStatus.bankroll.toFixed(2),
      drawdownPct: riskStatus.drawdownPct.toFixed(1),
      avgEdge: (stats.avgEdge * 100).toFixed(1),
      bestTrade: stats.bestTrade.toFixed(2),
      worstTrade: stats.worstTrade.toFixed(2),
    });

    this.logDecision('system', `📊 Relatório diário enviado para ${today}`);
  }

  private logDecision(type: DecisionLog['type'], message: string, data?: Record<string, unknown>): void {
    const entry: DecisionLog = {
      timestamp: new Date().toISOString(),
      type,
      message,
      data,
    };

    this.decisionLog.push(entry);
    if (this.decisionLog.length > this.maxDecisionLog) {
      this.decisionLog = this.decisionLog.slice(-this.maxDecisionLog);
    }

    this.emit('decision', entry);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
