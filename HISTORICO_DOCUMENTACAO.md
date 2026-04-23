# Histórico Consolidado de Documentação

> Objetivo: consolidar artefatos antigos de documentação em um único lugar, manter o que é útil para contexto histórico e remover redundâncias.

## Última atualização por artefato (antes da consolidação)

| Artefato antigo | Última atualização (git) | Commit | Status após consolidação |
|---|---:|---|---|
| `FALAAI.md` | 2026-04-23 10:40:27 -0300 | `91805fe` | Removido (conteúdo útil resumido abaixo) |
| `CLAUDE.md` | 2026-04-14 12:25:15 -0300 | `f572beb` | Removido (conteúdo útil resumido abaixo) |
| `CODE_AUDIT_REPORT.md` | 2026-04-21 23:38:34 +0000 | `d235ec0` | Removido (resumo executivo preservado) |
| `DEEP_AUDIT_2026-04-23.md` | 2026-04-23 19:31:54 +0000 | `919314b` | Removido (pontos acionáveis preservados) |

---

## Resumo útil preservado

### 1) Evolução funcional (sessões anteriores)
- Consolidação de sinais e ajuste de calibração no `ProbabilityEstimator`.
- Introdução de validação de conectividade de APIs via dashboard.
- Expansões de gestão de risco (Kelly dinâmico), notificações e integração de análise de notícias.
- Melhorias de UX dashboard e modos de execução (direcional / market maker).

### 2) Achados de auditoria (alto nível)
- Riscos já apontados anteriormente:
  - Persistência indevida de segredos em disco.
  - Fragilidades em parsing e tolerância a falhas de integrações externas.
  - Possível inconsistência entre módulos de sinais/execução.
- Direção técnica recomendada (mantida): priorizar segurança de segredos, robustez de execução e observabilidade de risco.

### 3) Diretrizes quantitativas (do deep audit)
- Edge só deve ser considerado validado com critérios OOS explícitos e robustez estatística.
- Backtest deve manter causalidade temporal estrita e estressar custos de execução (latência/slippage/fills parciais).
- Robustez precisa incluir testes placebo, drift temporal e regime change.

### 4) O que foi descartado por baixa utilidade operacional
- Narrativas longas de sessão, texto promocional e instruções datadas que duplicavam README/DOCKER.
- Recomendações que já foram incorporadas no código ou substituídas por fluxo atual.

---

## Fonte canônica atual de documentação

- **Visão de produto e setup principal:** `README.md`
- **Operação com containers:** `DOCKER.md`
- **Este arquivo:** histórico e trilha de decisões antigas

---

## Nota de manutenção

Quando novos artefatos “temporários” surgirem (ex.: relatórios pontuais de sessão), consolidar aqui e evitar manter múltiplos arquivos históricos soltos na raiz.
