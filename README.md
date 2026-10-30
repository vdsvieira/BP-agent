# Gente & Gestão · Bradesco

Plataforma integrada de pessoas (protótipo funcional), com IA em cada etapa. São dois produtos sobre a mesma base:

1. **Portal de Gente & Gestão:** ATS, admissão, onboarding, metas (OKRs) e performance, com login por perfil (RH, BP, gestor, colaborador e candidato).
2. **Cockpit do BP:** a visão analítica e estratégica, descrita mais abaixo.

Tudo é integrado. Quem é contratado no ATS vira colaborador na base do cockpit. As notas calibradas atualizam desempenho e potencial (e o modelo de risco). Os OKRs das tribos alimentam o indicador de negócio. As vagas do cockpit vêm do ATS.

O Cockpit do BP é o painel do HR Business Partner estratégico. Reúne a telemetria das diretorias atendidas, people analytics preditivo, indicadores estratégicos modernos, org design, clima e bem-estar, orçamento, vagas e WFP. Os subsistemas de RH ficam interligados. Inclui um **assistente de IA** (Claude) com três modos — Analista, Materiais e Coach — que trabalha sobre toda a base de pessoas e sobre os arquivos que você enviar.

> O projeto vem com um **ambiente simulado**: cerca de 2.660 colaboradores fictícios em 8 diretorias e 18 tribos, com hierarquia, clima, licenças, movimentações, ATS e contexto de negócio. Nenhum dado real é incluído.

## Como rodar

| Situação | O que fazer |
|---|---|
| **Completo** (portal, cockpit, IA, conectores, uploads) | Windows: duplo clique em `iniciar.bat`. Linux/macOS: `./iniciar.sh`. O navegador abre em **http://localhost:8765** (tela de login) |
| Só o cockpit, offline e sem IA | Duplo clique em `index.html` (usa `data/base_demo.js`) |

Na tela de login, escolha uma **conta de demonstração**. A senha de todas é `demo123`:

| Conta | Quem é | O que experimentar |
|---|---|---|
| `bp` | Você, HRBP | Início com pendências, Cockpit do BP, calibração, ciclos |
| `rh` | RH (recrutamento, DP, performance) | Aprovar vagas, triar com IA, fazer proposta, validar documentos, efetivar admissão |
| `gestor` | Gerente de Tecnologia | Requisitar vaga com IA, entrevistar a candidata demo, avaliar o time, acompanhar onboarding |
| `colaborador` | Pessoa do time do gestor | Autoavaliação, metas com IA, feedbacks, vagas internas (mobilidade) |
| `novo` | Recém-contratado(a) | Plano 30-60-90, tarefas e check-in de experiência |
| `candidato` | Candidata externa em fase final | Mural de vagas, currículo lido por IA, proposta, envio de documentos |

Na tela de login também dá para criar uma conta nova de candidato.

Requisitos: Python 3.10+. Para a IA, defina `ANTHROPIC_API_KEY` (ou rode `ant auth login`) antes de iniciar. Sem chave, tudo funciona, exceto o assistente e a leitura de PDF/imagens.

```bash
python -m server                          # cockpit + API em http://localhost:8765
python -m server --reset                  # recria o ambiente simulado
python -m server --pergunta "Onde há risco de burnout?" --modo analista
python -m server --rotina briefing        # rotinas: briefing | pautas | retencao | org-health
python -m server --exportar-demo          # regenera data/base_demo.js (modo offline)
```

As rotinas podem ser agendadas no Agendador de Tarefas do Windows ou no cron. Exemplo: toda segunda às 7h40 → `python -m server --rotina briefing`. Os materiais gerados ficam em `server/saidas/`.

## Portal de Gente & Gestão

O design segue os princípios do Human Interface Guidelines da Apple:
- **Visual:** tipografia de sistema, títulos grandes, listas agrupadas, controles segmentados e barras translúcidas.
- **Marca:** o vermelho Bradesco aparece como cor de destaque.
- **Experiência:** cada perfil começa no **Início**, uma lista curta do que precisa ser feito agora, em que cada item leva direto à tela certa. Telas com várias ações mostram um único **"Próximo passo"** recomendado.

| Módulo | O que faz | IA |
|---|---|---|
| **ATS** | O gestor requisita a vaga e o RH aprova e publica. Candidatos externos e internos (mobilidade) se inscrevem. O processo segue por pipeline, entrevistas com scorecard e proposta até o aceite | Redige a vaga e aponta viés no briefing. Lê o currículo (PDF/imagem). Faz a triagem requisito a requisito com o **perfil anonimizado**. Monta o roteiro de entrevista estruturada e a carta-proposta |
| **Admissão** | Aberta automaticamente no aceite. Traz o checklist por responsável (candidato, RH, TI, gestor), os documentos e a efetivação, que gera a matrícula e converte o login do candidato | Confere se o documento é o pedido, está legível e está na validade, sem transcrever dados pessoais |
| **Onboarding** | Plano 30-60-90, buddy, tarefas por responsável e check-ins de 7/30/60/90 dias (confidenciais) | Personaliza o plano para o cargo e a tribo. Lê os check-ins e sinaliza risco de saída precoce, com sugestões ao gestor |
| **Metas (OKRs)** | Cascata empresa → diretoria → tribo → pessoa, com check-ins de progresso e confiança | Sugere OKRs alinhados ao objetivo-pai e avalia a qualidade (resultado × tarefa) |
| **Performance** | Ciclos com autoavaliação, avaliação do gestor e de pares (nota ponderada 70/15/15), calibração com curva de referência, PDI e feedback contínuo | Revisa textos de feedback (viés de linguagem, modelo SBI, falta de evidência). Sintetiza as avaliações. Propõe PDI 70-20-10 |

**Segurança do protótipo:**
- Senhas guardadas com PBKDF2. Sessão em cookie `HttpOnly` e `SameSite=Strict`. A API só aceita JSON.
- Todas as rotas checam o perfil no servidor. Exemplos:
  - O gestor não vê candidatos de vagas de outros gestores nem os documentos de admissão.
  - O buddy vê o plano de onboarding, mas não os check-ins.
  - O avaliado só vê a avaliação do gestor depois do encerramento do ciclo.
  - O cockpit e o assistente de IA são exclusivos de RH/BP.
- Em produção, o login de funcionários passa a ser o SSO corporativo.

## Cockpit do BP — módulos

**Cockpit**
- **Visão geral:** KPIs com farol, Org Health Index, receita/FTE, alertas prioritários, agenda do BP e matriz por diretoria.
- **Indicadores estratégicos:** Org Health Index, HC ROI, receita por FTE, custo de pessoas/receita, talent density, regretted attrition, internal fill rate, quality of hire, early attrition, taxa de promoção, Manager Effectiveness Index, spans & layers, burnout risk index, gap salarial ajustado por gênero, exposição à IA generativa, funil de diversidade por nível e scorecard pessoas × negócio por tribo (OKR, NPS de cliente).
- **Insights inteligentes:** regras que cruzam subsistemas, cada uma com valor em risco, ação, playbook e **ferramentas sugeridas**.

**Análises**
- **People Analytics:** modelo de saída voluntária (regressão logística com validação em holdout), fatores por pessoa, 9-box × risco e simulador de retenção com ROI.
- **Org design & tribos:** distribuição de spans, camadas, gestores com menor efetividade e organograma navegável.
- **Clima & bem-estar:** mapa de calor tribo × dimensão (incluindo segurança psicológica e carga de trabalho), evolução entre ciclos, licenças e afastamentos (saúde apenas agregada).
- **WFP, Orçamento, Vagas, Subsistemas de RH:** cenários de força de trabalho, orçado × realizado × forecast, funil e SLA de vagas, e visão 360° do colaborador.

**IA & execução**
- **✦ Assistente IA**
  - **Analista:** novas análises cruzando qualquer tabela, as planilhas que você subir e os documentos lidos. Responde com gráficos.
  - **Materiais:** apresentações, one-pages, memos, pautas, business cases e e-mails gerados a partir de um prompt. Imprime em PDF com gráficos.
  - **Coach do BP:** apoia decisões, levanta hipóteses de causa-raiz, indica a ferramenta certa e monta o plano de aplicação e o posicionamento com o diretor.
- **Caixa de ferramentas:** 24 ferramentas do BP estratégico, como skip level, stay interview, assimilação de novo líder, team canvas, segurança psicológica, Weisbord, Galbraith, spans & layers, ONA, JD-R/burnout, calibração 9-box, sucessão, build-buy-borrow-bot, reskilling para IA, ADKAR, RAPID, SBI, Thomas-Kilmann, pre-mortem, auditoria de equidade, business case e people strategy canvas.
  - As ferramentas são **recomendadas automaticamente** pelos alertas.
  - Viram tarefas com roteiro ou uma sessão com o coach.
- **Automação & tarefas** e **Materiais executivos** (modelos prontos, sem IA).

**Dados & integrações**
- Conectores, envio de arquivos, catálogo de dados, documentos e LGPD.

## Envio de arquivos (Excel, CSV, PDF, imagens)

| Arquivo | O que acontece |
|---|---|
| Excel/CSV com matrícula + campos de pessoas | Atualiza/inclui colaboradores (merge por matrícula) e re-treina o modelo de risco. Os cabeçalhos são reconhecidos por sinônimos (ex.: "Chapa", "Nota Desempenho", "Área") |
| Excel/CSV de vagas | Atualiza as requisições |
| Qualquer outra planilha (cada aba) | Vira uma tabela `x_...` que o assistente pode cruzar com a base (ex.: NPS de marca por tribo, budget de projetos, resultados de assessment) |
| PDF / imagem (foto de quadro, organograma, relatório) | A IA lê e extrai resumo, indicadores e tabelas. Tudo fica disponível como contexto e como tabelas `x_doc...` |

Arraste os arquivos para o chat do assistente ou para a tela Dados & integrações.

## Integração com as bases oficiais

Os conectores ficam em `server/conectores.py` e hoje rodam em modo **simulado**. Cada um já declara as tabelas que alimenta e como será a integração real:

| Conector | Fonte oficial | Tabelas |
|---|---|---|
| `sap` | SAP SuccessFactors (OData v2) ou SAP HCM (RFC / HANA), CO para orçamento | diretorias, colaboradores (com hierarquia), orcamento, competencias |
| `movimentacoes` | Sistema de movimentações | movimentacoes |
| `ats` | ATS de vagas (API) | vagas, candidatos |
| `clima` | Plataforma da pesquisa de clima (API/CSV agregados) | clima |
| `datalake` | Data lake de RH (ponto, afastamentos eSocial S-2230, LMS) | licencas, series |
| `negocio` | BI/Finanças e ferramenta de OKRs | tribos |

Para ligar uma fonte:
1. Implemente `extrair_real()` na classe do conector, devolvendo linhas no esquema canônico (o mesmo do `server/simulador.py`).
2. Configure as credenciais em variáveis de ambiente (nunca no código).
3. Mude o `modo` para `"real"` em `server/conectores.json`.

O restante do cockpit, do modelo preditivo e do assistente não muda.

## Arquitetura

```
login.html, portal.html      portal de Gente & Gestão (assets/js/portal/: core, ats, jornada, desempenho, inicio)
assets/css/apple.css         camada visual inspirada na Apple, aplicada a todas as páginas
server/auth.py, rotas.py     login, sessões e roteador com controle de acesso por perfil
server/plataforma/           módulos: ats, admissao, onboarding, metas, performance, arquivos
```

```
index.html, assets/          front-end (sem build). Identidade visual em assets/css/cockpit.css; logotipo em assets/brand/
  js/data.js                 carrega a base do servidor ou a demo offline
  js/analytics.js            KPIs, indicadores estratégicos, org design, WFP, orçamento, motor de insights
  js/views.js, views2.js     telas
  js/ferramentas.js          caixa de ferramentas (compartilhada com o coach)
  js/app.js                  navegação, filtros diretoria/tribo, chat, uploads, tarefas
server/                      Python
  app.py                     servidor local (127.0.0.1) e API
  simulador.py               ambiente simulado (fonte única dos dados de demonstração)
  conectores.py              conectores (simulado → real)
  banco.py                   SQLite local, views analíticas e SQL somente leitura para a IA
  modelo.py                  modelo preditivo de saída voluntária
  ingestao.py                Excel/CSV/PDF/imagens
  agente.py                  assistente Claude: analista, materiais, coach
```

O assistente usa o modelo `claude-opus-5-5`, com raciocínio adaptativo e fallback automático em caso de recusa. A profundidade é ajustável por `BP_EFFORT=low|medium|high`.

Ele consulta a base **somente leitura** (uma consulta SELECT por vez, com limite de linhas e de tempo) e nunca altera dados.

## Identidade visual

- **Cores:** vermelho institucional e gradiente da marca.
- **Fonte:** "Bradesco Sans", quando instalada.
- **Logotipo:** coloque o arquivo oficial em `assets/brand/logo.svg`. Obtenha-o com a área de Marca e não o versione em repositórios públicos.
- **Gráficos:** usam uma paleta validada para daltonismo. O vermelho fica reservado à marca e ao status crítico.

## Se a IA der erro

O cockpit mostra a **causa real** do erro: chave ausente ou recusada, bloqueio do proxy/firewall do banco, limite de uso ou instabilidade da API. A janela do servidor registra os detalhes técnicos.

Para checar tudo de uma vez, dê duplo clique em `diagnostico.bat` (ou rode `python -m server --diagnostico`). O teste verifica a chave, o proxy e faz três chamadas mínimas à API.

Se o `setx` não "pegar" em algumas aberturas, copie `.env.exemplo` para `.env` e cole a chave nele. É lido automaticamente, **tem prioridade sobre o `setx`** e nunca vai para o Git. Se a TI indicar um proxy, ele também é configurado no `.env`.

## Governança e LGPD

- O servidor só aceita conexões do próprio computador. A base fica em `server/dados/bp.db`, fora do controle de versão.
- À API do Claude vão apenas as perguntas, os resultados das consultas que o assistente faz e os arquivos que você enviar para leitura. **Valide com o DPO e com Segurança da Informação antes de usar dados reais.**
- Dados de saúde aparecem apenas agregados. Grupos pequenos não devem ser expostos.
- Scores de risco e índices são estatísticos e **nunca** devem ser critério isolado para desligar, promover ou remunerar.
- A IA pode errar: confira os números antes de levar qualquer material à diretoria.
