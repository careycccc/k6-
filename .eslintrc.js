module.exports = {
  env: {
    browser: false,
    node: true,
    es6: true
  },
  extends: ['eslint:recommended', 'prettier'],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module'
  },
  globals: {
    __ENV: 'readonly',
    __VU: 'readonly',
    __ITER: 'readonly',
    __DIR: 'readonly'
  },
  rules: {
    // 自定义规则
    'no-logger': 'off',
    'no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }
    ],
    quotes: ['error', 'single'],
    semi: ['error', 'always'],
    indent: ['error', 2],
    'comma-dangle': ['error', 'never'],
    'arrow-parens': ['error', 'always'],
    'prefer-const': 'error',
    'no-var': 'error'
  },
  overrides: [
    {
      files: ['**/*.test.js'],
      rules: {
        'no-undef': 'off' // k6 环境有全局变量
      }
    }
  ]
};
