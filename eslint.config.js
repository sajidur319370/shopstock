import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  // ONE DOOR: only the stock module may change inventory.quantity (NFR-MAINT-04).
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/modules/inventory/stock.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // { $inc: { quantity: … } } or { $set: { quantity: … } } anywhere outside stock.ts
          selector: "Property[key.name=/^\\$(inc|set)$/] > ObjectExpression > Property[key.name='quantity']",
          message: 'Only modules/inventory/stock.ts may change inventory.quantity (NFR-MAINT-04).',
        },
        {
          selector: "MemberExpression[object.name=/^(Inventory|StockMovement)$/][property.name='collection']",
          message: 'No raw driver access to inventory or movements.',
        },
      ],
    },
  },
);
