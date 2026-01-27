# Clean Architecture - Logs Interceptor

Este projeto foi refatorado seguindo os princípios de **Clean Architecture** e **Clean Code**, aplicando as melhores práticas de 2026.

## Estrutura de Camadas

### 📁 Domain Layer (`src/domain/`)
**Responsabilidade**: Contém as regras de negócio e entidades do domínio.

- **Entities**: Entidades do domínio (LogEntry)
- **Value Objects**: Objetos de valor (LogLevel)
- **Interfaces**: Contratos que definem as abstrações (ILogger, ILogTransport, etc.)
- **Repositories**: Interfaces de repositórios

**Princípios aplicados**:
- ✅ Não depende de nenhuma outra camada
- ✅ Contém apenas lógica de negócio
- ✅ Interfaces bem definidas (ISP - Interface Segregation Principle)

### 📁 Application Layer (`src/application/`)
**Responsabilidade**: Orquestra os casos de uso e coordena o domínio.

- **Services**: Serviços de aplicação (LogService, ConfigService)
- **Config**: DTOs de configuração
- **Use Cases**: Casos de uso específicos

**Princípios aplicados**:
- ✅ Depende apenas do Domain Layer
- ✅ Contém lógica de aplicação
- ✅ Single Responsibility Principle (SRP)

### 📁 Infrastructure Layer (`src/infrastructure/`)
**Responsabilidade**: Implementações concretas de interfaces definidas no domínio.

- **Transport**: Implementações de transporte (LokiTransport)
- **Buffer**: Implementações de buffer (MemoryBuffer)
- **Filter**: Implementações de filtro (LogFilter)
- **Circuit Breaker**: Implementação de circuit breaker
- **Context**: Provedores de contexto (AsyncLocalStorageContextProvider)
- **Interceptors**: Interceptores (ConsoleInterceptor)

**Princípios aplicados**:
- ✅ Depende do Domain Layer
- ✅ Implementa interfaces do Domain
- ✅ Dependency Inversion Principle (DIP)

### 📁 Presentation Layer (`src/presentation/`)
**Responsabilidade**: Interface com o mundo externo (API pública, Node-RED, etc.).

- **Factory**: Factory para criação de instâncias (LogsInterceptorFactory)
- **Node-RED**: Integração com Node-RED
- **API**: API pública do módulo

**Princípios aplicados**:
- ✅ Depende do Application e Infrastructure Layers
- ✅ Orquestra a criação de objetos
- ✅ Dependency Injection

## Princípios SOLID Aplicados

### 1. Single Responsibility Principle (SRP)
Cada classe tem uma única responsabilidade:
- `LogService`: Orquestra o processamento de logs
- `LokiTransport`: Envia logs para Loki
- `MemoryBuffer`: Gerencia buffer de logs
- `LogFilter`: Filtra e sanitiza logs

### 2. Open/Closed Principle (OCP)
- Interfaces permitem extensão sem modificação
- Novos transportes podem ser adicionados implementando `ILogTransport`
- Novos filtros podem ser adicionados implementando `ILogFilter`

### 3. Liskov Substitution Principle (LSP)
- Qualquer implementação de `ILogTransport` pode substituir outra
- Qualquer implementação de `ILogBuffer` pode substituir outra

### 4. Interface Segregation Principle (ISP)
- Interfaces pequenas e específicas:
  - `ILogTransport`: Apenas métodos de transporte
  - `ILogBuffer`: Apenas métodos de buffer
  - `ILogFilter`: Apenas métodos de filtro

### 5. Dependency Inversion Principle (DIP)
- Classes de alto nível dependem de abstrações (interfaces)
- Implementações concretas são injetadas via Dependency Injection

## Padrões de Design Aplicados

### Factory Pattern
- `LogsInterceptorFactory`: Cria instâncias do logger com todas as dependências

### Strategy Pattern
- Diferentes estratégias de transporte (Loki, futuramente outros)
- Diferentes estratégias de buffer (Memory, futuramente Redis, etc.)

### Repository Pattern
- `ILogRepository`: Abstração para persistência de logs

### Circuit Breaker Pattern
- `CircuitBreaker`: Protege contra falhas em cascata

### Adapter Pattern
- `ConsoleInterceptor`: Adapta console.log para o sistema de logs

## Dependency Injection

Todas as dependências são injetadas via construtor:

```typescript
// Exemplo: LogService recebe dependências via construtor
constructor(
  private readonly filter: ILogFilter,
  private readonly buffer: ILogBuffer,
  private readonly transport: ILogTransport,
  private readonly contextProvider: IContextProvider,
  private readonly config: {...}
)
```

## Testabilidade

A arquitetura facilita testes:

1. **Mocks fáceis**: Interfaces permitem criar mocks facilmente
2. **Isolamento**: Cada camada pode ser testada independentemente
3. **Dependency Injection**: Dependências podem ser injetadas nos testes

## Extensibilidade

### Adicionar novo transporte:
1. Implementar `ILogTransport`
2. Registrar no factory
3. Pronto! Sem modificar código existente

### Adicionar novo buffer:
1. Implementar `ILogBuffer`
2. Registrar no factory
3. Pronto!

### Adicionar novo filtro:
1. Implementar `ILogFilter`
2. Registrar no factory
3. Pronto!

## Fluxo de Dados

```
User Code
    ↓
Presentation Layer (index.ts)
    ↓
Application Layer (LogService)
    ↓
Domain Layer (Interfaces)
    ↓
Infrastructure Layer (Implementations)
    ↓
External Systems (Loki, etc.)
```

## Benefícios da Arquitetura

1. **Manutenibilidade**: Código organizado e fácil de entender
2. **Testabilidade**: Fácil de testar cada componente isoladamente
3. **Extensibilidade**: Fácil adicionar novas funcionalidades
4. **Reusabilidade**: Componentes podem ser reutilizados
5. **Desacoplamento**: Baixo acoplamento entre componentes
6. **Conformidade com SOLID**: Todos os princípios SOLID aplicados

## Melhores Práticas 2026

- ✅ TypeScript strict mode
- ✅ Interfaces explícitas
- ✅ Dependency Injection
- ✅ Value Objects para tipos primitivos
- ✅ Error handling robusto
- ✅ Async/await em vez de callbacks
- ✅ Type safety em tempo de compilação
- ✅ Clean Code principles
- ✅ Single Responsibility
- ✅ Separation of Concerns



