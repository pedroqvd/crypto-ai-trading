# Second-Order Audit + Production Plan (2026-04-23)

## 1. Diagnóstico atual
- Não há lookahead explícito no lookup de probabilidades externas.
- Persistem riscos de edge falso por construção no universo de coleta e rotulagem de resolução.
- Execução continua proxy; falta calibração com L2 real.

## 2. Falhas restantes
- Selection/survivorship bias por coleta top-volume + filtros de liquidez/volume.
- Rotulagem de resolução por `lastTradePrice` (não fonte oficial de settlement).
- Dependência alta de Metaculus no pipeline de consenso.
- Robustez de matching ainda limitada por uma única correspondência best-match.
- Overfitting indireto possível via thresholds fixos globais.

## 3. Critérios de validação
- Skill score > 0.05 com IC95% lower bound > 0.
- N OOS >= 600 trades.
- WR_excess > 3pp (teste unilateral p<0.05).
- EV > 0.5% por trade líquido.
- Sharpe >= 1.5 e Sortino >= 2.0.
- Max DD <= 20% e ES95 mensal <= 8%.

## 4. Backtest definitivo
- Split por signal_time (não resolution_time).
- Universo completo elegível por timestamp.
- Replay causal com t_signal != t_order != t_fill.
- Separar avaliação com/sem fonte externa (Metaculus).

## 5. Robustez final
- Adicionar “combinatorial purge” temporal CV.
- Stress de capacity (impact escalando com AUM).
- Teste de estabilidade por regimes e por categoria de mercado.

## 6. Edge plausível?
- Classificação: LIMITADO.
- Nichos: negRisk dislocations + poucos casos de consenso com matching muito confiável.
- Frequência esperada: baixa/moderada.
- Retorno mensal realista: 0.5% a 2.0% após custos.

## 7. Checklist de produção
- 12+ semanas de snapshots consistentes.
- 600+ trades OOS.
- Critérios quantitativos completos batidos.
- Robustez avançada sem colapsos.
- Execução calibrada com dados reais de fill/slippage.

## 8. Bot #2 (microestrutura)
- Motor separado sem Metaculus.
- Sinais: spread capture, negRisk puro, desbalanceamento de profundidade.
- Execução: market making tático + inventory/risk shared com bot principal.
- Orquestração por budget de risco global por evento e por estratégia.
