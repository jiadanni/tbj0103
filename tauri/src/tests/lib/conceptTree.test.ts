import { describe, expect, it } from "vitest";
import { buildForest, pruneCollapsedSections } from "../../lib/conceptTree";
import type { ConceptLink, ConceptNode } from "../../lib/api";

function makeNode(id: string, name: string, hierarchy_level: string): ConceptNode {
  return {
    id,
    workspace_id: "ws-1",
    name,
    concept_description: "",
    concept_type: "topic",
    tags: [],
    aliases: [],
    x_position: 0,
    y_position: 0,
    review_count: 0,
    hierarchy_level,
    created_at: "",
    updated_at: "",
  };
}

function makePartOf(id: string, child: string, parent: string): ConceptLink {
  return {
    id,
    source_id: child,
    target_id: parent,
    link_type: "part_of",
    strength: 1,
    context: "",
    created_at: "",
  };
}

describe("buildForest", () => {
  it("drops the legacy uncategorized scaffold branch", () => {
    const nodes = [
      {
        id: "chapter-1",
        workspace_id: "ws-1",
        name: "Uncategorized",
        concept_description: "",
        concept_type: "topic",
        tags: [],
        aliases: [],
        x_position: 0,
        y_position: 0,
        review_count: 0,
        hierarchy_level: "chapter",
        created_at: "",
        updated_at: "",
      },
      {
        id: "chapter-2",
        workspace_id: "ws-1",
        name: "Uncategorized",
        concept_description: "",
        concept_type: "topic",
        tags: [],
        aliases: [],
        x_position: 0,
        y_position: 0,
        review_count: 0,
        hierarchy_level: "chapter",
        created_at: "",
        updated_at: "",
      },
      {
        id: "section-1",
        workspace_id: "ws-1",
        name: "Topics",
        concept_description: "",
        concept_type: "topic",
        tags: [],
        aliases: [],
        x_position: 0,
        y_position: 0,
        review_count: 0,
        hierarchy_level: "section",
        created_at: "",
        updated_at: "",
      },
      {
        id: "section-2",
        workspace_id: "ws-1",
        name: "Topics",
        concept_description: "",
        concept_type: "topic",
        tags: [],
        aliases: [],
        x_position: 0,
        y_position: 0,
        review_count: 0,
        hierarchy_level: "section",
        created_at: "",
        updated_at: "",
      },
      {
        id: "concept-1",
        workspace_id: "ws-1",
        name: "decorators",
        concept_description: "",
        concept_type: "topic",
        tags: [],
        aliases: [],
        x_position: 0,
        y_position: 0,
        review_count: 0,
        hierarchy_level: "concept",
        created_at: "",
        updated_at: "",
      },
      {
        id: "concept-2",
        workspace_id: "ws-1",
        name: "lambda",
        concept_description: "",
        concept_type: "topic",
        tags: [],
        aliases: [],
        x_position: 0,
        y_position: 0,
        review_count: 0,
        hierarchy_level: "concept",
        created_at: "",
        updated_at: "",
      },
    ] satisfies ConceptNode[];

    const links = [
      {
        id: "link-1",
        source_id: "section-1",
        target_id: "chapter-1",
        link_type: "part_of",
        strength: 1,
        context: "",
        created_at: "",
      },
      {
        id: "link-2",
        source_id: "section-2",
        target_id: "chapter-2",
        link_type: "part_of",
        strength: 1,
        context: "",
        created_at: "",
      },
      {
        id: "link-3",
        source_id: "concept-1",
        target_id: "section-1",
        link_type: "part_of",
        strength: 1,
        context: "",
        created_at: "",
      },
      {
        id: "link-4",
        source_id: "concept-2",
        target_id: "section-2",
        link_type: "part_of",
        strength: 1,
        context: "",
        created_at: "",
      },
    ] satisfies ConceptLink[];

    const forest = buildForest(nodes, links);

    // Uncategorized is the only content available, so it must still be
    // shown (merged into one branch) rather than leaving the map blank.
    expect(forest.children).toHaveLength(1);
    expect(forest.children?.[0].name.toLowerCase()).toBe("uncategorized");
  });

  it("hides the uncategorized scaffold when a real chapter is also present", () => {
    const nodes = [
      {
        id: "chapter-uncat",
        workspace_id: "ws-1",
        name: "Uncategorized",
        concept_description: "",
        concept_type: "topic",
        tags: [],
        aliases: [],
        x_position: 0,
        y_position: 0,
        review_count: 0,
        hierarchy_level: "chapter",
        created_at: "",
        updated_at: "",
      },
      {
        id: "chapter-real",
        workspace_id: "ws-1",
        name: "Closures",
        concept_description: "",
        concept_type: "topic",
        tags: [],
        aliases: [],
        x_position: 0,
        y_position: 0,
        review_count: 0,
        hierarchy_level: "chapter",
        created_at: "",
        updated_at: "",
      },
    ] satisfies ConceptNode[];

    const forest = buildForest(nodes, []);

    expect(forest.children).toHaveLength(1);
    expect(forest.children?.[0].name).toBe("Closures");
  });

  it("folds a same-named single section into its chapter", () => {
    // Shape produced by synthesize_topic_groups: chapter and section share
    // the group name, concepts hang off the section. Rendering both boxes
    // showed the topic name twice, stacked.
    const nodes = [
      makeNode("chapter-ai", "AI & Machine Learning", "chapter"),
      makeNode("section-ai", "AI & Machine Learning", "section"),
      makeNode("concept-llm", "large language models", "concept"),
    ];
    const links = [
      makePartOf("l1", "section-ai", "chapter-ai"),
      makePartOf("l2", "concept-llm", "section-ai"),
    ];

    const forest = buildForest(nodes, links);

    expect(forest.children).toHaveLength(1);
    const chapter = forest.children?.[0];
    expect(chapter?.id).toBe("chapter-ai");
    expect(chapter?.collapseId).toBe("section-ai");
    expect(chapter?.children?.map((c) => c.id)).toEqual(["concept-llm"]);
  });

  it("keeps a section that has a different name from its chapter", () => {
    const nodes = [
      makeNode("chapter-uncat", "Uncategorized", "chapter"),
      makeNode("section-topics", "Topics", "section"),
      makeNode("concept-1", "decorators", "concept"),
    ];
    const links = [
      makePartOf("l1", "section-topics", "chapter-uncat"),
      makePartOf("l2", "concept-1", "section-topics"),
    ];

    const forest = buildForest(nodes, links);

    const chapter = forest.children?.[0];
    expect(chapter?.collapseId).toBeUndefined();
    expect(chapter?.children?.map((c) => c.id)).toEqual(["section-topics"]);
  });
});

describe("pruneCollapsedSections", () => {
  it("collapses and expands a merged chapter via its collapseId", () => {
    const nodes = [
      makeNode("chapter-ai", "AI & Machine Learning", "chapter"),
      makeNode("section-ai", "AI & Machine Learning", "section"),
      makeNode("concept-llm", "large language models", "concept"),
    ];
    const links = [
      makePartOf("l1", "section-ai", "chapter-ai"),
      makePartOf("l2", "concept-llm", "section-ai"),
    ];
    const forest = buildForest(nodes, links);

    const collapsed = pruneCollapsedSections(forest, new Set());
    expect(collapsed.children?.[0].children).toHaveLength(0);
    expect(collapsed.children?.[0].hiddenChildCount).toBe(1);

    const expanded = pruneCollapsedSections(forest, new Set(["section-ai"]));
    expect(expanded.children?.[0].children?.map((c) => c.id)).toEqual(["concept-llm"]);
  });
});
