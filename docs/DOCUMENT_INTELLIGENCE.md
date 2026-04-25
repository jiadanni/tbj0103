# Document Intelligence Layer

This document describes Aetherium's source-grounded conversation system, inspired by NotebookLM's approach to document-centric AI interactions.

## Core Philosophy

Unlike traditional AI chat applications where conversations occur in a vacuum, Aetherium treats **documents as first-class citizens** that actively participate in conversations. Every response can be grounded in actual source material, with citations and references.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Project Workspace                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌───────────────────┐                │
│  │   Source Files   │  │  Knowledge Graph  │                │
│  │                  │  │                   │                │
│  │  • PDFs          │  │  • Concepts       │                │
│  │  • Webpages      │  │  • Relationships  │                │
│  │  • Audio         │  │  • Topics         │                │
│  │  • Notes         │  │                   │                │
│  └────────┬─────────┘  └─────────┬─────────┘                │
│           │                      │                           │
│           └───────┬──────────────┘                           │
│                   │                                          │
│           ┌───────▼──────────┐                               │
│           │  RAG Retrieval   │                               │
│           │     Engine       │                               │
│           └───────┬──────────┘                               │
│                   │                                          │
│           ┌───────▼──────────────────────┐                   │
│           │  Grounded Chat Interface     │                   │
│           │  (Citations + Sources)       │                   │
│           └──────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

## Document Processing Pipeline

### Phase 1: Text Extraction

```swift
TextExtractor
  ├── PDF Documents (PDFKit)
  ├── Plain Text / Markdown
  ├── HTML (basic stripping)
  ├── RTF (NSAttributedString)
  └── Future: DOCX, EPUB, etc.
```

**Output**: Clean, structured text preserving semantics

### Phase 2: Semantic Chunking

```swift
SemanticChunker
  ├── Paragraph boundary detection
  ├── Token count estimation (~4 chars/token)
  ├── Context preservation
  └── Future: MLX-based semantic boundaries
```

**Output**: 512-token chunks maintaining context

### Phase 3: Embedding Generation

```rust
EmbeddingGenerator
  ├── Current: Ollama embeddings API (/api/embed)
  └── Future: Local MLX/Transformers embedding models
```

**Output**: 384/768-dimensional vectors for semantic search

### Phase 4: Storage & Indexing

**SQLite Persistence:**
- `sources` (unified container for documents and web captures)
- `source_chunks` (searchable units with embedding BLOBs)
- `citations` (references in messages)

**Output**: Queryable document database

## Retrieval-Augmented Generation (RAG)

### Retrieval Process

1. **Query Analysis**
   - User asks a question
   - Extract key terms and concepts
   - Generate query embedding (future)

2. **Document Search**
   - **Current**: Keyword-based matching
     - Term frequency scoring
     - Normalized by chunk length
     - Top-K selection
   - **Future**: Semantic similarity
     - Cosine similarity with embeddings
     - Threshold-based filtering (>0.7)
     - Relevance ranking

3. **Context Building**
   - Select top 5 relevant chunks
   - Augment prompt with source material
   - Include citation metadata

4. **Response Generation**
   - Send augmented prompt to Ollama
   - Extract citations from response
   - Link sources to message

### Example RAG Flow

```
User: "What are closures in Swift?"
  ↓
Retrieval Engine searches project sources
  ↓
Finds relevant chunks from:
  • "Swift Language Guide.pdf" (p. 42, score: 0.95)
  • "Functional Programming.md" (score: 0.87)
  • "Code Examples.txt" (score: 0.78)
  ↓
Augmented Prompt:
  "You are a helpful AI assistant. Use the following
   source material to answer...

   ## Source 1: Swift Language Guide.pdf
   Closures are self-contained blocks of functionality...

   ## Source 2: Functional Programming.md
   Closures capture values from their surrounding context...

   ## User Question:
   What are closures in Swift?"
  ↓
Ollama generates response
  ↓
Response saved with citations
```

## Source Types

### 1. Documents
- **Supported Formats**: PDF, TXT, Markdown, HTML, RTF
- **Chunking**: Semantic paragraph-based
- **Searchability**: Full-text + embeddings
- **Use Cases**: Research papers, documentation, books

### 2. Webpages
- **Capture Method**: URL → HTML → clean text
- **Metadata**: Title, URL, favicon
- **Use Cases**: Blog posts, documentation, articles

### 3. Audio Transcriptions
- **Source**: Voice recordings, podcasts, lectures
- **Processing**: Whisper model transcription
- **Searchability**: Full transcript text
- **Use Cases**: Lecture notes, interviews, meetings

### 4. Notes
- **Types**:
  - Manual (user-created)
  - AI-generated (study guides, summaries)
  - Extracted (key points from documents)
  - Quizzes (generated assessments)
- **Use Cases**: Annotations, insights, learning aids

## Content Generation

### Study Guides

```swift
ContentGenerator.generateStudyGuide(from: project)
  ↓
Analyzes all project sources
  ↓
Generates structured guide:
  • Key Concepts
  • Important Definitions
  • Main Topics
  • Practice Questions
```

### Learning Goals Extraction

```swift
ContentGenerator.extractKeyConcepts(from: project)
  ↓
Identifies 3-5 learning objectives
  ↓
Creates LearningGoal objects:
  • Clear title
  • Description
  • Progress tracking
  • Prerequisites
```

### Quiz Generation

```swift
ContentGenerator.generateQuiz(from: project, questionCount: 5)
  ↓
Creates assessment with:
  • Multiple choice questions
  • Correct answers
  • Explanations
  • Source references
```

## Citation System

### Citation Structure

```swift
Citation {
  sourceID: UUID          // Links to chunk/source
  sourceTitle: String     // "Swift Guide.pdf"
  sourceType: String      // document/webpage/note
  excerpt: String         // First 200 chars
  relevanceScore: Double  // 0.0 to 1.0
  pageNumber: Int?        // For PDFs
}
```

### Citation Display

Messages with citations show:
- **Badge**: Number of sources cited
- **Expandable List**: Click to see all sources
- **Source Details**: Title, type, excerpt, page
- **Relevance Score**: How well it matches query

### Benefits

1. **Verifiability**: Users can check source material
2. **Trust**: AI responses grounded in facts
3. **Learning**: Direct access to original context
4. **Attribution**: Proper credit to sources

## User Interface

### Document Browser

```
┌──────────────────────────────────────────┐
│  Search: [____________] 🔍                │
├──────────────────────────────────────────┤
│  📄 Documents: 5  🌐 Web: 2  🎤 Audio: 1 │
├──────────────────────────────────────────┤
│  📘 Swift Language Guide.pdf             │
│     • 42 chunks • 2.3 MB • PDF           │
│                                           │
│  📗 Functional Programming.md            │
│     • 15 chunks • 45 KB • Markdown       │
│                                           │
│  🌐 Swift.org Documentation              │
│     • Captured Jan 15 • Webpage          │
├──────────────────────────────────────────┤
│  [Import Document] [+]                   │
└──────────────────────────────────────────┘
```

### Grounded Chat Interface

```
┌──────────────────────────────────────────┐
│  💬 Learning Swift Closures               │
│  📚 Grounded in 5 sources [View >]        │
├──────────────────────────────────────────┤
│                                           │
│  👤 You: What are closures in Swift?     │
│                                           │
│  🧠 AI: Closures are self-contained...   │
│     [📄 3 sources]                        │
│     ↓                                     │
│     Sources:                              │
│     📘 Swift Language Guide (p.42) 95%   │
│        "Closures are self-contained..."  │
│                                           │
│     📗 Functional Programming 87%        │
│        "Closures capture values..."      │
│                                           │
├──────────────────────────────────────────┤
│  Type a message... [↑]                    │
└──────────────────────────────────────────┘
```

## Performance Optimizations

### Memory Management

```swift
DocumentProcessor
  • Process max 2 documents concurrently
  • Stream large files (>10MB)
  • Clear intermediate buffers
  • Cache embeddings (NSCache)
  • Lazy load chunks on demand
```

### Caching Strategy

```swift
EmbeddingGenerator
  • Cache: NSCache<NSString, CachedEmbedding>
  • Key: Text content hash
  • Eviction: LRU policy
  • Persistence: Stored in DocumentChunk
```

### Query Optimization

```swift
RetrievalEngine
  • Index: TF-IDF for keyword search
  • Future: Vector index (FAISS/Annoy)
  • Limit: Top 5 results
  • Threshold: Relevance > 0.7
```

## Future Enhancements

### Phase 1 (Current)
- PDF/TXT/HTML extraction
- Keyword-based retrieval
- Citation support
- Document browser

### Phase 2 (Current)
- Ollama embeddings integration
- Semantic similarity search (Cosine sim via retrieval engine)
- Real-time document updates
- Source browser unification

### Phase 3 (Future)
- [ ] MLX embedding models
- [ ] Multi-modal support (images)
- [ ] Graph visualization
- [ ] Export to NotebookLM format
- [ ] Browser extension integration

## Integration with Ollama

### Embeddings Endpoint

```bash
# Generate embeddings with Ollama
curl http://localhost:11434/api/embeddings -d '{
  "model": "nomic-embed-text",
  "prompt": "Closures in Swift are..."
}'
```

### Recommended Models

**For Embeddings**:
- `nomic-embed-text` - 768 dimensions
- `all-minilm` - 384 dimensions (faster)

**For Chat**:
- `qwen2.5:7b` - Excellent for document Q&A
- `llama3.2` - Good general performance
- `mistral` - Fast responses

## Best Practices

### Document Organization

1. **Group Related Materials**: Keep related docs in same project
2. **Use Descriptive Names**: "Swift_Closures_Guide.pdf" > "Document1.pdf"
3. **Tag Important Sections**: Add manual notes for key concepts
4. **Update Regularly**: Re-process when sources change

### Effective Queries

1. **Be Specific**: "Explain closure capture semantics" > "Tell me about closures"
2. **Reference Sources**: "According to the Swift guide..."
3. **Ask Follow-ups**: Build on previous answers
4. **Request Citations**: "Show me the source for that"

### Source Quality

1. **Authoritative Sources**: Official docs > random blogs
2. **Current Information**: Check publication dates
3. **Complete Context**: Include prerequisites/background
4. **Diverse Perspectives**: Multiple sources = better understanding

## Comparison with NotebookLM

| Feature | NotebookLM | Aetherium |
|---------|------------|-----------|
| **Local Processing** | Cloud | Local + Cloud |
| **Privacy** | Google servers | Biometric lock |
| **Model Choice** | Fixed | Ollama/APIs |
| **Cost** | Free | Local (Ollama) |
| **Offline Mode** | No | Yes (local) |
| **Source Types** | PDF, TXT, Web | PDF, TXT, Web, Audio, Notes |
| **Project Organization** | Yes | Enhanced |
| **Learning Goals** | No | Yes |
| **Knowledge Graph** | Basic | Advanced (planned) |
| **Export** | Limited | Multiple formats |

## Code Examples

### Processing a Document

```swift
let processor = DocumentProcessor()

// Process single document
let document = try await processor.processDocument(url)

// Create source
let source = ProjectSource(sourceType: .document, title: document.filename)
source.document = document
source.project = project

modelContext.insert(source)
```

### Sending a Grounded Message

```swift
let groundedEngine = GroundedChatEngine(modelOrchestrator: orchestrator)

let (response, citations) = try await groundedEngine.sendMessage(
    "Explain closures",
    in: chatSession,
    project: project
)

// Response is grounded in project sources
// Citations link back to specific chunks
```

### Generating a Study Guide

```swift
let generator = ContentGenerator(modelOrchestrator: orchestrator)

let studyGuide = try await generator.generateStudyGuide(from: project)

// Creates ProjectNote with:
// - Key concepts
// - Definitions
// - Practice questions
```

## Troubleshooting

### Documents Not Processing

**Symptom**: Import fails or hangs

**Solutions**:
- Check file format is supported
- Verify file isn't corrupted
- Try smaller documents first
- Check Ollama is running

### Citations Not Appearing

**Symptom**: Messages have no citations

**Solutions**:
- Ensure project has sources
- Check relevance threshold
- Try more specific queries
- Verify chunks were created

### Slow Retrieval

**Symptom**: Long delays before response

**Solutions**:
- Reduce number of sources
- Enable caching
- Use keyword search vs. embeddings
- Check system resources

---

**The Document Intelligence Layer transforms Aetherium from a chat app into a comprehensive learning environment where every conversation is grounded in knowledge.**
