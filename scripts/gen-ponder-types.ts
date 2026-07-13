/**
 * Generates packages/sdk/src/ponder/entities.ts from indexer/ponder.schema.ts.
 *
 * The frontend used to hand-declare a response interface per GraphQL query, against a schema
 * it couldn't see. Nothing checked those field names — a renamed column kept compiling and
 * silently returned undefined at runtime. Generating the row types here means the SDK's query
 * field lists (`satisfies readonly (keyof LaunchToken)[]`) are checked by tsc instead.
 *
 * Ponder's GraphQL root field for a table is its TS name + "s" (launchToken -> launchTokens);
 * see conditionSuffixes / pluralFieldName in ponder/dist/esm/graphql/index.js.
 */
import { $ } from 'bun'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getTableColumns } from 'drizzle-orm'

const ROOT = path.resolve(import.meta.dir, '..')
const OUT_FILE = path.join(ROOT, 'packages/sdk/src/ponder/entities.ts')

const pascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

async function main() {
    const schema = (await import(path.join(ROOT, 'indexer/ponder.schema.ts'))) as Record<
        string,
        object
    >

    const lines: string[] = [
        `// Generated from indexer/ponder.schema.ts by \`bun run codegen\`. Do not edit by hand.`,
        `//`,
        `// One type per indexed table. Query field lists in ./queries are constrained against`,
        `// these (\`satisfies readonly (keyof X)[]\`), so a column renamed in the indexer breaks`,
        `// the build instead of silently returning undefined.`,
        ``,
    ]
    const rootFields: string[] = []

    for (const [tsName, table] of Object.entries(schema)) {
        const columns = getTableColumns(table as never)
        const typeName = pascal(tsName)

        lines.push(`export interface ${typeName} {`)
        for (const [name, col] of Object.entries(columns)) {
            const c = col as { dataType: string; notNull: boolean }
            const base = c.dataType === 'number' ? 'number' : 'string'
            // Ponder emits a nullable GraphQL field for any column that isn't notNull —
            // including ones with a SQL default, which are still nullable on the wire.
            lines.push(`    ${name}: ${base}${c.notNull ? '' : ' | null'}`)
        }
        lines.push(`}`, ``)

        rootFields.push(`    ${tsName}s: '${typeName}'`)
    }

    lines.push(
        `/** GraphQL root field -> entity, for reference. Ponder pluralises a table as tsName + "s". */`,
        `export interface PonderRootFields {`,
        ...rootFields,
        `}`,
        ``
    )

    await mkdir(path.dirname(OUT_FILE), { recursive: true })
    await writeFile(OUT_FILE, lines.join('\n'))
    await $`bun x prettier --write ${OUT_FILE}`.quiet()
    console.log(`Generated ${Object.keys(schema).length} entity types → ${path.relative(ROOT, OUT_FILE)}`)
}

await main()
