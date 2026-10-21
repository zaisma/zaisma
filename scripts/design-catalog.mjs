#!/usr/bin/env node
// Writes docs/DESIGN.md's component catalog from the gallery's registry (apps/site/src/components), so it lists every component
// with the call that makes it and its options, and can't go stale.
//   node scripts/design-catalog.mjs     rewrites the catalog between the markers in docs/DESIGN.md
// A component's name, group and summary come from its registration; the call and its options are read from the source of its
// markup function. test/node/design-catalog.test.ts checks the written catalog is current.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { COMPONENTS_DIRECTORY, ROOT, loadComponentsModule } from "./components-module.mjs";

export const DESIGN_PATH = join(ROOT, "docs/DESIGN.md");
export const CATALOG_START = "<!-- catalog:start (written by npm run design:catalog from the component registry; don't edit) -->";
export const CATALOG_END = "<!-- catalog:end -->";

function parseSources(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => ({ name, file: ts.createSourceFile(name, readFileSync(join(directory, name), "utf8"), ts.ScriptTarget.Latest, true) }));
}

const isExported = (node) => node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;

/** Every function, interface and object type the components' sources declare, by name. */
function declarationsIn(sources) {
  const functions = new Map(), interfaces = new Map(), registrations = new Map();
  for (const { name, file } of sources) {
    const visit = (node) => {
      if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, { file: name, parameters: node.parameters });
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isArrowFunction(node.initializer)) functions.set(node.name.text, { file: name, parameters: node.initializer.parameters });
      if (ts.isInterfaceDeclaration(node)) interfaces.set(node.name.text, node);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "component" && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
        const properties = new Map(node.arguments[0].properties.filter(ts.isPropertyAssignment).map((property) => [property.name.getText(), property.initializer]));
        const slug = properties.get("slug");
        if (slug && ts.isStringLiteral(slug)) registrations.set(slug.text, { file: name, render: properties.get("render") });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return { functions, interfaces, registrations };
}

/** The properties of an interface and the ones it extends: name, whether it is optional and its written type. */
function propertiesOf(interfaceNode, interfaces, seen = new Set()) {
  if (seen.has(interfaceNode)) return [];
  seen.add(interfaceNode);
  const inherited = (interfaceNode.heritageClauses ?? []).flatMap((clause) => clause.types.flatMap((each) => (interfaces.has(each.expression.getText()) ? propertiesOf(interfaces.get(each.expression.getText()), interfaces, seen) : [])));
  const own = interfaceNode.members.filter(ts.isPropertySignature).map((member) => ({ name: member.name.getText(), isOptional: Boolean(member.questionToken), written: member.type ? member.type.getText().replace(/\s+/g, " ") : "unknown" }));
  return [...inherited, ...own];
}

function callOf(component, { functions, interfaces, registrations }) {
  const registration = registrations.get(component.slug);
  const render = registration?.render;
  if (!render) return null;
  let functionName = ts.isIdentifier(render) ? render.text : null;
  // An arrow wrapping a call (render: (words, tone) => tag(words, tone)) stands for the function it calls.
  if (!functionName && ts.isArrowFunction(render) && ts.isCallExpression(render.body) && ts.isIdentifier(render.body.expression)) functionName = render.body.expression.text;
  const declaration = functionName && functions.get(functionName);
  if (!declaration) return null;
  const parameters = declaration.parameters.map((parameter) => {
    const written = parameter.type ? parameter.type.getText().replace(/\s+/g, " ") : "unknown";
    const interfaceNode = interfaces.get(written);
    const properties = interfaceNode ? propertiesOf(interfaceNode, interfaces) : [];
    const inlineMembers = parameter.type && ts.isTypeLiteralNode(parameter.type) ? parameter.type.members.filter(ts.isPropertySignature).map((member) => ({ name: member.name.getText(), isOptional: Boolean(member.questionToken), written: member.type ? member.type.getText().replace(/\s+/g, " ") : "unknown" })) : [];
    return { name: parameter.name.getText(), isOptional: Boolean(parameter.questionToken || parameter.initializer), written: interfaceNode ? written : inlineMembers.length ? "{ … }" : written, options: properties.length ? properties : inlineMembers };
  });
  return { functionName, file: declaration.file, parameters };
}

/** The catalog, as markdown, from the registered components (name, slug, group, summary) and the components' sources. */
export function catalogMarkdown(components, groups, directory = COMPONENTS_DIRECTORY) {
  const declarations = declarationsIn(parseSources(directory));
  const lines = [];
  for (const { group, name: groupName } of groups) {
    const inGroup = components.filter((each) => each.group === group);
    if (!inGroup.length) continue;
    lines.push(`### ${groupName}`, "");
    for (const each of inGroup) {
      const call = callOf(each, declarations);
      const signature = call ? ` (\`${call.functionName}(${call.parameters.map((parameter) => `${parameter.name}${parameter.isOptional ? "?" : ""}: ${parameter.written}`).join(", ")})\`, \`${call.file}\`)` : "";
      lines.push(`- **${each.name}**${signature}: ${each.summary}`);
      for (const parameter of call?.parameters ?? []) {
        if (!parameter.options.length) continue;
        lines.push(`  - \`${parameter.name}\`: ${parameter.options.map((option) => `\`${option.name}${option.isOptional ? "?" : ""}: ${option.written}\``).join(", ")}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** docs/DESIGN.md with the catalog between its markers replaced. */
export function withCatalog(designText, catalog) {
  const start = designText.indexOf("<!-- catalog:start"), end = designText.indexOf(CATALOG_END);
  if (start < 0 || end < start) throw new Error("docs/DESIGN.md has no catalog markers");
  return `${designText.slice(0, start)}${CATALOG_START}\n\n${catalog}\n\n${designText.slice(end)}`;
}

if (process.argv[1] === import.meta.filename) {
  const components = await loadComponentsModule();
  const catalog = catalogMarkdown(components.COMPONENTS(), components.COMPONENT_GROUPS);
  writeFileSync(DESIGN_PATH, withCatalog(readFileSync(DESIGN_PATH, "utf8"), catalog));
  console.log(`Wrote the catalog (${catalog.split("\n").length} lines) into ${DESIGN_PATH}`);
}
