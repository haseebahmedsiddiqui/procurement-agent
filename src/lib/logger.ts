import pino from "pino";
import { AsyncLocalStorage } from "node:async_hooks";

const isDev = process.env.NODE_ENV !== "production";

const basePino = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    },
  }),
});

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEvent {
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
  ts: number;
}

/**
 * Per-request log emitter. The /api/search streaming route installs one of
 * these via `logEventStorage.run(...)`; the wrapped logger below tees all
 * pino calls inside that scope into the emitter so the UI sees them live.
 *
 * AsyncLocalStorage propagates through async/await chains, so emitters reach
 * any logger call in any depth of awaited code without explicit threading.
 */
export const logEventStorage = new AsyncLocalStorage<{
  emit: (event: LogEvent) => void;
}>();

function makeMethod(level: LogLevel) {
  return function (...args: unknown[]): void {
    let data: Record<string, unknown> | undefined;
    let message: string;

    // Pino call signatures we support:
    //   logger.info("msg")
    //   logger.info({ data }, "msg")
    //   logger.info({ data })
    if (typeof args[0] === "string") {
      message = args[0];
    } else if (args[0] && typeof args[0] === "object") {
      data = args[0] as Record<string, unknown>;
      message = typeof args[1] === "string" ? args[1] : "";
    } else {
      message = String(args[0] ?? "");
    }

    const ctx = logEventStorage.getStore();
    if (ctx) {
      try {
        ctx.emit({ level, message, data, ts: Date.now() });
      } catch {
        // Emitter failures must never break the call site
      }
    }

    // Forward to real pino for terminal output
    (basePino[level] as (...a: unknown[]) => void)(...args);
  };
}

export const logger = {
  info: makeMethod("info"),
  warn: makeMethod("warn"),
  error: makeMethod("error"),
  debug: makeMethod("debug"),
};

export default logger;
