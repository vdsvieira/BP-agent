"""Acesso à API do Claude: credenciais, cliente compartilhado e diagnóstico de erros.

Os erros são classificados pelo TIPO e pelo código HTTP (nunca por palavras soltas na
mensagem), para que um bloqueio do proxy corporativo não seja confundido com falta de chave.
"""
from __future__ import annotations

import datetime as dt
import os
import sys
import threading
import traceback
from pathlib import Path

import anthropic

MODELO = "claude-opus-5-5"
RAIZ = Path(__file__).resolve().parent.parent
_cliente = None
_lock = threading.Lock()


_origem: list = []  # memoriza de onde veio a credencial na primeira leitura


def carregar_env() -> str | None:
    """Carrega o arquivo .env da pasta do cockpit. O .env TEM PRIORIDADE sobre variáveis do Windows (setx):
    é a configuração específica deste app, e evita que uma chave antiga esquecida no sistema seja usada.
    Retorna a origem da credencial: '.env', 'ambiente', 'perfil ant' ou None."""
    if _origem:
        return _origem[0]
    _origem.append(_detectar_origem())
    return _origem[0]


def _detectar_origem() -> str | None:
    arq = RAIZ / ".env"
    if arq.exists():
        for linha in arq.read_text(encoding="utf-8-sig").splitlines():
            linha = linha.strip()
            if linha and not linha.startswith("#") and "=" in linha:
                k, v = linha.split("=", 1)
                v = v.strip().strip('"').strip("'")
                if v and "sua-chave-aqui" not in v:  # ignora o valor de exemplo
                    os.environ[k.strip()] = v
        if os.environ.get("ANTHROPIC_API_KEY") and _chave_do_env(arq):
            return ".env"
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return "ambiente (variável do Windows/setx)"
    return "perfil ant" if os.environ.get("ANTHROPIC_PROFILE") else None


def _chave_do_env(arq: Path) -> bool:
    return any(l.strip().startswith("ANTHROPIC_API_KEY=") and "sua-chave-aqui" not in l and l.split("=", 1)[1].strip()
               for l in arq.read_text(encoding="utf-8-sig").splitlines())


def cliente() -> anthropic.Anthropic:
    global _cliente
    with _lock:
        if _cliente is None:
            # mais tentativas: a rede corporativa costuma ter falhas transitórias (429/5xx/conexão)
            _cliente = anthropic.Anthropic(max_retries=4)
        return _cliente


def _mascarar(chave: str) -> str:
    return f"{chave[:7]}…{chave[-4:]}" if chave and len(chave) > 12 else "(curta demais — confira se colou inteira)"


def explicar_erro(e: Exception) -> tuple[int, str]:
    """Traduz uma exceção da API em (status HTTP para o cockpit, mensagem acionável)."""
    rid = getattr(e, "request_id", None)
    sufixo = f" [request-id: {rid}]" if rid else ""
    if isinstance(e, TypeError) and "authentication method" in str(e):
        return 503, ("IA não configurada: nenhuma chave encontrada. Defina ANTHROPIC_API_KEY (setx no Windows e abra um novo terminal) "
                     "ou crie o arquivo .env na pasta do cockpit com ANTHROPIC_API_KEY=sua-chave. Depois reinicie o servidor.")
    # proxy/firewall corporativo: vem antes das regras de 401/403, que também podem ser páginas de bloqueio
    if isinstance(e, anthropic.APIStatusError) and e.status_code == 407:
        return 502, ("O PROXY da rede corporativa bloqueou a chamada (407 — autenticação de proxy), não é problema da chave. "
                     "Peça à TI a liberação de api.anthropic.com ou configure HTTPS_PROXY=http://usuario:senha@proxy:porta no .env.")
    if isinstance(e, anthropic.APIStatusError) and "<html" in str(e).lower():
        return 502, (f"A rede corporativa devolveu uma página de bloqueio ({e.status_code}) em vez da resposta da API — "
                     "proxy/firewall filtrando api.anthropic.com. Não é problema da chave: peça a liberação à TI.")
    if isinstance(e, anthropic.BadRequestError) and "credit balance" in str(e).lower():
        return 402, ("A chave funciona, mas a conta da API está SEM CRÉDITOS. Compre créditos em console.anthropic.com → "
                     "Plans & Billing (a API é cobrada à parte da assinatura do Claude) e tente de novo — não precisa reiniciar.")
    if isinstance(e, anthropic.AuthenticationError):
        return 503, f"A API recusou a credencial (401): chave inválida, revogada ou login 'ant' expirado. Gere uma nova chave e reinicie o servidor.{sufixo}"
    if isinstance(e, anthropic.PermissionDeniedError):
        return 503, f"Sem permissão (403): a chave não tem acesso a este modelo ou a organização bloqueou o uso. Fale com o administrador da conta.{sufixo}"
    if isinstance(e, anthropic.RateLimitError):
        return 429, f"Limite de uso da API atingido (429). Aguarde um minuto e tente de novo.{sufixo}"
    if isinstance(e, anthropic.APITimeoutError):
        return 504, "A API demorou demais para responder (timeout). Tente um pedido mais curto ou novamente em instantes."
    if isinstance(e, anthropic.APIConnectionError):
        return 502, ("Sem conexão com api.anthropic.com: verifique VPN/proxy. Na rede do banco, peça à TI a liberação do domínio "
                     "ou configure HTTPS_PROXY no .env.")
    if isinstance(e, anthropic.APIStatusError):
        if e.status_code in (500, 502, 503, 529):
            return 503, f"A API do Claude está instável ou sobrecarregada ({e.status_code}). Tente novamente em alguns instantes.{sufixo}"
        corpo = str(e)
        return 502, f"Falha na API do Claude ({e.status_code}): {corpo[:300]}{sufixo}"
    if isinstance(e, anthropic.AnthropicError):
        return 502, f"Erro na comunicação com a IA: {str(e)[:300]}"
    return 500, f"Erro inesperado no assistente: {type(e).__name__}: {str(e)[:300]}"


def registrar_erro(contexto: str, e: Exception) -> None:
    """Grava o erro completo na janela do servidor (para suporte), sem expor a chave."""
    sys.stderr.write(f"\n[{dt.datetime.now():%H:%M:%S}] ERRO IA ({contexto}): {type(e).__name__} status={getattr(e, 'status_code', '-')} "
                     f"request_id={getattr(e, 'request_id', '-')}\n")
    traceback.print_exception(e, limit=3, file=sys.stderr)


def status_credencial() -> str:
    origem = carregar_env()
    if origem and origem != "perfil ant":
        chave = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN", "")
        return f"credencial encontrada via {origem} ({_mascarar(chave)})"
    if origem:
        return f"usando {origem}"
    return "NENHUMA credencial encontrada — o assistente não vai funcionar"


def diagnostico() -> int:
    """Checa credencial, proxy e faz uma chamada mínima à API. Retorna 0 se tudo ok."""
    print("Diagnóstico da IA do Cockpit do BP")
    print(f"  Python {sys.version.split()[0]} · SDK anthropic {anthropic.__version__}")
    print(f"  Credencial: {status_credencial()}")
    proxies = {k: v for k, v in os.environ.items() if k.upper() in ("HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY")}
    print("  Proxy: " + (", ".join(f"{k}={'definido' if v else 'vazio'}" for k, v in proxies.items()) or "nenhuma variável de proxy definida"))
    for i in range(1, 4):
        try:
            r = cliente().messages.create(model=MODELO, max_tokens=16, output_config={"effort": "low"},
                                          messages=[{"role": "user", "content": "Responda apenas: ok"}])
            print(f"  Teste {i}/3: OK (modelo {r.model})")
        except Exception as e:  # noqa: BLE001 — o objetivo é relatar qualquer falha
            print(f"  Teste {i}/3: FALHOU — {explicar_erro(e)[1]}")
            return 1
    print("Tudo certo: a IA está acessível.")
    return 0
