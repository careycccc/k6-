// Lightweight Zod-like validator for k6 (local, no network)
function makeType(check) {
  const t = {
    parse: function (val) {
      if (t._optional && (val === undefined || val === null)) {
        return val;
      }
      if (!check(val)) {
        throw new Error('type check failed');
      }
      return val;
    },
    _optional: false
  };
  t.optional = function () {
    t._optional = true;
    return t;
  };
  return t;
}

// minimal z object
const z = {
  number: () => makeType((v) => typeof v === 'number'),
  string: () => makeType((v) => typeof v === 'string'),
  boolean: () => makeType((v) => typeof v === 'boolean'),
  any: () => makeType(() => true),
  passthrough: () => ({ parse: (v) => v }),
  array: (elem) => {
    const t = {
      parse: (arr) => {
        if (t._optional && (arr === undefined || arr === null)) return arr;
        if (!Array.isArray(arr)) throw new Error('not array');
        if (elem && typeof elem.parse === 'function') {
          arr.forEach((item) => {
            elem.parse(item);
          });
        }
        return arr;
      },
      _optional: false
    };
    t.optional = function () {
      t._optional = true;
      return t;
    };
    return t;
  },
  object: (shape) => {
    const keys = Object.keys(shape || {});
    // base parser
    const baseParser = {
      parse: (obj) => {
        if (typeof obj !== 'object' || obj === null) throw new Error('not object');
        for (const key of keys) {
          const field = shape[key];
          if (!field) continue;
          if (obj[key] === undefined) {
            if (field._optional) continue;
            throw new Error(`missing ${key}`);
          }
          if (typeof field.parse === 'function') field.parse(obj[key]);
        }
        return obj;
      },
      passthrough: () => ({ parse: (v) => v })
    };
    // wrapper to support optional at object level
    const wrapper = {
      parse: (val) => (val === undefined || val === null ? val : baseParser.parse(val)),
      passthrough: baseParser.passthrough
    };
    // expose optional() on the returned type
    wrapper.optional = function () {
      return {
        parse: (val) => (val === undefined || val === null ? val : baseParser.parse(val)),
        passthrough: baseParser.passthrough
      };
    };
    return wrapper;
  }
};

export { z };
