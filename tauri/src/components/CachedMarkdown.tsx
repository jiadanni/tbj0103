import React, { useMemo } from "react";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import type ReactMarkdown from "react-markdown";
import { parseMarkdownToHast } from "../lib/markdownAst";

type MarkdownComponentsMap = React.ComponentProps<typeof ReactMarkdown>["components"];

/**
 * Drop-in replacement for
 * `<ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>`.
 *
 * Splits react-markdown's work in two: the expensive, content-only
 * parse/remark/rehype pass (cached across Virtuoso remounts by
 * parseMarkdownToHast) and the cheap, components-dependent element
 * construction below, which still runs on every mount.
 */
function CachedMarkdown({ content, components }: { content: string; components: MarkdownComponentsMap }) {
  const tree = useMemo(() => parseMarkdownToHast(content), [content]);

  return useMemo(
    () =>
      toJsxRuntime(tree, {
        Fragment,
        // @ts-expect-error: React components may return numbers, which the
        // hast-util-to-jsx-runtime types disallow. react-markdown suppresses
        // this exact mismatch the same way at its own toJsxRuntime call.
        components: components ?? undefined,
        ignoreInvalidStyle: true,
        jsx,
        jsxs,
        passKeys: true,
        passNode: true,
      }),
    [tree, components],
  ) as React.ReactElement;
}

export default React.memo(CachedMarkdown);
