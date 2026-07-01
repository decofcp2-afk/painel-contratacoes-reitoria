#!/bin/bash
set -euo pipefail

# Restaura o login do clasp (Google Apps Script CLI) a partir do secret de
# ambiente CLASP_CREDENTIALS_JSON, se ele estiver configurado. Sem isso, cada
# sessao nova precisaria refazer o fluxo de login OAuth do zero para publicar
# no Apps Script (apps-script/Code.gs, apps-script/FirestoreSync.gs).
#
# Configurar o secret: cole o conteudo integral de ~/.clasprc.json (gerado por
# `clasp login`) como variavel de ambiente CLASP_CREDENTIALS_JSON nas
# configuracoes do ambiente do Claude Code on the web.
if [ -n "${CLASP_CREDENTIALS_JSON:-}" ]; then
  printf '%s' "$CLASP_CREDENTIALS_JSON" > "$HOME/.clasprc.json"
  chmod 600 "$HOME/.clasprc.json"
fi

if ! command -v clasp >/dev/null 2>&1; then
  npm install -g @google/clasp >/dev/null 2>&1 || true
fi
