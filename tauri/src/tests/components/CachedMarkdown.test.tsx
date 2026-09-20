import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Spy on the parse seam. The previous attempt at this optimisation cached a
// React *element* and asserted on a react-markdown spy; that test failed
// because reusing an element object still re-invokes the component function
// on mount. Caching the parsed HAST is what actually removes the work.
//
// A returned tree that is reference-identical to the previous one is proof
// the whole remark/rehype/KaTeX pipeline was skipped: the pipeline always
// constructs a fresh tree, so an identical reference can only come from the
// cache.
const parseSpy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/markdownAst", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/markdownAst")>();
  return {
    ...actual,
    parseMarkdownToHast: (content: string) => {
      const tree = actual.parseMarkdownToHast(content);
      parseSpy(content, tree);
      return tree;
    },
  };
});

const CachedMarkdown = (await import("@/components/CachedMarkdown")).default;

function treesReturned() {
  return parseSpy.mock.calls.map((call) => call[1]);
}

describe("CachedMarkdown", () => {
  beforeEach(() => {
    parseSpy.mockClear();
  });

  it("renders markdown content", () => {
    render(<CachedMarkdown content="Hello **world**" components={{}} />);

    expect(screen.getByText("world")).toBeInTheDocument();
  });

  it("renders KaTeX math markup", () => {
    const { container } = render(<CachedMarkdown content="$E = mc^2$" components={{}} />);

    expect(container.querySelector(".katex")).not.toBeNull();
  });

  it("reuses the cached tree across a Virtuoso-style unmount and remount", () => {
    // Unique content so this test owns its cache entry regardless of order.
    const content = "Remount case: $\\gamma_{remount} + \\delta^{2}$ and $\\zeta$.";
    const components = {};

    const first = render(<CachedMarkdown content={content} components={components} />);

    // Virtuoso unmounts off-screen bubbles and remounts them when they
    // re-enter the overscan buffer during scroll. The remount must hit the
    // module-level tree cache instead of re-running remark/rehype/KaTeX —
    // this is the scroll-hitching cost being removed.
    first.unmount();
    const second = render(<CachedMarkdown content={content} components={components} />);

    const trees = treesReturned();
    expect(trees).toHaveLength(2);
    // Same tree object on the remount => the pipeline did not run again.
    expect(trees[1]).toBe(trees[0]);
    expect(second.container.querySelector(".katex")).not.toBeNull();
  });

  it("builds a distinct tree for content it has not seen before", () => {
    render(<CachedMarkdown content="Fresh content A: $\\lambda_{a}$" components={{}} />);
    render(<CachedMarkdown content="Fresh content B: $\\lambda_{b}$" components={{}} />);

    const trees = treesReturned();
    expect(trees).toHaveLength(2);
    expect(trees[1]).not.toBe(trees[0]);
  });

  it("keeps rendering correctly when only the components map changes", () => {
    const content = "Components case: **bold** and $\\mu$";

    const { container: a } = render(<CachedMarkdown content={content} components={{}} />);
    const { container: b } = render(
      <CachedMarkdown content={content} components={{ strong: ({ children }) => <em>{children}</em> }} />,
    );

    // Tree is shared, but the components map is applied per render.
    expect(a.querySelector("strong")).not.toBeNull();
    expect(b.querySelector("em")).not.toBeNull();
    expect(b.querySelector("strong")).toBeNull();
  });

  it("passes inline: true for inline code and inline: false for fenced code blocks", () => {
    const codeProps: Array<{ inline?: boolean; text?: string }> = [];
    const content = "The dollar sign (`$`) in:\n\n```bash\necho $VAR\n```";

    render(
      <CachedMarkdown
        content={content}
        components={{
          code: ({ inline, children }: { inline?: boolean; children?: React.ReactNode }) => {
            codeProps.push({ inline, text: String(children).trim() });
            return <code>{children}</code>;
          },
        }}
      />,
    );

    expect(codeProps).toHaveLength(2);
    expect(codeProps[0]).toEqual({ inline: true, text: "$" });
    expect(codeProps[1]).toEqual({ inline: false, text: "echo $VAR" });
  });
});
