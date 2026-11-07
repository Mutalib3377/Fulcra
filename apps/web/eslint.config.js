import next from '@fulcra/config/eslint/next';

const config = [
  ...next,
  {
    // Store pages live on <name>.yourdomain.com, where "/" is the store home, not the
    // marketing page this rule thinks of. They use plain links on purpose: no prefetching,
    // so cheap phones on slow data only download the page the customer opens.
    files: ['app/(store)/**/*.tsx'],
    rules: { '@next/next/no-html-link-for-pages': 'off' },
  },
];

export default config;
