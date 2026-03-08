import baseConfig from './base.config.js';
import radixConfig from './eslint.radix.config.js';
import radixRules from './rules/radix-ui.js';

export { baseConfig, radixConfig };

export default [
  ...baseConfig,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'radix-custom': {
        rules: radixRules
      }
    },
    rules: {
      'radix-custom/no-empty-select-item': 'error'
    }
  }
];