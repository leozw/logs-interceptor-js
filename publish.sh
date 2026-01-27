#!/bin/bash

# Script para publicar logs-interceptor e node-red-contrib-logs-interceptor
# Uso: ./publish.sh [version] [--dry-run]

set -e  # Para na primeira erro

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Função para imprimir mensagens
info() {
    echo -e "${GREEN}✓${NC} $1"
}

warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1"
    exit 1
}

# Verificar se está no diretório correto
if [ ! -f "package.json" ]; then
    error "Execute este script na raiz do projeto"
fi

# Verificar se está logado no NPM
if ! npm whoami &> /dev/null; then
    error "Você precisa estar logado no NPM. Execute: npm login"
fi

# Verificar argumentos
VERSION=""
DRY_RUN=false

for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
            warn "Modo DRY-RUN ativado - nenhum pacote será publicado"
            ;;
        *)
            if [[ -z "$VERSION" ]] && [[ "$arg" != "--dry-run" ]]; then
                VERSION="$arg"
            fi
            ;;
    esac
done

# Obter versão atual
CURRENT_VERSION=$(node -p "require('./package.json').version")
info "Versão atual: $CURRENT_VERSION"

# Se versão foi fornecida, atualizar
if [ -n "$VERSION" ]; then
    info "Atualizando versão para: $VERSION"
    npm version "$VERSION" --no-git-tag-version
    # Atualizar também no package do Node-RED
    node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('src/presentation/node-red/package.json', 'utf8'));
        pkg.version = '$VERSION';
        pkg.dependencies['logs-interceptor'] = '^$VERSION';
        fs.writeFileSync('src/presentation/node-red/package.json', JSON.stringify(pkg, null, 2) + '\n');
    "
fi

NEW_VERSION=$(node -p "require('./package.json').version")
info "Versão que será publicada: $NEW_VERSION"

# 1. Build do pacote principal
info "Fazendo build do pacote principal..."
rm -rf dist/
yarn
npm run build || error "Build falhou"

# 2. Publicar pacote principal
info "Publicando logs-interceptor@$NEW_VERSION..."

# Verificar se precisa de OTP (2FA)
if npm profile get 2>/dev/null | grep -q "two-factor auth: enabled"; then
    warn "2FA está habilitado. Você precisará fornecer o código OTP."
    if [ -z "$NPM_OTP" ]; then
        warn "Defina NPM_OTP com o código do seu autenticador, ou será solicitado interativamente"
        warn "Exemplo: NPM_OTP=123456 ./publish.sh"
    fi
fi

if [ "$DRY_RUN" = true ]; then
    npm pack --dry-run
    info "DRY-RUN: Pacote principal preparado (não publicado)"
else
    if [ -n "$NPM_OTP" ]; then
        npm publish --otp="$NPM_OTP" || error "Falha ao publicar pacote principal"
    else
        npm publish || error "Falha ao publicar pacote principal"
    fi
    info "Pacote principal publicado com sucesso!"
fi

# 3. Preparar pacote Node-RED
info "Preparando pacote Node-RED..."

# Criar diretório temporário para o pacote Node-RED
TEMP_DIR=$(mktemp -d)
NODE_RED_PKG_DIR="$TEMP_DIR/node-red-contrib-logs-interceptor"

mkdir -p "$NODE_RED_PKG_DIR"

# Copiar arquivos necessários
cp -r src/presentation/node-red/* "$NODE_RED_PKG_DIR/"
cp package.json "$NODE_RED_PKG_DIR/" 2>/dev/null || true
cp README.md "$NODE_RED_PKG_DIR/" 2>/dev/null || true

# Compilar o node TypeScript para JavaScript
info "Compilando node TypeScript..."
cd "$NODE_RED_PKG_DIR"

# Criar um tsconfig simples para compilar apenas o node
cat > tsconfig.node-red.json <<EOF
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "outDir": ".",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "moduleResolution": "node"
  },
  "include": ["logs-interceptor-node.ts"],
  "exclude": ["node_modules"]
}
EOF

# Compilar
npx tsc -p tsconfig.node-red.json || {
    warn "Compilação TypeScript falhou, tentando método alternativo..."
    # Método alternativo: copiar e ajustar manualmente
    # (Para Node-RED, podemos usar require direto do pacote principal)
    cat > logs-interceptor-node.js <<'NODEJS'
module.exports = function(RED) {
    'use strict';
    
    function LogsInterceptorNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        let logger = null;
        let initialized = false;
        
        try {
            const logsInterceptor = require('logs-interceptor');
            const { init } = logsInterceptor;
            
            const loggerConfig = {
                transport: {
                    url: config.url || process.env.LOGS_INTERCEPTOR_URL,
                    tenantId: config.tenantId || process.env.LOGS_INTERCEPTOR_TENANT_ID,
                    authToken: config.authToken || process.env.LOGS_INTERCEPTOR_AUTH_TOKEN,
                },
                appName: config.appName || 'node-red',
                environment: config.environment || 'production',
                version: config.version || '1.0.0',
                interceptConsole: config.interceptConsole || false,
                debug: config.debug || false,
            };
            
            logger = init(loggerConfig);
            initialized = true;
            node.status({ fill: 'green', shape: 'dot', text: 'connected' });
        } catch (error) {
            node.error('Failed to initialize logs interceptor: ' + error.message);
            node.status({ fill: 'red', shape: 'ring', text: 'error' });
            initialized = false;
        }
        
        node.on('input', function(msg) {
            if (!initialized || !logger) {
                node.warn('Logger not initialized');
                return;
            }
            
            try {
                const payload = msg.payload;
                const level = msg.level || 'info';
                const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
                const context = {
                    nodeId: node.id,
                    nodeName: node.name,
                    topic: msg.topic,
                };
                
                if (typeof payload === 'object' && payload !== null) {
                    Object.assign(context, payload);
                }
                delete context.payload;
                
                switch (level.toLowerCase()) {
                    case 'debug':
                        logger.debug(message, context);
                        break;
                    case 'info':
                        logger.info(message, context);
                        break;
                    case 'warn':
                        logger.warn(message, context);
                        break;
                    case 'error':
                        logger.error(message, context);
                        break;
                    case 'fatal':
                        logger.fatal(message, context);
                        break;
                    default:
                        logger.info(message, context);
                }
                
                node.send(msg);
            } catch (error) {
                node.error('Error processing log: ' + error.message);
            }
        });
        
        node.on('close', async function() {
            if (logger && typeof logger.destroy === 'function') {
                try {
                    await logger.destroy();
                } catch (error) {
                    node.error('Error destroying logger: ' + error.message);
                }
            }
        });
    }
    
    RED.nodes.registerType('logs-interceptor', LogsInterceptorNode);
};
NODEJS
}

# Remover arquivo TypeScript original
rm -f logs-interceptor-node.ts tsconfig.node-red.json

# Copiar package.json do Node-RED
cp package.json "$NODE_RED_PKG_DIR/" 2>/dev/null || {
    # Se não existir, criar um novo
    cat > "$NODE_RED_PKG_DIR/package.json" <<PKGJSON
{
  "name": "node-red-contrib-logs-interceptor",
  "version": "$NEW_VERSION",
  "description": "Node-RED node for logs-interceptor",
  "node-red": {
    "nodes": {
      "logs-interceptor": "logs-interceptor-node.js"
    }
  },
  "keywords": [
    "node-red",
    "logging",
    "loki",
    "logs-interceptor"
  ],
  "author": "Leonardo Zwirtes",
  "license": "MIT",
  "dependencies": {
    "logs-interceptor": "^$NEW_VERSION"
  }
}
PKGJSON
}

cd "$NODE_RED_PKG_DIR"

# 4. Publicar pacote Node-RED
info "Publicando node-red-contrib-logs-interceptor@$NEW_VERSION..."
if [ "$DRY_RUN" = true ]; then
    npm pack --dry-run
    info "DRY-RUN: Pacote Node-RED preparado (não publicado)"
else
    if [ -n "$NPM_OTP" ]; then
        npm publish --otp="$NPM_OTP" || error "Falha ao publicar pacote Node-RED"
    else
        npm publish || error "Falha ao publicar pacote Node-RED"
    fi
    info "Pacote Node-RED publicado com sucesso!"
fi

# Limpar diretório temporário
rm -rf "$TEMP_DIR"

# Resumo
echo ""
info "═══════════════════════════════════════════════════════"
info "Publicação concluída com sucesso!"
info "═══════════════════════════════════════════════════════"
info ""
info "Pacotes publicados:"
info "  • logs-interceptor@$NEW_VERSION"
info "  • node-red-contrib-logs-interceptor@$NEW_VERSION"
info ""
info "Para instalar:"
info "  npm install logs-interceptor@$NEW_VERSION"
info "  npm install node-red-contrib-logs-interceptor@$NEW_VERSION"
info ""
info "═══════════════════════════════════════════════════════"

