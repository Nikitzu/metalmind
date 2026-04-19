import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface SpawnMcpOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
  structuredContent?: unknown;
}

const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

export class StdioMcpClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, (res: JsonRpcResponse) => void>();

  async start(opts: SpawnMcpOptions): Promise<void> {
    const proc = spawn(opts.command, opts.args ?? [], {
      env: { ...process.env, ...opts.env },
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    const rl = createInterface({ input: proc.stdout });
    rl.on('line', (line) => this.handleLine(line));

    await this.request('initialize', {
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'metalmind', version: '0.0.1' },
    });
    this.notify('notifications/initialized', {});
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(trimmed) as JsonRpcResponse;
    } catch {
      return;
    }
    if (typeof msg.id === 'number') {
      const handler = this.pending.get(msg.id);
      if (handler) {
        this.pending.delete(msg.id);
        handler(msg);
      }
    }
  }

  async request(method: string, params: unknown): Promise<unknown> {
    const proc = this.proc;
    if (!proc) throw new Error('MCP client not started');
    const id = this.nextId++;
    const msg = { jsonrpc: '2.0' as const, method, params, id };
    const promise = new Promise<JsonRpcResponse>((resolve) => {
      this.pending.set(id, resolve);
    });
    proc.stdin.write(`${JSON.stringify(msg)}\n`);
    const res = await promise;
    if (res.error) throw new Error(`MCP ${method} error: ${res.error.message}`);
    return res.result;
  }

  notify(method: string, params: unknown): void {
    const proc = this.proc;
    if (!proc) throw new Error('MCP client not started');
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async callTool(name: string, args: unknown): Promise<McpToolResult> {
    return (await this.request('tools/call', { name, arguments: args })) as McpToolResult;
  }

  async close(): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    proc.kill();
  }
}

export function extractText(result: McpToolResult): string {
  if (!result.content) return '';
  return result.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n');
}
