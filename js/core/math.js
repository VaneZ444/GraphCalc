const CONSTANTS = {
  pi: Math.PI,
  PI: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  true: 1,
  false: 0,
};

const FUNCTIONS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp,
  ln: Math.log, log: Math.log10, log2: Math.log2,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  min: Math.min, max: Math.max, pow: Math.pow, atan2: Math.atan2,
  mod: (a, b) => ((a % b) + b) % b,
};

/* ------------------------------------------------------------------ tokens */

function tokenize(source) {
  const tokens = [];
  const n = source.length;
  let i = 0;

  const isDigit = c => c >= '0' && c <= '9';
  const isAlpha = c => /[A-Za-z_]/.test(c);

  while (i < n) {
    const c = source[i];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

    // number literal
    if (isDigit(c) || (c === '.' && isDigit(source[i + 1] || ''))) {
      let j = i;
      while (j < n && isDigit(source[j])) j++;
      if (source[j] === '.') { j++; while (j < n && isDigit(source[j])) j++; }
      if (source[j] === 'e' || source[j] === 'E') {
        let k = j + 1;
        if (source[k] === '+' || source[k] === '-') k++;
        if (isDigit(source[k] || '')) { k++; while (k < n && isDigit(source[k])) k++; j = k; }
      }
      tokens.push({ type: 'number', value: parseFloat(source.slice(i, j)) });
      i = j;
      continue;
    }

    // identifier / variable / function name
    if (isAlpha(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(source[j])) j++;
      tokens.push({ type: 'name', value: source.slice(i, j) });
      i = j;
      continue;
    }

    // backslash command
    if (c === '\\') {
      let j = i + 1;
      while (j < n && /[A-Za-z]/.test(source[j])) j++;
      const command = source.slice(i, j);

      const symbolic = {
        '\\cdot': '*', '\\times': '*', '\\div': '/',
        '\\le': '<=', '\\leq': '<=', '\\ge': '>=', '\\geq': '>=',
        '\\ne': '!=', '\\neq': '!=', '\\lt': '<', '\\gt': '>',
        '\\land': '&&', '\\lor': '||',
        '\\left': '', '\\right': '', '\\,': '', '\\;': '', '\\!': '',
      };

      if (command in symbolic) {
        const value = symbolic[command];
        if (value) tokens.push({ type: 'op', value });
        i = j;
        continue;
      }
      if (command === '\\lnot' || command === '\\neg') {
        tokens.push({ type: 'name', value: 'not' });
        i = j;
        continue;
      }
      if (command === '\\pi') {
        tokens.push({ type: 'number', value: Math.PI });
        i = j;
        continue;
      }
      tokens.push({ type: 'name', value: command.slice(1) });
      i = j;
      continue;
    }

    // two-character operators
    const two = source.substr(i, 2);
    if (['<=', '>=', '==', '!=', '&&', '||', '<>', '=>'].includes(two)) {
      const value = two === '<>' ? '!=' : two === '=>' ? '>=' : two;
      tokens.push({ type: 'op', value });
      i += 2;
      continue;
    }

    // single characters
    if ('+-*/^%(),<>!{}'.includes(c)) {
      tokens.push({ type: 'op', value: c });
      i++;
      continue;
    }

    throw new Error(`Unexpected character "${c}"`);
  }

  return tokens;
}

/* ------------------------------------------------------------------ parser */

function parse(tokens) {
  let pos = 0;

  const peek = () => tokens[pos];
  const isOp = (token, value) => token && token.type === 'op' && token.value === value;
  const isName = (token, value) => token && token.type === 'name' && token.value === value;

  function parseOr() {
    let left = parseAnd();
    while (isOp(peek(), '||') || isName(peek(), 'or')) {
      pos++;
      left = { type: 'binary', op: '||', left, right: parseAnd() };
    }
    return left;
  }

  function parseAnd() {
    let left = parseComparison();
    while (isOp(peek(), '&&') || isName(peek(), 'and')) {
      pos++;
      left = { type: 'binary', op: '&&', left, right: parseComparison() };
    }
    return left;
  }

  function parseComparison() {
    let left = parseAdditive();
    const token = peek();
    if (token && token.type === 'op' &&
        ['<', '>', '<=', '>=', '==', '!='].includes(token.value)) {
      pos++;
      left = { type: 'binary', op: token.value, left, right: parseAdditive() };
    }
    return left;
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = tokens[pos++].value;
      left = { type: 'binary', op, left, right: parseMultiplicative() };
    }
    return left;
  }

  function parseMultiplicative() {
    let left = parseUnary();

    for (;;) {
      const token = peek();

      if (token && token.type === 'op' && (token.value === '*' || token.value === '/' || token.value === '%')) {
        pos++;
        left = { type: 'binary', op: token.value, left, right: parseUnary() };
        continue;
      }

      // implicit multiplication: 2t, 3(x+1), (a)(b)
      const implicit = token && (
        token.type === 'number' ||
        (token.type === 'name' && !['and', 'or', 'not'].includes(token.value)) ||
        isOp(token, '(') || isOp(token, '{')
      );
      if (implicit) {
        left = { type: 'binary', op: '*', left, right: parseUnary() };
        continue;
      }

      break;
    }

    return left;
  }

  function parseUnary() {
    const token = peek();

    if (token && token.type === 'op' && (token.value === '-' || token.value === '+')) {
      pos++;
      const operand = parseUnary();
      return token.value === '-' ? { type: 'negate', operand } : operand;
    }
    if (isOp(token, '!') || isName(token, 'not')) {
      pos++;
      return { type: 'not', operand: parseUnary() };
    }

    return parsePower();
  }

  function parsePower() {
    const base = parseAtom();
    if (isOp(peek(), '^')) {
      pos++;
      return { type: 'binary', op: '^', left: base, right: parseUnary() };
    }
    return base;
  }

  function parseAtom() {
    const token = tokens[pos];
    if (!token) throw new Error('Unexpected end of expression');

    if (token.type === 'number') {
      pos++;
      return { type: 'number', value: token.value };
    }

    if (token.type === 'name') {
      pos++;
      const name = token.value;

      // Only known functions consume parentheses — `t(t+1)` stays a product.
      if (FUNCTIONS[name] && (isOp(peek(), '(') || isOp(peek(), '{'))) {
        pos++;
        const args = [];
        if (!(isOp(peek(), ')') || isOp(peek(), '}'))) {
          args.push(parseOr());
          while (isOp(peek(), ',')) { pos++; args.push(parseOr()); }
        }
        if (isOp(peek(), ')') || isOp(peek(), '}')) pos++;
        else throw new Error('Missing closing parenthesis');
        return { type: 'call', name, args };
      }

      return { type: 'variable', name };
    }

    if (token.type === 'op' && (token.value === '(' || token.value === '{')) {
      pos++;
      const expression = parseOr();
      if (isOp(peek(), ')') || isOp(peek(), '}')) pos++;
      else throw new Error('Missing closing parenthesis');
      return expression;
    }

    throw new Error(`Unexpected token "${token.value}"`);
  }

  const ast = parseOr();
  if (pos < tokens.length) throw new Error('Unexpected trailing input');
  return ast;
}

/* --------------------------------------------------------------- evaluator */

function evaluateNode(node, scope) {
  switch (node.type) {
    case 'number':
      return node.value;

    case 'variable': {
      if (node.name in scope) return scope[node.name];
      if (node.name in CONSTANTS) return CONSTANTS[node.name];
      throw new Error(`Unknown variable "${node.name}"`);
    }

    case 'negate':
      return -evaluateNode(node.operand, scope);

    case 'not':
      return evaluateNode(node.operand, scope) ? 0 : 1;

    case 'binary': {
      const { op } = node;

      if (op === '&&') {
        return (evaluateNode(node.left, scope) && evaluateNode(node.right, scope)) ? 1 : 0;
      }
      if (op === '||') {
        return (evaluateNode(node.left, scope) || evaluateNode(node.right, scope)) ? 1 : 0;
      }

      const a = evaluateNode(node.left, scope);
      const b = evaluateNode(node.right, scope);

      switch (op) {
        case '+':  return a + b;
        case '-':  return a - b;
        case '*':  return a * b;
        case '/':  return a / b;
        case '%':  return a % b;
        case '^':  return a ** b;
        case '<':  return a <  b ? 1 : 0;
        case '>':  return a >  b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        default:   throw new Error(`Unknown operator "${op}"`);
      }
    }

    case 'call': {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new Error(`Unknown function "${node.name}"`);
      return fn(...node.args.map(arg => evaluateNode(arg, scope)));
    }

    default:
      throw new Error('Malformed expression');
  }
}

/* ------------------------------------------------------------------ public */

const compileCache = new Map();

export function compile(source) {
  let fn = compileCache.get(source);
  if (!fn) {
    const ast = parse(tokenize(source));
    fn = scope => evaluateNode(ast, scope);
    compileCache.set(source, fn);
  }
  return fn;
}

export function evaluate(source, scope) {
  return compile(source)(scope);
}

export function validate(source) {
  try {
    compile(source);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}