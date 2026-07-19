import { describe, expect, it } from "vitest";
import { buildForest } from "../../lib/conceptTree";
import type { ConceptLink, ConceptNode } from "../../lib/api";

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
});
