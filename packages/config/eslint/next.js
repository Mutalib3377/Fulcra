// ESLint flat config for the Next.js app: base rules + Next.js and React hooks rules.
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';
import base from './base.js';

/** @type {import('eslint').Linter.Config[]} */
export default [...base, ...nextVitals, ...nextTs, prettier, { ignores: ['next-env.d.ts'] }];
