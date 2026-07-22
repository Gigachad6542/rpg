import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

import ts from "typescript";

const workspaceRoot = process.cwd();
const testsRoot = join(workspaceRoot, "tests");
const testFilePattern = /\.(?:test|spec)\.tsx?$/;
const testApis = new Set(["it", "test"]);
const suiteApis = new Set(["describe"]);
const disabledModifiers = new Set(["only", "skip", "todo"]);
const disabledAliases = new Set(["fit", "fdescribe", "xit", "xtest", "xdescribe"]);

function listTestFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listTestFiles(path) : [path];
    })
    .filter((path) => testFilePattern.test(path))
    .sort();
}

function rootIdentifier(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return rootIdentifier(expression.expression);
  }
  if (ts.isCallExpression(expression)) {
    return rootIdentifier(expression.expression);
  }
  return undefined;
}

function modifierNames(expression, result = []) {
  if (ts.isPropertyAccessExpression(expression)) {
    modifierNames(expression.expression, result);
    result.push(expression.name.text);
  } else if (ts.isElementAccessExpression(expression)) {
    modifierNames(expression.expression, result);
    if (expression.argumentExpression && ts.isStringLiteral(expression.argumentExpression)) {
      result.push(expression.argumentExpression.text);
    }
  } else if (ts.isCallExpression(expression)) {
    modifierNames(expression.expression, result);
  }
  return result;
}

function callbackArgument(call) {
  for (let index = call.arguments.length - 1; index >= 0; index -= 1) {
    const argument = call.arguments[index];
    if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
      return argument;
    }
  }
  return undefined;
}

function declarationTitle(call, sourceFile) {
  const title = call.arguments.find(
    (argument) => ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument),
  );
  return title ? title.text.trim() : `<dynamic title at line ${sourceFile.getLineAndCharacterOfPosition(call.getStart()).line + 1}>`;
}

function hasAssertionContract(callback, sourceFile) {
  let found = false;
  const visit = (node) => {
    if (found) {
      return;
    }
    if (ts.isCallExpression(node)) {
      const root = rootIdentifier(node.expression);
      if (root === "expect" || root === "expectTypeOf" || root === "assert" || root?.startsWith("expect")) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(callback.body);

  return found || callback.getFullText(sourceFile).includes("test-contract: no-throw");
}

const testFiles = listTestFiles(testsRoot);
const declarations = [];
const violations = [];
const conditionals = [];

for (const filePath of testFiles) {
  const sourceText = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    extname(filePath) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const displayPath = relative(workspaceRoot, filePath).replaceAll("\\", "/");

  const inspectDisabledCalls = (node) => {
    if (ts.isCallExpression(node)) {
      const root = rootIdentifier(node.expression);
      const modifiers = modifierNames(node.expression);
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (disabledAliases.has(root) || modifiers.some((modifier) => disabledModifiers.has(modifier))) {
        violations.push(`${displayPath}:${line} uses a disabled or focused test API.`);
      }
    }
    ts.forEachChild(node, inspectDisabledCalls);
  };
  inspectDisabledCalls(sourceFile);

  const visitDeclarations = (node, suites = []) => {
    if (ts.isCallExpression(node)) {
      const root = rootIdentifier(node.expression);
      const callback = callbackArgument(node);
      if (callback && suiteApis.has(root)) {
        const title = declarationTitle(node, sourceFile);
        visitDeclarations(callback.body, [...suites, title]);
        return;
      }
      if (callback && testApis.has(root)) {
        const title = declarationTitle(node, sourceFile);
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const qualifiedTitle = [...suites, title].join(" > ");
        const modifiers = modifierNames(node.expression);
        declarations.push({ displayPath, line, qualifiedTitle });
        if (modifiers.includes("runIf") || modifiers.includes("skipIf")) {
          conditionals.push(`${displayPath}:${line} ${qualifiedTitle}`);
        }
        if (!hasAssertionContract(callback, sourceFile)) {
          violations.push(
            `${displayPath}:${line} has no assertion contract; add an assertion or a "test-contract: no-throw" rationale.`,
          );
        }
        return;
      }
    }
    ts.forEachChild(node, (child) => visitDeclarations(child, suites));
  };
  visitDeclarations(sourceFile);
}

const declarationKeys = new Map();
for (const declaration of declarations) {
  const key = `${declaration.displayPath}\0${declaration.qualifiedTitle}`;
  const previous = declarationKeys.get(key);
  if (previous) {
    violations.push(
      `${declaration.displayPath}:${declaration.line} duplicates the test title declared on line ${previous.line}: ${declaration.qualifiedTitle}`,
    );
  } else {
    declarationKeys.set(key, declaration);
  }
}

const areaCounts = new Map();
for (const declaration of declarations) {
  const area = declaration.displayPath.split("/")[1] ?? "root";
  areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
}

console.log(`Test contract audit: ${testFiles.length} files, ${declarations.length} declarations.`);
console.log(
  `Areas: ${[...areaCounts.entries()].map(([area, count]) => `${area}=${count}`).join(", ")}.`,
);
console.log(`Conditional declarations reviewed: ${conditionals.length}.`);

if (violations.length > 0) {
  console.error(`Test contract audit failed with ${violations.length} violation(s):`);
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log("No focused, disabled, duplicate, or assertion-free test contracts found.");
}
