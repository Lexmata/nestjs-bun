/**
 * The Fastify hook names this adapter supports, kept free of imports.
 *
 * `docs/` imports this module directly so its tests can check the documentation
 * against the real list. The docs are an Angular project compiled with their own
 * tsconfig and no Bun or NestJS types, so anything imported from here would be
 * compiled there too; `fastify-compat.ts` re-exports both names.
 */

/**
 * Fastify hook names supported by this adapter.
 *
 * Fastify itself also defines `preParsing`, `onTimeout`, `onClose`, `onReady`
 * and `onListen`; those have no meaningful execution stage here and
 * `FastifyHooksManager.addHook` throws when they are registered.
 */
export type FastifyHookName =
  | "onRequest"
  | "preValidation"
  | "preHandler"
  | "preSerialization"
  | "onSend"
  | "onError"
  | "onResponse";

/**
 * Runtime list matching {@link FastifyHookName}.
 */
export const SUPPORTED_FASTIFY_HOOKS: readonly FastifyHookName[] = [
  "onRequest",
  "preValidation",
  "preHandler",
  "preSerialization",
  "onSend",
  "onError",
  "onResponse",
] as const;
