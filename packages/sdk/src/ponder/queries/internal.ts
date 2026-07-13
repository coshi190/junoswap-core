import type { PonderPageInfo } from '../client'

/**
 * Shared helpers for the query modules.
 *
 * Every query declares its selection as a `satisfies readonly (keyof Entity)[]` array and builds
 * the GraphQL selection set from it, so a field the indexer's schema doesn't have is a compile
 * error rather than a silent `undefined` at runtime. Filter values are always passed as GraphQL
 * variables — never interpolated into the query text.
 */

/** The rows a query returns, narrowed to the fields it actually selected. */
export type Row<TEntity, TFields extends readonly (keyof TEntity)[]> = Pick<
    TEntity,
    TFields[number]
>

export interface Items<T> {
    items: T[]
}

export interface Page<T> extends Items<T> {
    pageInfo: PonderPageInfo
}

export interface CountedItems<T> extends Items<T> {
    totalCount: number
}

/** Renders a selection set. */
export const sel = (fields: readonly PropertyKey[]): string => fields.join(' ')

export type OrderDirection = 'asc' | 'desc'

/** Ponder caps a list response at 50 rows unless an explicit limit is given. */
export const MAX_LIMIT = 1000
