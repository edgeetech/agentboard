export const CURRENT_MCP_PROTOCOL_VERSION = "2024-11-05" as const;

export type McpProtocolVersion = typeof CURRENT_MCP_PROTOCOL_VERSION;

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest<
  TMethod extends string = string,
  TParams = unknown,
> {
  readonly jsonrpc: "2.0";
  readonly id?: JsonRpcId;
  readonly method: TMethod;
  readonly params?: TParams;
}

export type JsonRpcResponse<TResult = unknown> =
  | {
      readonly jsonrpc: "2.0";
      readonly id: JsonRpcId;
      readonly result: TResult;
    }
  | {
      readonly jsonrpc: "2.0";
      readonly id: JsonRpcId;
      readonly error: JsonRpcError;
    };

export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface McpInitializeParams {
  readonly protocolVersion?: string;
  readonly capabilities?: Record<string, unknown>;
  readonly clientInfo?: {
    readonly name?: string;
    readonly version?: string;
  };
}

export interface McpInitializeResult {
  readonly protocolVersion: McpProtocolVersion;
  readonly capabilities: {
    readonly tools?: Record<string, unknown>;
    readonly [key: string]: unknown;
  };
  readonly serverInfo: {
    readonly name: string;
    readonly version?: string;
  };
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: McpJsonSchema;
}

export interface McpJsonSchema {
  readonly type: "object";
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly [key: string]: unknown;
}

export interface McpToolsListResult {
  readonly tools: readonly McpToolDefinition[];
}

export interface McpToolCallParams<TArguments = Record<string, unknown>> {
  readonly name: string;
  readonly arguments?: TArguments;
}

export interface McpToolCallResult {
  readonly content: readonly McpToolContent[];
  readonly isError?: boolean;
}

export type McpToolContent =
  | {
      readonly type: "text";
      readonly text: string;
    }
  | {
      readonly type: "image";
      readonly data: string;
      readonly mimeType: string;
    }
  | {
      readonly type: "resource";
      readonly resource: unknown;
    };

export type McpClientRequest =
  | JsonRpcRequest<"initialize", McpInitializeParams>
  | JsonRpcRequest<"ping">
  | JsonRpcRequest<"tools/list">
  | JsonRpcRequest<"tools/call", McpToolCallParams>;
