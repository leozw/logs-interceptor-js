import type { Agent, ClientRequest, ClientRequestArgs } from 'node:http';

export function boundedAgent(
  timeoutMillis: number,
  maxSockets = 4,
  keepAlive = true,
  operationSignal?: () => AbortSignal | undefined,
) {
  const agents = new Set<Agent>();
  const requests = new Map<ClientRequest, ReturnType<typeof setTimeout>>();
  let closed = false;
  return {
    factory: async (protocol: string) => {
      if (closed) throw new Error('Telemetry transport closed');
      const { Agent: AgentClass } =
        protocol === 'https:'
          ? await import('node:https')
          : await import('node:http');
      const agent = new AgentClass({ keepAlive, maxSockets });
      const target = agent as Agent & {
        addRequest(request: ClientRequest, options: ClientRequestArgs): void;
      };
      const addRequest = target.addRequest.bind(agent);
      target.addRequest = (request, options) => {
        if (closed) {
          request.destroy(new Error('Telemetry transport closed'));
          return;
        }
        const signal = operationSignal?.();
        const abort = () => request.destroy(new Error('ELVEN_OPERATION_CANCELLED'));
        if (signal?.aborted) { abort(); return; }
        const cleanup = () => {
          signal?.removeEventListener('abort', abort);
          clearTimeout(requests.get(request));
          requests.delete(request);
        };
        const timer = setTimeout(
          () => request.destroy(new Error('OTLP request deadline exceeded')),
          timeoutMillis,
        );
        timer.unref();
        requests.set(request, timer);
        signal?.addEventListener('abort', abort, { once: true });
        request.once('close', cleanup);
        request.once('response', (response) => {
          response.once('end', cleanup);
          response.once('close', cleanup);
        });
        addRequest(request, options);
      };
      agents.add(agent);
      return agent;
    },
    destroy: () => {
      closed = true;
      for (const [request, timer] of requests) {
        clearTimeout(timer);
        request.destroy(new Error('Telemetry transport closed'));
      }
      requests.clear();
      for (const agent of agents) agent.destroy();
      agents.clear();
    },
  };
}
