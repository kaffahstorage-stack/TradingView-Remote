import js from '@eslint/js';
import globals from 'globals';
import hooks from 'eslint-plugin-react-hooks';
export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.runtime/**', 'artifacts/**'] },
  js.configs.recommended,
  { files: ['**/*.{js,jsx}'], languageOptions: { globals: {...globals.node, ...globals.browser}, parserOptions: {ecmaFeatures: {jsx: true}} }, rules: {'no-unused-vars': ['error', {varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_'}]} },
  {files: ['web/src/**/*.{js,jsx}'], plugins: {'react-hooks': hooks}, rules: hooks.configs.recommended.rules},
];
