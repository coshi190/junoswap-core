import { defineConfig } from 'vitest/config'

// The indexer's tests used to free-ride on the frontend repo's root vitest config (and its
// node_modules). They run here now.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['__tests__/**/*.test.ts'],
        globals: true,
    },
})
