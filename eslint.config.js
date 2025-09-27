import js from '@eslint/js';
import prettierPlugin from 'eslint-plugin-prettier';
import globals from 'globals';
import { defineConfig } from 'eslint/config';

export default defineConfig([
    {
        files: ['**/*.{js,mjs,cjs}'],
        plugins: {
            prettier: prettierPlugin,
        },
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        languageOptions: {
            globals: globals.browser,
        },
        rules: {
            'prettier/prettier': [
                'error',
                {
                    semi: true,
                    singleQuote: true,
                    trailingComma: 'es5',
                    tabWidth: 4,
                    arrowParens: 'always',
                    printWidth: 180,
                    bracketSpacing: true,
                    bracketSameLine: false,
                    useTabs: false,
                    endOfLine: 'lf',
                },
            ],
        },
    },
]);
