// Core exports
export { BunAdapter } from "./bun-adapter";
export { NestBunFactory } from "./nest-bun-application";

// Interface exports
export type {
  BunServerOptions,
  BunRequest,
  // The declared return type of `NestBunApplication.getHttpServer()`; without it
  // downstream declaration emit hits TS4023 ("cannot be named").
  BunHttpServer,
  NestBunApplication,
  NestBunApplicationOptions,
} from "./interfaces";

// Express compatibility exports
export {
  createExpressRequest,
  createExpressResponse,
  type ExpressRequest,
  type ExpressResponse,
  type ExpressMiddleware,
  type ExpressErrorMiddleware,
  type CookieOptions,
} from "./express-compat";

// Fastify compatibility exports
export {
  createFastifyRequest,
  createFastifyReply,
  FastifyHooksManager,
  FastifyPluginRegistry,
  SUPPORTED_FASTIFY_HOOKS,
  DEFAULT_HOOK_TIMEOUT_MS,
  type FastifyRequest,
  type FastifyReply,
  type FastifyPlugin,
  type FastifyInstance,
  type FastifyHookName,
  type FastifyOnRequestHook,
  type FastifyPreValidationHook,
  type FastifyPreHandlerHook,
  type FastifyPayloadHook,
  type FastifyPreSerializationHook,
  type FastifyOnSendHook,
  type FastifyOnErrorHook,
  type FastifyOnResponseHook,
  type FastifyRouteHandler,
  type FastifyMiddleware,
  type FastifyHooksManagerOptions,
  type CreateFastifyRequestOptions,
} from "./fastify-compat";

// Utility exports
export {
  parseQueryParams,
  parseBody,
  enhanceRequest,
  getHeader,
  accepts,
  getIp,
  BodyParseError,
  type ParsedRequest,
  type GetIpOptions,
  type RequestIpResolver,
} from "./utils/request";

export {
  ResponseBuilder,
  response,
  json,
  text,
  html,
  error,
} from "./utils/response";
