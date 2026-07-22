export {
  createLogger,
  Logger,
  type ILogger,
  type LogLevel,
  type LogEntry,
  type LogContext,
  type LoggerConfig,
  type LoggerBackend,
  type ErrorDetails,
} from './logger.js';

export {
  ConsoleBackend,
  createConsoleBackend,
  type ConsoleBackendOptions,
} from './backends/console.js';

export {
  WinstonBackend,
  createWinstonBackend,
  type WinstonBackendOptions,
} from './backends/winston.js';

export {
  PinoBackend,
  createPinoBackend,
  type PinoBackendOptions,
} from './backends/pino.js';

export {
  redactObject,
  redactString,
  redactValue,
  createRedactor,
  hashEmail,
  maskIP,
  maskPhone,
  isAlwaysRedactKey,
  type RedactionOptions,
} from './redaction.js';

export {
  requestLogger,
  correlationId,
  errorLogger,
  REQUEST_ID_HEADER,
  TRACE_ID_HEADER,
  type RequestLoggerOptions,
  type CorrelationIdOptions,
} from './adapters/express.js';

export {
  fastifyLoggerPlugin,
  type FastifyLoggerPluginOptions,
} from './adapters/fastify.js';
