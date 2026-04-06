# Knowledge Graph System

This document describes Aetherium's Obsidian-inspired knowledge graph and bidirectional linking system that automatically connects concepts across your projects.

## Overview

The Knowledge Graph transforms Aetherium from isolated conversations into an interconnected web of knowledge, where:
- **Concepts emerge automatically** from chats and documents
- **Links form bidirectionally** between related ideas
- **Backlinks reveal context** showing where ideas are mentioned
- **Graph visualization** displays the structure of your knowledge

## Core Philosophy

```
Traditional AI Chat              Aetherium Knowledge Graph
─────────────────               ──────────────────────────
Chat 1: What are closures?
Chat 2: Tell me about async     [[Closures]] ←──→ [[Functions]]
Chat 3: Explain functions               ↓             ↓
                                   [[Async/Await]] ←→ [[Concurrency]]
Isolated                                ↓             ↓
Repetitive                         [[Swift]] ←────────┘
No connections
                                Connected
                                Discoverable
                                Learning paths emerge
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Knowledge Graph Layer                   │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ ConceptNode   │  │ ConceptLink  │  │   Mention    │ │
│  │               │  │              │  │   Tracking   │ │
│  │ • Name        │  │ • Source     │  │              │ │
│  │ • Type        │  │ • Target     │  │ • Context    │ │
│  │ • Description │  │ • Type       │  │ • Location   │ │
│  │ • Tags        │  │ • Strength   │  │ • Source     │ │
│  └───────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│          │                  │                  │         │
│          └──────────────────┴──────────────────┘         │
│                             │                            │
│                  ┌──────────▼──────────┐                 │
│                  │  Linking Engine     │                 │
│                  │                     │                 │
│                  │  • Parse [[links]]  │                 │
│                  │  • Auto-detect      │                 │
│                  │  • Suggest          │                 │
│                  │  • Create           │                 │
│                  └──────────┬──────────┘                 │
│                             │                            │
│                  ┌──────────▼──────────┐                 │
│                  │ Concept Extractor   │                 │
│                  │                     │                 │
│                  │  • From chats       │                 │
│                  │  • From documents   │                 │
│                  │  • From projects    │                 │
│                  │  • Auto-linking     │                 │
│                  └─────────────────────┘                 │
└─────────────────────────────────────────────────────────┘
```

## Data Models

### ConceptNode

```swift
@Model
final class ConceptNode {
    var id: UUID
    var name: String                    // "Swift Closures"
    var conceptDescription: String?     // What it is
    var nodeType: ConceptNodeType       // topic/technology/person/etc
    var aliases: [String]               // Alternative names
    var tags: [String]                  // Categorization

    // Graph relationships
    var outgoingLinks: [ConceptLink]    // What this links to
    var incomingLinks: [ConceptLink]    // What links to this (backlinks)
    var mentions: [ConceptMention]      // Where it's mentioned

    // Metadata
    var referenceCount: Int             // Popularity
    var lastReferencedAt: Date          // Recency
    var relatedGoalIDs: [String]        // Learning goals
}
```

**Concept Types:**
- `topic` - General concept or subject
- `person` - People mentioned
- `technology` - Languages, frameworks, tools
- `definition` - Technical definitions
- `question` - Unresolved questions
- `insight` - Key realizations
- `resource` - External resources
- `custom` - User-defined types

### ConceptLink

```swift
@Model
final class ConceptLink {
    var id: UUID
    var source: ConceptNode              // From
    var target: ConceptNode              // To
    var linkType: ConceptLinkType        // Relationship type
    var strength: Double                 // 0.0 to 1.0
    var context: String?                 // Where link was created
}
```

**Link Types:**
- `related` - General relationship
- `prerequisite` - A requires understanding B first
- `partOf` - A is a component of B
- `similarTo` - A is similar to B
- `contradicts` - A contradicts B
- `exemplifies` - A is an example of B
- `custom` - User-defined relationships

### ConceptMention

```swift
@Model
final class ConceptMention {
    var id: UUID
    var concept: ConceptNode             // What was mentioned
    var mentionContext: String           // Surrounding text
    var position: Int                    // Where in content
    var sourceType: MentionSourceType    // message/note/document
    var sourceID: String                 // UUID of source
}
```

**Mention Sources:**
- `message` - Chat messages
- `note` - Project notes
- `documentChunk` - Document text
- `learningGoal` - Learning objectives

## Linking Syntax

### Explicit Links: `[[concept]]`

```
User types:
"Closures in Swift use [[capture semantics]] to access variables"

Aetherium:
1. Detects [[capture semantics]]
2. Creates or finds ConceptNode("capture semantics")
3. Renders as clickable link
4. Records mention with context
5. Updates reference count
```

### Auto-Detection

```swift
// Without [[]] syntax, still detected:
"Swift closures capture values from context"

// If "closures" exists as concept:
→ Suggests auto-linking
→ Shows in related concepts panel
→ Can auto-convert to [[closures]]
```

## Concept Extraction

### From Chat Sessions

```swift
let concepts = try await conceptExtractor.extractFromChat(chatSession)

// AI analyzes conversation:
// "What are closures in Swift?"
// "They're self-contained blocks..."

// Extracts:
// • Closures (topic)
// • Swift (technology)
// • Functions (topic)
// • Capture semantics (definition)
```

### From Documents

```swift
let concepts = try await conceptExtractor.extractFromDocument(pdf)

// AI reads document sample
// Identifies key concepts, definitions, people, technologies
// Creates nodes with descriptions
// Suggests relationships
```

### From Entire Project

```swift
let concepts = try await conceptExtractor.extractFromProject(project)

// Processes:
// • All chat sessions
// • All documents
// • All notes

// Result:
// • Comprehensive concept map
// • Auto-linked relationships
// • Deduplicated and merged
```

## Bidirectional Linking

Every link is automatically bidirectional:

```
Create: [[Closures]] → [[Functions]]

Results in:
1. Forward link: Closures.outgoingLinks → Functions
2. Backlink: Functions.incomingLinks → Closures

Both are queryable and navigable
```

## Backlinks

### What Are Backlinks?

Backlinks show all content that references a concept:

```
Concept: "Closures"

Backlinks (3):
├─ Chat Message (2 days ago)
│  "I'm learning about closures in Swift..."
│
├─ Note: Study Guide (1 week ago)
│  "...closures capture values from context..."
│
└─ Document: Swift Guide.pdf (p. 42)
   "Closures are self-contained blocks..."
```

### Use Cases

1. **Find all discussions** about a topic
2. **Discover connections** you didn't know existed
3. **Track learning progress** on a concept
4. **See concept in context** across sources

## Graph Visualization

### Force-Directed Layout

```
     Closures ────── Functions
        │               │
        │               │
    Capture ──── Swift ──── Async
                  │
                  │
              Concurrency
```

**Features:**
- Node size = reference count
- Link thickness = strength
- Color = concept type
- Click to select and explore
- Hover for quick info

### Circular Layout

Arranges concepts in a circle, useful for:
- Seeing all concepts at once
- Comparing connection density
- Finding central/peripheral concepts

### Hierarchical Layout

Top-down tree structure showing:
- Prerequisites at top
- Dependent concepts below
- Learning progression paths

## Graph Statistics

```swift
struct GraphStatistics {
    totalNodes: Int              // Number of concepts
    totalLinks: Int              // Number of connections
    averageConnections: Double   // Connectivity
    mostConnectedConcepts: [...] // Hub nodes
    recentlyActiveConcepts: [...] // Recent activity
    orphanedConcepts: [...]      // Unconnected nodes
}
```

**Use Cases:**
- Identify knowledge hubs
- Find isolated concepts to connect
- Track graph growth over time
- Discover popular topics

## Advanced Queries

### Find Concepts Within N Hops

```swift
let related = concept.conceptsWithinHops(2)

// Example:
// Closures → (1 hop) → Functions, Capture
//         → (2 hops) → Swift, Variables, Scope
```

### Shortest Path Between Concepts

```swift
let path = concept1.pathTo(concept2)

// Example:
// "Closures" → "Functions" → "Swift" → "Concurrency"
// Shows conceptual learning path
```

### Related by Tags

```swift
let related = concept.relatedByTags(in: allNodes)

// Concepts sharing tags like:
// #swift #functional-programming #advanced
```

## Integration with Chat

### Inline Concept Suggestions

```
User types: "Tell me about clo..."

Suggestions appear:
┌─────────────────────────┐
│ 📘 Closures (5 refs)   │
│ ⚙️ Closure Capture      │
│ 🎯 Closure Syntax       │
└─────────────────────────┘

Press Tab or click to insert [[Closures]]
```

### Related Concepts Panel

```
Chat View
┌──────────────────────────────────────┐
│ User: What are closures?             │
│                                       │
│ AI: Closures are...                  │
│                                       │
├──────────────────────────────────────┤
│ Related Concepts:                    │
│ 📘 Functions (Connected)             │
│ ⚙️ Capture Semantics (Mentioned)     │
│ 🎯 Swift Language (Parent)           │
└──────────────────────────────────────┘
```

## Auto-Linking Workflow

```
1. User writes in note or chat
   ↓
2. LinkingEngine detects [[concept]] syntax
   ↓
3. Creates or retrieves ConceptNode
   ↓
4. Records ConceptMention with context
   ↓
5. Updates reference count and timestamp
   ↓
6. Renders as clickable link in UI
   ↓
7. Available in graph visualization
   ↓
8. Shows in backlinks panel
```

## Concept Extraction Workflow

```
1. User clicks "Extract Concepts" on project
   ↓
2. ConceptExtractor batches chats + documents
   ↓
3. For each source:
   a. Send to Ollama with extraction prompt
   b. Parse AI response
   c. Create ConceptNodes
   ↓
4. Deduplicate similar concepts
   ↓
5. Auto-link related concepts
   ↓
6. Insert into knowledge graph
   ↓
7. Update visualization
```

## UI Components

### KnowledgeGraphView

Main visualization interface:
- **Graph Canvas**: Interactive node/link display
- **Search & Filter**: Find specific concepts
- **Type Filter**: Show only certain types
- **Layout Selector**: Force/Circular/Hierarchical
- **Sidebar**: Selected concept details
- **Statistics**: Graph metrics

### BacklinksView

Shows where concept is referenced:
- **Source List**: All mentions with context
- **Preview**: Surrounding text
- **Jump to Source**: Navigate to original
- **Statistics**: Total mentions, recent activity

### InlineBacklinksPanel

Embedded in notes/chats:
- **Auto-Detection**: As you type
- **Suggestions**: Related concepts
- **Quick Info**: Hover for details
- **Insert Link**: Click to add [[concept]]

## Example Use Case

### Learning Swift Concurrency

```
Day 1:
User: "What is async/await?"
→ Creates concepts: [[Async/Await]], [[Concurrency]]
→ AI mentions [[Tasks]], [[Continuations]]
→ Auto-links created

Day 3:
User uploads: "WWDC Swift Concurrency.pdf"
→ Extracts: [[Actor]], [[Sendable]], [[MainActor]]
→ Links to existing [[Concurrency]] concept

Day 7:
User asks: "How do actors prevent data races?"
→ Concept [[Data Races]] created
→ Linked to [[Actor]] and [[Concurrency]]

Result:
                Concurrency
                     │
        ┌────────────┼────────────┐
        │            │            │
   Async/Await    Actor      Sendable
        │            │            │
   Continuations  MainActor  Data Races
        │            │
      Tasks    ─────┘

→ Visual learning map
→ Clear prerequisites
→ Progress tracking
→ Contextual backlinks
```

## Best Practices

### Concept Naming

✅ **Good Names:**
- "Swift Closures" (specific)
- "Capture Semantics" (clear)
- "Async/Await Pattern" (descriptive)

❌ **Avoid:**
- "it" (vague)
- "this thing" (unclear)
- "stuff" (meaningless)

### When to Create Concepts

**Create for:**
- Technical terms you're learning
- Recurring topics in discussions
- Important definitions
- Key insights or realizations

**Don't create for:**
- One-off mentions
- Common words ("the", "and")
- Trivial topics

### Linking Strategy

**Link explicitly** with [[]] when:
- First mention in a note
- Introducing a concept
- Making relationships clear

**Auto-detect** for:
- Subsequent mentions
- Quick notes
- Chat messages

### Graph Maintenance

**Regularly:**
- Extract concepts from new content
- Merge duplicate concepts
- Delete orphaned/irrelevant nodes
- Update descriptions

**Periodically:**
- Review graph statistics
- Identify knowledge gaps
- Strengthen weak connections
- Reorganize concept types

## Performance Optimizations

### Caching

```swift
LinkingEngine uses:
- In-memory concept cache
- FetchDescriptor with predicates
- Batched insertions
```

### Lazy Loading

```swift
Graph views:
- Load nodes on-demand
- Paginate large graphs
- Virtualize off-screen content
```

### Batch Operations

```swift
Concept extraction:
- Process 3 sources concurrently
- Deduplicate before insert
- Bulk link creation
```

## Future Enhancements

### Phase 1 (Planned)

- [ ] Real-time link suggestions while typing
- [ ] Fuzzy concept matching
- [ ] Concept aliases and synonyms
- [ ] Link strength learning from usage

### Phase 2 (Future)

- [ ] Semantic similarity clustering
- [ ] Automatic concept merging
- [ ] Graph-based search
- [ ] Export to Obsidian format

### Phase 3 (Advanced)

- [ ] Multi-project graph connections
- [ ] Collaborative graph editing
- [ ] Version history for concepts
- [ ] AI-generated concept summaries

## API Reference

### LinkingEngine

```swift
// Parse [[concept]] syntax
parseLinks(from text: String) -> [ParsedLink]

// Create or get concept
getOrCreateConcept(name: String, in: AetheriumProject) -> ConceptNode

// Link two concepts
linkConcepts(_ source: ConceptNode, to target: ConceptNode, ...)

// Get backlinks
getBacklinks(for concept: ConceptNode) -> [Backlink]

// Suggest matches
suggestConcepts(matching text: String, ...) -> [ConceptNode]

// Auto-detect in text
detectPotentialConcepts(in text: String, ...) -> [DetectedConcept]
```

### ConceptExtractor

```swift
// Extract from chat
extractFromChat(_ session: ChatSession) -> [ConceptNode]

// Extract from document
extractFromDocument(_ document: UploadedDocument) -> [ConceptNode]

// Extract from project
extractFromProject(_ project: AetheriumProject) -> [ConceptNode]

// Auto-link concepts
autoLinkConcepts(_ concepts: [ConceptNode])

// Batch processing
batchExtract(chats: [...], documents: [...]) -> [ConceptNode]
```

### ConceptNode Extensions

```swift
// Find neighbors
conceptsWithinHops(_ maxHops: Int) -> Set<ConceptNode>

// Find path
pathTo(_ target: ConceptNode) -> [ConceptNode]?

// Related by tags
relatedByTags(in allNodes: [ConceptNode]) -> [ConceptNode]

// Increment usage
incrementReference()
```

## Troubleshooting

### Links Not Rendering

**Symptom**: [[concept]] shows as plain text

**Solutions**:
- Check syntax (double brackets)
- Verify in supported view (not all views support)
- Restart app to reload

### Concepts Not Extracting

**Symptom**: Extraction returns empty array

**Solutions**:
- Verify Ollama is running
- Check content isn't too short
- Try manual [[concept]] first
- Review Ollama logs

### Graph Too Slow

**Symptom**: Visualization laggy with many nodes

**Solutions**:
- Filter by type or search
- Use circular layout (simpler)
- Archive old concepts
- Increase RAM allocation

### Duplicate Concepts

**Symptom**: Multiple nodes for same concept

**Solutions**:
- Use aliases to merge
- Manual deletion of duplicates
- Adjust extraction prompt
- Regular deduplication

## Comparison with Obsidian

| Feature | Obsidian | Aetherium |
|---------|----------|-----------|
| **Bidirectional Links** | Manual | Manual + Auto |
| **Graph Visualization** | Advanced | Good |
| **Auto-Extraction** | No | Yes (AI) |
| **Backlinks** | Yes | Yes + Context |
| **Tags** | Hierarchical | Flat (now) |
| **Templates** | Yes | Planned |
| **Plugins** | Extensive | Future |
| **AI Integration** | Plugins | Native |
| **Local-First** | Yes | Yes |
| **Source Grounding** | No | Yes |

## Conclusion

The Knowledge Graph system transforms Aetherium into a **thinking tool** that:

- **Automatically organizes** your learning
- **Reveals hidden connections** between ideas
- **Tracks your knowledge** growth over time
- **Suggests learning paths** through backlinks
- **Combines** chat + documents + notes into unified knowledge

**The result**: Your AI companion that not only answers questions but helps you **build a connected, queryable knowledge base** of everything you learn.
