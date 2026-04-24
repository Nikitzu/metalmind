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
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const STDERR_RING_MAX = 4096; // keep the last ~4KB of stderr for error context

export interface StdioMcpClientOptions {
  requestTimeoutMs?: number;
}

export class StdioMcpClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (res: JsonRpcResponse) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  private stderrBuffer = '';
  private readonly requestTimeoutMs: number;

  constructor(opts: StdioMcpClientOptions = {}) {
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async start(opts: SpawnMcpOptions): Promise<void> {
    const proc = spawn(opts.command, opts.args ?? [], {
      env: { ...process.env, ...opts.env },
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;

    proc.on('error', (err) => {
      this.rejectAll(new Error(`MCP spawn failed (${opts.command}): ${err.message}`));
    });
    proc.on('exit', (code, signal) => {
      this.rejectAll(
        new Error(
          `MCP server exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})${
            this.stderrTail() ? `\nstderr: ${this.stderrTail()}` : ''
          }`,
        ),
      );
    });

    const rl = createInterface({ input: proc.stdout });
    rl.on('line', (line) => this.handleLine(line));

    const errRl = createInterface({ input: proc.stderr });
    errRl.on('line', (line) => {
      this.stderrBuffer += `${line}\n`;
      if (this.stderrBuffer.length > STDERR_RING_MAX) {
        this.stderrBuffer = this.stderrBuffer.slice(-STDERR_RING_MAX);
      }
    });

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
      const entry = this.pending.get(msg.id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(msg.id);
        entry.resolve(msg);
      }
    }
  }

  private rejectAll(err: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  private stderrTail(): string {
    return this.stderrBuffer.slice(-512).trim();
  }

  async request(method: string, params: unknown): Promise<unknown> {
    const proc = this.proc;
    if (!proc) throw new Error('MCP client not started');
    const id = this.nextId++;
    const msg = { jsonrpc: '2.0' as const, method, params, id };

    const promise = new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const tail = this.stderrTail();
        reject(
          new Error(
            `MCP ${method} timed out after ${this.requestTimeoutMs}ms${tail ? `\nstderr: ${tail}` : ''}`,
          ),
        );
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    proc.stdin.write(`${JSON.stringify(msg)}\n`);
    const res = await promise;
    if (res.error) {
      const tail = this.stderrTail();
      throw new Error(
        `MCP ${method} error: ${res.error.message}${tail ? `\nstderr: ${tail}` : ''}`,
      );
    }
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
    this.rejectAll(new Error('MCP client closed'));
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
