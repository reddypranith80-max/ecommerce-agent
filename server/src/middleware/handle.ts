import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { AppError } from '../utils/errors';

type Schema = z.ZodType | undefined;
type Out<S extends Schema> = S extends z.ZodType ? z.output<S> : undefined;

export interface HandlerContext<B extends Schema, Q extends Schema, P extends Schema> {
  req: Request;
  res: Response;
  body: Out<B>;
  query: Out<Q>;
  params: Out<P>;
}

function parse(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Some fields are invalid.',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

/**
 * Validates body/query/params with Zod (unknown keys are rejected by the schemas) and calls the
 * controller with typed input. A returned value is sent as `{ data }`; return undefined to respond yourself.
 * Express 5 forwards thrown errors and rejected promises to the error handler.
 */
export function handle<B extends Schema = undefined, Q extends Schema = undefined, P extends Schema = undefined>(
  schemas: { body?: B; query?: Q; params?: P },
  fn: (ctx: HandlerContext<B, Q, P>) => Promise<unknown> | unknown,
  options: { status?: number } = {},
): RequestHandler {
  return async (req: Request, res: Response, _next: NextFunction) => {
    const params = schemas.params ? parse(schemas.params, req.params) : undefined;
    const query = schemas.query ? parse(schemas.query, req.query) : undefined;
    const body = schemas.body ? parse(schemas.body, req.body) : undefined;
    const result = await fn({ req, res, body, query, params } as HandlerContext<B, Q, P>);
    if (res.headersSent) return;
    if (result === undefined) {
      res.status(204).end();
      return;
    }
    res.status(options.status ?? 200).json({ data: result });
  };
}
