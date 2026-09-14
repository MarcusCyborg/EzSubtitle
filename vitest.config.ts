import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    environmentOptions: {
      jsdom: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    },
  },
});
