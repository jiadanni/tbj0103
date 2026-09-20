import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { VFile } from "vfile";
import { visit } from "unist-util-visit";
import { urlAttributes } from "html-url-attributes";
import type { Element, Root } from "hast";

// Mirrors react-markdown v9's internal pipeline so a parsed message can be
// cached as plain data.
//
// react-markdown re-runs parse -> remark -> rehype (including rehype-katex,
// which is expensive per formula) on every mount. Virtuoso remounts
// off-screen bubbles as they re-enter its overscan buffer while scrolling,
// so per-instance memoisation cannot help: a fresh mount gets a fresh memo
// cache. Caching the resulting HAST at module scope turns those remounts
// into a tree walk instead of a full re-parse.
//
// Only the tree is cached. The `components` map is applied later, at
// toJsxRuntime time, so styling-setting changes need no cache invalidation.

const processor = unified()
  .use(remarkParse)
  .use([remarkGfm, remarkMath])
  // `allowDangerousHtml` matches react-markdown: raw HTML is kept as `raw`
  // nodes here and then dropped by sanitizeTree below (equivalent to its
  // `skipHtml` prop). It is never handed to a raw-HTML renderer.
  .use(remarkRehype, { allowDangerousHtml: true })
  .use([rehypeKatex]);

const safeProtocol = /^(https?|ircs?|mailto|xmpp)$/i;

// Copied verbatim from react-markdown's defaultUrlTransform so cached trees
// get byte-identical URL sanitisation (drops javascript:, vbscript:, data:).
function defaultUrlTransform(value: string): string {
  const colon = value.indexOf(":");
  const questionMark = value.indexOf("?");
  const numberSign = value.indexOf("#");
  const slash = value.indexOf("/");

  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    safeProtocol.test(value.slice(0, colon))
  ) {
    return value;
  }

  return "";
}

// Strips raw HTML nodes and rewrites unsafe URL attributes in place, matching
// react-markdown's `skipHtml` + `urlTransform` behaviour.
//
// This pass is idempotent — raw nodes are removed outright, and a URL already
// rewritten to "" or a safe value maps to itself — so it is safe to re-run on
// a cached tree rather than deep-cloning it on every read.
export function sanitizeTree(tree: Root): Root {
  visit(tree, function (node, index, parent) {
    if (node.type === "raw" && parent && typeof index === "number") {
      parent.children.splice(index, 1);
      return index;
    }

    if (node.type === "element") {
      const element = node as Element;
      if (element.tagName === "code") {
        const isBlock = Boolean(parent && parent.type === "element" && parent.tagName === "pre");
        element.properties = element.properties || {};
        element.properties.inline = !isBlock;
      }
      for (const key in urlAttributes) {
        // `Object.prototype.hasOwnProperty.call` rather than `Object.hasOwn`
        // (ES2022) or a bare `key in`, which would also match prototype keys.
        if (Object.prototype.hasOwnProperty.call(element.properties, key)) {
          const test = urlAttributes[key];
          if (test === null || test.includes(element.tagName)) {
            element.properties[key] = defaultUrlTransform(String(element.properties[key] || ""));
          }
        }
      }
    }
  });

  return tree;
}

const treeCache = new Map<string, Root>();
const TREE_CACHE_MAX_ENTRIES = 200;

function parseMarkdownUncached(content: string): Root {
  const file = new VFile();
  file.value = content;
  return sanitizeTree(processor.runSync(processor.parse(file), file));
}

export function parseMarkdownToHast(content: string): Root {
  const cached = treeCache.get(content);
  if (cached) {
    // Re-run the idempotent sanitise pass: rehype-katex output is stable, and
    // re-sanitising guards against any in-place mutation by a consumer.
    return sanitizeTree(cached);
  }

  const tree = parseMarkdownUncached(content);

  if (treeCache.size >= TREE_CACHE_MAX_ENTRIES) {
    const oldestKey = treeCache.keys().next().value;
    if (oldestKey !== undefined) { treeCache.delete(oldestKey); }
  }
  treeCache.set(content, tree);

  return tree;
}
