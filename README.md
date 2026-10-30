# Cockpit do BP

Cockpit para HR Business Partner de banco: telemetria das áreas atendidas, people analytics preditivo, orçamento de pessoal, vagas, WFP, subsistemas de RH interligados, insights automáticos, automação de rotinas e produção de materiais executivos — com um **agente Claude** opcional como copiloto.

> A base que acompanha o projeto é **sintética** (≈2.650 colaboradores em 8 diretorias fictícias). Nenhum dado real é incluído.

## Como abrir

1. Baixe o repositório e dê duplo clique em `index.html` — funciona offline, sem instalar nada (Chart.js está embarcado em `assets/vendor`).
2. Se o navegador bloquear arquivos locais, sirva a pasta: `python -m http.server 8090` e acesse `http://localhost:8090`.

## Módulos

| Módulo | O que entrega |
|---|---|
| **Visão geral** | KPIs com status, headcount e movimentação mensal, insights prioritários, agenda do BP e matriz de telemetria por área (clique para focar). |
| **Telemetria** | Absenteísmo, horas extras, compa-ratio, folha, férias vencidas, diversidade; tendências trimestrais. |
| **Insights inteligentes** | Motor de regras que cruza subsistemas (ex.: HE alta + absenteísmo em alta → sobrecarga; talento + compa < 0,90 → retenção), com exposição financeira, ação e playbook. Um clique cria a tarefa ou o e-mail. |
| **People Analytics** | Regressão logística treinada no navegador para prever saída voluntária em 12 meses (AUC em holdout ≈ 0,75), fatores explicativos por pessoa, 9-box × risco, lista exportável e **simulador de retenção** (mérito, HE, férias, stay interview → saídas evitadas, custo e ROI). |
| **WFP** | Oferta × demanda em 12 meses por área, com cenários (crescimento, automação/IA, retenção), pipeline de vagas e gaps de competências críticas (build × buy). |
| **Orçamento** | Orçado × realizado × forecast mensal (dissídio de setembro e 13º incluídos), desvios por área, HE e verba de treinamento. |
| **Vagas · R&S** | Funil, aging, SLA por nível, produtividade por recrutador, filtros (fora do SLA, não orçadas, aumento de quadro) e comitê de vagas. |
| **Subsistemas de RH** | 12 subsistemas (R&S, Remuneração, Desempenho, T&D, Clima, Saúde, DP, Sucessão, D&I, WFP, Orçamento, People Analytics), mapa das interligações ativas e **visão 360° do colaborador**. |
| **Automação & tarefas** | Kanban com checklists de playbooks, prazos, rascunhos de e-mail e listas exportáveis; rotinas (férias, regulatórios, risco de talentos, comitê de vagas, fechamento mensal). Tarefas ficam salvas no navegador. |
| **Materiais executivos** | One-page, pauta da reunião com o diretor, relatório de turnover, business case de headcount e nota orçamentária — prontos para imprimir/PDF, copiar ou baixar em HTML. |
| **Copiloto** | Botão flutuante. Sem agente: responde localmente (prioridades, risco, orçamento, vagas, WFP…) e gera materiais. Com agente: respostas redigidas pelo Claude usando os dados do cockpit. |

## Usando dados reais

Em **Dados & integrações**, importe CSVs (separador `;` ou `,`) nos layouts de `data/modelo_colaboradores.csv` (ativos + desligados dos últimos 12 meses) e `data/modelo_vagas.csv`. O processamento é 100% local no navegador. O modelo preditivo é re-treinado automaticamente com a sua base.

Atenção: a importação substitui colaboradores e vagas; **orçamento e competências continuam sintéticos** até você ajustá-los. O orçamento, as competências críticas e as premissas de crescimento/automação por área estão em `assets/js/data.js` (`AREAS`, `SKILLS`) — ajuste-os para o seu plano. Limiares de alerta ficam em `CONFIG` (`assets/js/analytics.js`) e `LIMIAR` (`assets/js/views.js`).

## Agente Claude (opcional)

```bash
pip install -r agent/requirements.txt
export ANTHROPIC_API_KEY=...          # ou: ant auth login

# 1. No cockpit: Dados & integrações → Exportar snapshot.json → salve em agent/snapshot.json
#    (sem esse arquivo, o agente usa agent/snapshot_exemplo.json)

python agent/bp_agent.py                          # chat no terminal
python agent/bp_agent.py --pergunta "Quais talentos de Tecnologia estão em risco e por quê?"
python agent/bp_agent.py --rotina briefing        # também: pauta, retencao
python agent/bp_agent.py --serve                  # liga o Copiloto do cockpit ao Claude
```

- Modelo `claude-opus-5-5` com raciocínio adaptativo (`--effort` controla profundidade/custo) e fallback automático em caso de recusa.
- O agente consulta os números por ferramentas (`indicadores`, `insights`, `colaboradores_em_risco`, `vagas`, `wfp_e_competencias`, `modelo_preditivo`, `tarefas`) e salva materiais em `agent/saidas/`.
- Com `--serve`, a API escuta só em `127.0.0.1:8765`; o cockpit detecta o agente, envia o snapshot anonimizado e o Copiloto, os e-mails e os materiais ganham a opção "com IA".
- **Rotinas agendadas:** agende `--rotina briefing` no cron (Linux/macOS) ou no Agendador de Tarefas (Windows), ex.: `0 8 * * 1 python /caminho/agent/bp_agent.py --rotina briefing`.

## Governança e LGPD

- Raça, PcD e dados de saúde são dados pessoais sensíveis: confirme base legal e finalidade com o DPO antes de importar dados reais.
- Scores de risco são probabilidades estatísticas — **nunca** use como critério isolado para desligamento, promoção ou remuneração.
- Materiais e o snapshot para IA identificam pessoas apenas por matrícula. Valide com Segurança da Informação antes de enviar dados reais a serviços externos.

## Estrutura

```
index.html                 cockpit (abre direto no navegador)
assets/js/data.js          base sintética determinística + importação CSV
assets/js/analytics.js     KPIs, modelo preditivo, WFP, orçamento, insights, playbooks
assets/js/materiais.js     materiais executivos e comunicações
assets/js/views.js         telas
assets/js/app.js           estado, navegação, gráficos, tarefas, copiloto, integração com o agente
assets/css/cockpit.css     tema claro/escuro, responsivo, estilos de impressão
agent/bp_agent.py          agente Claude (CLI, rotinas e API local)
data/                      modelos de CSV para importação
```
