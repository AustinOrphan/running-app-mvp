// CSS Module Mock for Vitest
// This file provides a proxy that returns the class name as the value
// for any CSS module import, making tests predictable

export default new Proxy(
  {},
  {
    get: (_target, key) => {
      if (key === '__esModule') {
        return true;
      }
      // Return the key as the value for predictable testing
      return String(key);
    },
  }
);
