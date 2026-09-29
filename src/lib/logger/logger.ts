type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEY = /token|secret|password|authorization|api[-_]?key|credential|cookie/i;

function maskEmail(value: string): string {
  return value.replace(/([A-Z0-9._%+-])([A-Z0-9._%+-]*)@/gi, (_match, first: string) => `${first}***@`);
}

function maskPhone(value: string): string {
  return value.replace(/\+?\d[\d\s().-]{7,}\d/g, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 8) return match;
    return `***${digits.slice(-4)}`;
  });
}

export function redactValue(value: unknown, key?: string): unknown {
  if (key && SECRET_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") return maskPhone(maskEmail(value));
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value)) {
      output[childKey] = redactValue(child, childKey);
    }
    return output;
  }
  return value;
}

export type Logger = {
  debug: (message: string, fields?: Record<string, unknown>) => void;
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
  child: (fields: Record<string, unknown>) => Logger;
};

function write(level: LogLevel, minimum: LogLevel, message: string, fields: Record<string, unknown>) {
  if (ORDER[level] < ORDER[minimum]) return;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...(redactValue(fields) as Record<string, unknown>),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(base: Record<string, unknown> = {}, minimum?: LogLevel): Logger {
  const level = minimum ?? ((process.env.LOG_LEVEL as LogLevel | undefined) || "info");
  const safeLevel: LogLevel = level in ORDER ? level : "info";
  const log = (entryLevel: LogLevel, message: string, fields?: Record<string, unknown>) => {
    write(entryLevel, safeLevel, message, { ...base, ...fields });
  };
  return {
    debug: (message, fields) => log("debug", message, fields),
    info: (message, fields) => log("info", message, fields),
    warn: (message, fields) => log("warn", message, fields),
    error: (message, fields) => log("error", message, fields),
    child: (fields) => createLogger({ ...base, ...fields }, safeLevel),
  };
}

export function createCorrelationId(): string {
  return crypto.randomUUID();
}
