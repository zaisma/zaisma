// The pattern rules (docs/PATTERN-RULES.md): each finds one risky pattern in Zaisma's own code, read with the TypeScript compiler.
// A rule accepts only what it can prove. What's left and safe is a reviewed site (reviewed-sites.mjs); what's left and not safe is a finding.
import ts from "typescript";

/** A name that says its value is a secret. */
const SECRET_NAME = /secret|token|signature|password|passcode|hmac|digest|api_?key|private_?key|session_?key|(code|key)_?(sha256|hash)/i;
/** A name that says it holds something about a secret, not the secret. */
const ABOUT_A_SECRET_NAME = /(_?id|_?name|_?names|_?count|_?type|_?kind|_?at|_?at_ms|_?ms|_?hint|_?prefix|_?length|_?limit|_?digits|_?bytes|changed|_?status|_?number|_?identifier|_?path|_?url|_?match|sale|set)$/i;
/** Worker settings a page may carry: made to be public. */
const PUBLIC_SETTING_NAME = /SITE_KEY|PUBLISHABLE|PUBLIC/;
const SECRET_SETTING_NAME = /(SECRET|KEY|TOKEN|PASSWORD)(_|$)/;
const ADDRESS_FIELD_NAME = /^(next|then|back|to|return|return_to|redirect|redirect_to)$/;
const CHECKING_FUNCTION_NAME = /^(safe|read|check|shown|is|valid)/i;
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/;
/** Functions that answer text with no value's markup left in it: escaped, encoded or rendered by Zaisma's own code. */
const RENDERING_FUNCTION_NAME = /^(esc|raw|dataJson|encodeURIComponent|renderMarkdown|icon|largeIcon|pageScriptPath|pageStylePath|shownAddress|shownColor|colorCode|firstPaintStyles)$/;
/** Functions that answer a number, whatever they're given. */
const NUMBER_FUNCTION_NAME = /^(Number|parseInt|parseFloat|Math\.[a-z0-9]+|Date\.now)$/;
const TEXT_METHOD_NAME = new Set(["join", "split", "repeat", "slice", "trim", "concat", "toLowerCase", "toUpperCase", "replace", "replaceAll", "filter", "toString", "padStart", "padEnd"]);
/** Methods that hand their function each value of the list they're called on. */
const WALKING_METHOD_NAME = new Set(["map", "flatMap", "filter", "find", "some", "every", "forEach"]);
/** Replacing every special character of a pattern with itself, escaped. */
const ESCAPES_A_PATTERN = /\.replace\(\/\[\.\*\+\?\^\$\{\}\(\)\|\[\\\]\\\\\]\/g/;
const RESPONSE_CALL = /^(Response\.json|new Response)\b/;
/** Text holding browser code: a page script, or a piece of one. */
const BROWSER_CODE = /addEventListener\(|createElement\(|document\.cookie|Math\.random|new RegExp|\beval\(|new Function/;
const SHORT_TEXT_CHARACTER_COUNT = 400;

const textOf = (node) => node.getText(node.getSourceFile());
const stripped = (node) => (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) ? stripped(node.expression) : node);
const isTextLiteral = (node) => ts.isStringLiteralLike(node) || ts.isTemplateExpression(node);
const lastNameOf = (node) => {
  const inner = stripped(node);
  if (ts.isIdentifier(inner)) return inner.text;
  if (ts.isPropertyAccessExpression(inner)) return inner.name.text;
  return null;
};
const isSecretName = (name) => Boolean(name) && !CONSTANT_NAME.test(name) && SECRET_NAME.test(name) && !ABOUT_A_SECRET_NAME.test(name);

/** The declaration a name means where it's used: the nearest variable, function or parameter of that name, outward from the use. */
function declarationOf(node, name) {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope)) {
      const parameter = scope.parameters.find((each) => ts.isIdentifier(each.name) && each.name.text === name);
      if (parameter) return parameter;
    }
    for (const statement of scope.statements ?? []) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
      if (ts.isVariableStatement(statement)) {
        const found = statement.declarationList.declarations.find((each) => ts.isIdentifier(each.name) && each.name.text === name);
        if (found) return found;
      }
    }
  }
  return null;
}

/** What a function can answer, when that's plain to see: its expression, or every value it returns. */
function answersOf(declaration) {
  const body = declaration.body;
  if (!body) return null;
  if (!ts.isBlock(body)) return [body];
  const answers = [];
  const visit = (node) => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) answers.push(node.expression);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return answers;
}

/** A type that allows only text written in the type: "a" | "b". */
function isFixedTextType(type) {
  if (ts.isLiteralTypeNode(type)) return ts.isStringLiteralLike(type.literal) || ts.isNumericLiteral(type.literal);
  return ts.isUnionTypeNode(type) && type.types.every(isFixedTextType);
}

/** Its name, for a function that has one in its file. */
function functionNameOf(declaration) {
  if (ts.isFunctionDeclaration(declaration)) return declaration.name?.text ?? null;
  return declaration.parent && ts.isVariableDeclaration(declaration.parent) && ts.isIdentifier(declaration.parent.name) ? declaration.parent.name.text : null;
}

const isExported = (declaration) => {
  const statement = ts.isFunctionDeclaration(declaration) ? declaration : declaration.parent?.parent?.parent;
  return Boolean(statement?.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
};

/** Every call of a function in its own file, or null for one with no name there. */
function callsOf(declaration) {
  const name = functionNameOf(declaration);
  if (!name) return null;
  const calls = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(declaration.getSourceFile());
  return calls;
}

/** Everything the code writes to a name after declaring it, in the block that declares it. */
function laterWritesTo(declaration, name) {
  const writes = [];
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && node.left.text === name && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken].includes(node.operatorToken.kind)) writes.push(node.right);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === name && ["push", "unshift"].includes(node.expression.name.text)) writes.push(...node.arguments);
    ts.forEachChild(node, visit);
  };
  visit(declaration.parent.parent.parent);
  return writes;
}

/**
 * Whether code can show this expression holds only text Zaisma wrote: literals, constants, what's built from those, numbers.
 * `allowsCall` says which calls count too. A name it can't follow isn't fixed.
 */
function isFixed(expression, allows = () => false, followed = new Set()) {
  const again = (each) => isFixed(each, allows, followed);
  const node = stripped(expression);
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return true;
  if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return true;
  if (ts.isRegularExpressionLiteral(node)) return true;
  if (ts.isTemplateExpression(node)) return node.templateSpans.every((span) => again(span.expression));
  if (ts.isConditionalExpression(node)) return again(node.whenTrue) && again(node.whenFalse);
  if (ts.isBinaryExpression(node)) return [ts.SyntaxKind.PlusToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind) ? again(node.left) && again(node.right) : true;
  if (ts.isArrayLiteralExpression(node)) return node.elements.every((element) => (ts.isSpreadElement(element) ? again(element.expression) : again(element)));
  if (allows(node)) return true;
  if (ts.isIdentifier(node)) {
    if (CONSTANT_NAME.test(node.text) || node.text === "undefined") return true;
    const declaration = declarationOf(node, node.text);
    if (!declaration) return false;
    if (followed.has(declaration)) return true;
    followed.add(declaration);
    if (ts.isVariableDeclaration(declaration)) return Boolean(declaration.initializer) && again(declaration.initializer) && laterWritesTo(declaration, node.text).every(again);
    if (ts.isParameter(declaration)) {
      if (declaration.type && isFixedTextType(declaration.type)) return true;
      if (declaration.initializer && !declaration.dotDotDotToken && callsOf(declaration.parent)?.length === 0) return again(declaration.initializer);
      // The value of a list Zaisma wrote, in the function that walks it.
      const walking = declaration.parent.parent;
      if (ts.isCallExpression(walking) && ts.isPropertyAccessExpression(walking.expression) && WALKING_METHOD_NAME.has(walking.expression.name.text)) return again(walking.expression.expression);
      // What every call of this file's own function gives it.
      const parameterIndex = declaration.parent.parameters.indexOf(declaration);
      const calls = callsOf(declaration.parent);
      return Boolean(calls?.length) && !isExported(declaration.parent) && calls.every((call) => call.arguments[parameterIndex] && !call.arguments.slice(0, parameterIndex + 1).some(ts.isSpreadElement) && again(call.arguments[parameterIndex]));
    }
    return false;
  }
  if (ts.isPropertyAccessExpression(node)) return CONSTANT_NAME.test(node.name.text) || node.name.text === "length" || node.name.text === "source" || again(node.expression);
  // Whatever's asked of a table Zaisma wrote, the answer is Zaisma's.
  if (ts.isElementAccessExpression(node)) return again(node.expression);
  if (ts.isCallExpression(node)) {
    const called = textOf(node.expression);
    if (NUMBER_FUNCTION_NAME.test(called) || (called === "String" && again(node.arguments[0]))) return true;
    if (ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (method === "toFixed") return true;
      if (method === "map" || method === "flatMap") {
        const walker = node.arguments[0];
        return Boolean(walker) && ts.isFunctionLike(walker) && answersOf(walker).every(again);
      }
      if (TEXT_METHOD_NAME.has(method)) return again(node.expression.expression);
    }
    if (ts.isIdentifier(node.expression)) {
      const declaration = declarationOf(node, node.expression.text);
      const called = declaration && ts.isVariableDeclaration(declaration) ? declaration.initializer : declaration;
      if (called && ts.isFunctionLike(called)) {
        const answers = answersOf(called);
        if (answers?.length) return answers.every(again);
      }
    }
  }
  return false;
}

const SQL_FUNCTION_NAME = /(Sql|SQL|placeholders|quoteName)$/;
const isSqlCall = (node) => ts.isCallExpression(node) && SQL_FUNCTION_NAME.test(textOf(node.expression));
const isRendered = (node) => {
  if (ts.isTaggedTemplateExpression(node)) return textOf(node.tag) === "html";
  // A Raw's own text: already through html`…`.
  if (ts.isPropertyAccessExpression(node)) return node.name.text === "html";
  return ts.isCallExpression(node) && RENDERING_FUNCTION_NAME.test(textOf(node.expression));
};

/** The name a window's listener is added on: anything else listening for "message" is a channel Zaisma opened itself. */
const isWindowListener = (node) => ["addEventListener", "window.addEventListener", "self.addEventListener", "globalThis.addEventListener"].includes(textOf(node.expression));

/** The text of a function given by name, or written in place. */
function handlerText(handler, atNode) {
  if (ts.isIdentifier(handler)) {
    const declaration = declarationOf(atNode, handler.text);
    return declaration ? textOf(declaration) : "";
  }
  // One kept on an object, written beside where it's added.
  return ts.isPropertyAccessExpression(handler) ? textOf(enclosingFunction(atNode)) : textOf(handler);
}

const enclosingFunction = (node) => {
  for (let scope = node.parent; scope; scope = scope.parent) if (ts.isFunctionLike(scope) || ts.isSourceFile(scope)) return scope;
  return null;
};

/** Whether what's read from the request goes straight into a check or a comparison. */
function reachesCheck(read) {
  for (let node = read, parent = read.parent; parent; node = parent, parent = parent.parent) {
    if (ts.isBinaryExpression(parent)) {
      if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(parent.operatorToken.kind)) return true;
      if (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || parent.operatorToken.kind === ts.SyntaxKind.BarBarToken) continue;
      return false;
    }
    if (ts.isConditionalExpression(parent) && parent.condition !== node) continue;
    if (ts.isCallExpression(parent)) {
      const called = textOf(parent.expression);
      if (called === "String") continue;
      if (parent.expression === node && ts.isPropertyAccessExpression(node)) continue;
      if (ts.isIdentifier(parent.expression) && CHECKING_FUNCTION_NAME.test(called)) return true;
      if (ts.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === "test") return true;
      return false;
    }
    if (ts.isPropertyAccessExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent)) continue;
    return false;
  }
  return false;
}

/** Names of values a log line is given, inside its text too. */
function namesGiven(expression) {
  const names = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) names.push(node.text);
    if (ts.isPropertyAccessExpression(node)) {
      names.push(node.name.text);
      return;
    }
    if (ts.isCallExpression(node)) return node.arguments.forEach(visit);
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return names;
}

const isCompareOperator = (kind) => [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(kind);

/** Each rule: its id, what goes wrong, what to do instead, and whether a node is a site of it. */
export const PATTERN_RULES = [
  {
    rule_id: "sql_text_from_a_value",
    goes_wrong: "SQL built from a value runs what that value says.",
    do_instead: "Keep the SQL's text fixed and pass values through bind(). A column or table chosen in code comes from a constant or a literal in the same function.",
    isSite: (node) => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || !node.arguments[0]) return false;
      const method = node.expression.name.text;
      const isStatement = method === "prepare" || (method === "exec" && !ts.isRegularExpressionLiteral(stripped(node.expression.expression)) && /sql|database|\bDB\b/i.test(textOf(node.expression.expression)));
      return isStatement && !isFixed(node.arguments[0], isSqlCall);
    },
  },
  {
    rule_id: "sql_without_where",
    goes_wrong: "A DELETE or UPDATE with no WHERE changes every row.",
    do_instead: "Name the rows with WHERE.",
    isSite: (node) => isTextLiteral(node) && /^[`"']\s*(DELETE FROM \w+|UPDATE \w+ SET )/.test(textOf(node)) && !/\bWHERE\b/i.test(textOf(node)),
  },
  {
    rule_id: "raw_takes_a_value",
    goes_wrong: "raw() skips escaping, so a value in it can write markup and scripts into the page.",
    do_instead: "Put the value in html`…`, which escapes it, or through esc(), shownAddress() or shownColor().",
    isSite: (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "raw" && Boolean(node.arguments[0]) && !isFixed(node.arguments[0], isRendered),
  },
  {
    rule_id: "secret_compared_plainly",
    goes_wrong: "=== stops at the first wrong character, so its timing tells a guesser how close they are.",
    do_instead: "Compare secrets with crypto.subtle.timingSafeEqual, or verify a signature with crypto.subtle.verify.",
    isSite: (node) => {
      if (!ts.isBinaryExpression(node) || !isCompareOperator(node.operatorToken.kind)) return false;
      const isEmptyCheck = (side) => ts.isStringLiteralLike(side) || ts.isNumericLiteral(side) || [ts.SyntaxKind.NullKeyword, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(side.kind) || textOf(side) === "undefined" || ts.isTypeOfExpression(side);
      if (isEmptyCheck(node.left) || isEmptyCheck(node.right)) return false;
      return isSecretName(lastNameOf(node.left)) || isSecretName(lastNameOf(node.right));
    },
  },
  {
    rule_id: "random_for_a_secret",
    goes_wrong: "Math.random can be predicted, so an id, code or token made from it can be guessed.",
    do_instead: "Use crypto.getRandomValues or crypto.randomUUID.",
    isSite: (node) => ts.isPropertyAccessExpression(node) && textOf(node) === "Math.random",
  },
  {
    rule_id: "message_without_sender_check",
    goes_wrong: "A game's page can post a message to any window it can reach, so a listener that doesn't ask who sent it obeys the game.",
    do_instead: "Check event.source or event.origin first.",
    isSite: (node) =>
      ts.isCallExpression(node) && isWindowListener(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === "message" && !/\.(source|origin)\b/.test(handlerText(node.arguments[1], node)),
  },
  {
    rule_id: "frame_without_sandbox",
    goes_wrong: "A frame with no sandbox gives what's inside it the run of a page.",
    do_instead: "Give it a sandbox attribute with only what it needs.",
    isSite: (node) => {
      if (ts.isCallExpression(node) && /(^|\.)createElement$/.test(textOf(node.expression)) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === "iframe") return !/sandbox/.test(textOf(enclosingFunction(node)));
      if (!isTextLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) return false;
      const tag = /<iframe\b(?:(?!<\/iframe)[\s\S])*/.exec(textOf(node));
      return Boolean(tag) && !tag[0].includes("sandbox");
    },
  },
  {
    rule_id: "body_read_without_cap",
    goes_wrong: "Reading a whole body with no limit lets one request fill the Worker's memory, and takes every request sharing it down too.",
    do_instead: "Read it through a helper that stops at a size, like readJson in developer.ts.",
    isSite: (node) => ts.isCallExpression(node) && /^(request|req)\.(json|text|arrayBuffer|formData|blob)$/.test(textOf(node.expression)) && !/content-length|maximumSizeBytes|maximum\w*Bytes|\bcapped/i.test(textOf(enclosingFunction(node))),
  },
  {
    rule_id: "pattern_from_a_value",
    goes_wrong: "A pattern built from a value can run for minutes on a short text, or match what it never meant to.",
    do_instead: "Keep the pattern fixed, or escape the value first.",
    isSite: (node) => {
      if (!(ts.isNewExpression(node) || ts.isCallExpression(node)) || textOf(node.expression) !== "RegExp" || !node.arguments?.[0]) return false;
      return !isFixed(node.arguments[0], (given) => ts.isCallExpression(given) && (/escapeRegExp|escapeRegex/.test(textOf(given.expression)) || ESCAPES_A_PATTERN.test(textOf(given))));
    },
  },
  {
    rule_id: "secret_in_a_log",
    goes_wrong: "Logs are kept and read by more than the code, so a secret in one has leaked.",
    do_instead: "Log what happened and an id, never the value, the whole request, its headers or env.",
    isSite: (node) =>
      ts.isCallExpression(node) && /^console\.[a-z]+$/.test(textOf(node.expression)) && node.arguments.some((given) => namesGiven(given).some((name) => isSecretName(name) || ["request", "headers", "cookies", "env"].includes(name) && lastNameOf(given) === name)),
  },
  {
    rule_id: "secret_in_a_page",
    goes_wrong: "Anything in a page is read by everyone who opens it.",
    do_instead: "Keep the secret on the server, and send the page what it does.",
    isSite: (node) => {
      if (!ts.isPropertyAccessExpression(node) || textOf(node.expression) !== "env" || !SECRET_SETTING_NAME.test(node.name.text) || PUBLIC_SETTING_NAME.test(node.name.text)) return false;
      // Whether it's set says nothing of what it is.
      if ((ts.isConditionalExpression(node.parent) && node.parent.condition === node) || (ts.isPrefixUnaryExpression(node.parent) && node.parent.operator === ts.SyntaxKind.ExclamationToken)) return false;
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isTaggedTemplateExpression(parent) && textOf(parent.tag) === "html") return true;
        if (ts.isCallExpression(parent) && /^(pageData|pageScript)$/.test(textOf(parent.expression))) return true;
      }
      return false;
    },
  },
  {
    rule_id: "cookie_without_protection",
    goes_wrong: "A cookie with no Secure goes over plain connections, with no SameSite goes along on other sites' requests, and with no HttpOnly can be read by a script.",
    do_instead: "Set Secure, SameSite and HttpOnly. A cookie a page's script must read is a reviewed site.",
    isSite: (node) => {
      if (!isTextLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) return false;
      const text = textOf(node);
      if (text.length > SHORT_TEXT_CHARACTER_COUNT || BROWSER_CODE.test(text) || !/;\s*(Path=|Max-Age=|Expires=)/i.test(text)) return false;
      // Setting one's end to now erases it: there's nothing left to protect.
      if (/Max-Age=0\b/i.test(text)) return false;
      return !(/\bSecure\b|__Host-|__Secure-/i.test(text) && /SameSite=/i.test(text) && /HttpOnly/i.test(text));
    },
  },
  {
    rule_id: "address_read_unchecked",
    goes_wrong: "An address taken from a request and followed sends a signed-in person wherever a link says.",
    do_instead: "Pass it straight through a checker like safeNext, or compare it with what's allowed.",
    isSite: (node) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "get" && /searchParams|query|form|params/i.test(textOf(node.expression.expression)) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && ADDRESS_FIELD_NAME.test(node.arguments[0].text) && !reachesCheck(node),
  },
  {
    rule_id: "cors_echoes_origin",
    goes_wrong: "Answering with the caller's own origin lets any site read the answer, and credentials make that the signed-in person's.",
    do_instead: "Answer \"*\" for what's public to everyone, and never send credentials across sites.",
    isSite: (node) => {
      const nameOf = (name) => (ts.isStringLiteralLike(name) ? name.text : null);
      const isAllowOrigin = (name) => nameOf(name) === "Access-Control-Allow-Origin";
      if (ts.isPropertyAssignment(node)) return nameOf(node.name) === "Access-Control-Allow-Credentials" || (isAllowOrigin(node.name) && !(ts.isStringLiteralLike(node.initializer) && node.initializer.text === "*"));
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isElementAccessExpression(node.left)) return nameOf(node.left.argumentExpression) === "Access-Control-Allow-Credentials" || (isAllowOrigin(node.left.argumentExpression) && !(ts.isStringLiteralLike(node.right) && node.right.text === "*"));
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["set", "append"].includes(node.expression.name.text) && node.arguments[0]) return nameOf(node.arguments[0]) === "Access-Control-Allow-Credentials" || (isAllowOrigin(node.arguments[0]) && !(node.arguments[1] && ts.isStringLiteralLike(node.arguments[1]) && node.arguments[1].text === "*"));
      return false;
    },
  },
  {
    rule_id: "error_text_in_an_answer",
    goes_wrong: "An error's own text can name tables, paths and keys, and a caller shouldn't read them.",
    do_instead: "Answer with a code and a message Zaisma wrote, and log the error.",
    isSite: (node) => {
      if (!(ts.isCallExpression(node) || ts.isNewExpression(node)) || !RESPONSE_CALL.test(textOf(node))) return false;
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (!ts.isCatchClause(parent) || !parent.variableDeclaration || !ts.isIdentifier(parent.variableDeclaration.name)) continue;
        const caught = parent.variableDeclaration.name.text;
        if (/\binstanceof\b/.test(textOf(parent.block))) return false;
        return new RegExp(`\\b${caught}\\.(message|stack)\\b|String\\(${caught}\\)|\\$\\{${caught}\\}`).test(textOf(node));
      }
      return false;
    },
  },
  {
    rule_id: "money_from_the_request",
    goes_wrong: "An amount a client sends is an amount the client chose.",
    do_instead: "Read the amount from the item or the sale on the server.",
    isSite: (node) => ts.isPropertyAssignment(node) && /^(amount|unit_amount|amount_total)$/.test(node.name.getText()) && /^(body|input|given|form|query|params|request)\b/.test(textOf(stripped(node.initializer))),
  },
  {
    rule_id: "code_from_text",
    goes_wrong: "Text run as code does whatever the text says.",
    do_instead: "Write the code out.",
    isSite: (node) => {
      if (ts.isNewExpression(node)) return textOf(node.expression) === "Function";
      if (!ts.isCallExpression(node)) return false;
      const called = textOf(node.expression);
      if (called === "eval" || called === "Function") return true;
      return /^(window\.)?(setTimeout|setInterval)$/.test(called) && Boolean(node.arguments[0]) && isTextLiteral(node.arguments[0]);
    },
  },
];

/** The name of what holds a node: its function, method or variable. */
function symbolNameOf(node) {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if ((ts.isFunctionDeclaration(scope) || ts.isMethodDeclaration(scope) || ts.isClassDeclaration(scope)) && scope.name) return scope.name.getText();
    if (ts.isVariableDeclaration(scope) && ts.isIdentifier(scope.name)) return scope.name.text;
    if (ts.isPropertyAssignment(scope) && (ts.isIdentifier(scope.name) || ts.isStringLiteralLike(scope.name))) return scope.name.getText().replace(/^["']|["']$/g, "");
  }
  return null;
}

const siteTextOf = (node) => textOf(node).replace(/\s+/g, " ").slice(0, 200);

/** Browser code held in a string or template, with each `${}` stood in for by a name, or null. */
function browserCodeIn(node) {
  if (node.parent && ts.isTaggedTemplateExpression(node.parent)) return null;
  if (ts.isTemplateExpression(node)) {
    const text = [node.head.text, ...node.templateSpans.map((span) => `zaismaHole${span.literal.text}`)].join("");
    return BROWSER_CODE.test(text) ? text : null;
  }
  if (ts.isStringLiteralLike(node) && BROWSER_CODE.test(node.text)) return node.text;
  return null;
}

/** Every site of every rule in a file's text, as findings without a reviewed site's say. Browser code inside its strings is read too. */
export function findingsInSource(sourceText, sourcePath) {
  const findings = [];
  const read = (text, fileName, kind, lineOffset, outerSymbol) => {
    const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
    const visit = (node) => {
      for (const rule of PATTERN_RULES) {
        if (rule.isSite(node)) {
          findings.push({
            rule_id: rule.rule_id,
            source_path: sourcePath,
            line_number: lineOffset + sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            symbol_name: symbolNameOf(node) ?? outerSymbol,
            site_text: siteTextOf(node),
          });
        }
      }
      const browserCode = browserCodeIn(node);
      if (browserCode !== null) read(browserCode, "page-script.js", ts.ScriptKind.JS, lineOffset + sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line, symbolNameOf(node) ?? outerSymbol);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  };
  read(sourceText, sourcePath, sourcePath.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS, 0, "top level");
  return findings;
}
