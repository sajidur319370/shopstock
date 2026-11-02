import type { Aggregate, PipelineStage, Query, Schema } from 'mongoose';

declare module 'mongoose' {
  // Must repeat Mongoose's own type parameter, or the declarations don't merge (Mongoose 9).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface QueryOptions<DocType = unknown> {
    /** Reason string for an approved bypass, e.g. 'product-in-use-check'. See data-model.md §2.3. */
    skipBranchCheck?: string;
  }
}

export class BranchScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BranchScopeError';
  }
}

const QUERY_OPS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'updateMany',
  'replaceOne',
  'deleteMany',
  'countDocuments',
  'distinct',
] as const;
/** These two can also be document middleware; we register them as query middleware explicitly. */
const QUERY_OR_DOC_OPS = ['updateOne', 'deleteOne'] as const;

type Filter = Record<string, unknown>;

/** True if the filter pins at least one branch key, directly or in EVERY branch of an $or. */
function scoped(filter: Filter, keys: readonly string[]): boolean {
  if (keys.some((k) => filter[k] != null)) return true;
  const or = filter.$or;
  if (Array.isArray(or) && or.length > 0) return or.every((f) => scoped(f as Filter, keys));
  const and = filter.$and;
  if (Array.isArray(and)) return and.some((f) => scoped(f as Filter, keys));
  return false;
}

export function branchGuard(schema: Schema, opts: { keys?: readonly string[] } = {}): void {
  const keys = opts.keys ?? ['branchId'];

  function checkQuery(this: Query<unknown, unknown>) {
    if (this.getOptions().skipBranchCheck) return;
    if (!scoped(this.getFilter() as Filter, keys)) {
      const op = (this as unknown as { op?: string }).op; // set at runtime; not in Mongoose 9's types
      throw new BranchScopeError(`${this.model.modelName}.${op} called without ${keys.join('/')}`);
    }
  }

  schema.pre([...QUERY_OPS], checkQuery);
  schema.pre([...QUERY_OR_DOC_OPS], { document: false, query: true }, checkQuery);

  // Aggregations must START with a $match on the branch key. No bypass for aggregates.
  schema.pre('aggregate', function (this: Aggregate<unknown>) {
    const first = this.pipeline()[0] as PipelineStage | undefined;
    if (!first || !('$match' in first) || !scoped(first.$match as Filter, keys)) {
      throw new BranchScopeError(
        `${this.model().modelName}.aggregate must start with { $match: { ${keys.join(' | ')} } }`,
      );
    }
  });
}
