import Foundation
import SwiftData

/// Seeds all demo data into the provided `ModelContext`.
/// Every date is expressed as an offset from `Date()` so the content
/// always looks current regardless of when the demo is run.
struct DemoDataService {

    static func seed(into context: ModelContext) {
        seedTransformers(into: context)
        seedSaaS(into: context)
        seedRome(into: context)
        seedTemplates(into: context)
    }

    // MARK: - Date helpers (static, no labels, callable from any static method)

    private static func ago(_ days: Int) -> Date {
        Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
    }

    private static func inDays(_ days: Int) -> Date {
        Calendar.current.date(byAdding: .day, value: days, to: Date()) ?? Date()
    }

    private static func inMonths(_ months: Int) -> Date {
        Calendar.current.date(byAdding: .month, value: months, to: Date()) ?? Date()
    }

    private static func agoYears(_ years: Int) -> Date {
        Calendar.current.date(byAdding: .year, value: -years, to: Date()) ?? Date()
    }

    // MARK: - Project 1: Understanding Transformers

    private static func seedTransformers(into context: ModelContext) {
        let project = Workspace(
            title: "Understanding Transformers",
            description: "Deep dive into the Transformer architecture, attention mechanisms, and how modern LLMs work under the hood.",
            createdAt: ago(14),
            updatedAt: ago(0)
        )
        context.insert(project)

        // ── Learning Goals ────────────────────────────────────────────────────
        let g1 = LearningGoal(
            title: "Read 'Attention is All You Need'",
            description: "Thoroughly read and annotate the original Transformer paper.",
            progress: 1.0,
            createdAt: ago(14)
        )
        let g2 = LearningGoal(
            title: "Understand Attention Mechanism",
            description: "Be able to explain scaled dot-product attention and multi-head attention from first principles.",
            progress: 0.75,
            createdAt: ago(12)
        )
        let g3 = LearningGoal(
            title: "Implement a Transformer from scratch",
            description: "Build a working mini-Transformer as a coding exercise.",
            progress: 0.2,
            createdAt: ago(7)
        )
        g1.project = project; g2.project = project; g3.project = project
        g2.addPrerequisite(g1.id); g3.addPrerequisite(g2.id)
        context.insert(g1); context.insert(g2); context.insert(g3)

        // ── Sources ───────────────────────────────────────────────────────────

        // 1. Uploaded document
        let paperMeta = DocumentMetadata(
            author: "Vaswani et al.",
            creationDate: agoYears(7),
            pageCount: 15, wordCount: 8400,
            extractedSections: ["Abstract", "Introduction", "Model Architecture", "Attention", "Experiments"],
            extractedEntities: ["Transformer", "Attention", "Encoder", "Decoder", "Multi-Head Attention"]
        )
        let paperDoc = UploadedDocument(
            filename: "attention_is_all_you_need.pdf",
            fileType: .pdf,
            filePath: "/demo/attention_is_all_you_need.pdf",
            extractedText: "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.",
            pageCount: 15,
            fileSize: 1_048_576,
            metadata: paperMeta
        )
        let chunk1 = DocumentChunk(
            content: "Scaled Dot-Product Attention: The input consists of queries and keys of dimension dk, and values of dimension dv. We compute the dot products of the query with all keys, divide each by √dk, and apply a softmax function.",
            chunkIndex: 0, tokenCount: 52
        )
        let chunk2 = DocumentChunk(
            content: "Multi-Head Attention allows the model to jointly attend to information from different representation subspaces at different positions. Multi-head attention runs the attention function h times in parallel.",
            chunkIndex: 1, tokenCount: 46
        )
        paperDoc.chunks = [chunk1, chunk2]
        chunk1.document = paperDoc; chunk2.document = paperDoc
        context.insert(paperDoc); context.insert(chunk1); context.insert(chunk2)

        let paperSource = ProjectSource(sourceType: .document, title: "Attention is All You Need (Paper)", createdAt: ago(14))
        paperSource.document = paperDoc; paperSource.project = project
        paperSource.processedAt = ago(14); paperDoc.source = paperSource
        context.insert(paperSource)

        // 2. Web capture
        let illuWeb = WebCapture(
            url: "https://jalammar.github.io/illustrated-transformer/",
            pageTitle: "The Illustrated Transformer",
            extractedContent: "A visual guide to understanding the Transformer model. It walks through the encoder-decoder structure, attention heads, and positional encodings with clear diagrams.",
            capturedAt: ago(10)
        )
        let webSource = ProjectSource(sourceType: .webpage, title: "The Illustrated Transformer", createdAt: ago(10))
        webSource.webpage = illuWeb; webSource.project = project
        webSource.processedAt = ago(10); illuWeb.source = webSource
        context.insert(illuWeb); context.insert(webSource)

        // 3. Research note
        let note1 = ProjectNote(
            title: "Key Insights — Attention Mechanism",
            content: """
            # Key Insights — Attention Mechanism

            ## What is attention?
            Attention lets the model decide which parts of the input to focus on when producing each output. Rather than compressing the whole input into a single vector (like RNNs), attention allows the decoder to look back at *all* encoder states.

            ## Scaled Dot-Product
            ```
            Attention(Q, K, V) = softmax(QK^T / sqrt(d_k)) * V
            ```
            - Scaling by √d_k prevents gradients from vanishing when d_k is large
            - Softmax gives a probability distribution over values

            ## Multi-Head
            - Run h=8 attention heads in parallel
            - Each head learns different relationships
            - Concatenate and project outputs

            ## [[Positional Encoding]]
            Since Transformers have no recurrence, position information is injected via sinusoidal encodings added to embeddings.

            ## Related concepts
            - [[Self-Attention]]
            - [[Encoder-Decoder Architecture]]
            - [[Multi-Head Attention]]
            """,
            noteType: .manual,
            tags: ["transformers", "attention", "deep-learning"]
        )
        let noteSource1 = ProjectSource(sourceType: .note, title: "Key Insights — Attention Mechanism", createdAt: ago(7))
        noteSource1.note = note1; noteSource1.project = project
        noteSource1.processedAt = ago(7); note1.source = noteSource1
        context.insert(note1); context.insert(noteSource1)

        // ── Chat Sessions ─────────────────────────────────────────────────────

        let chat1 = ChatSession(
            title: "How does scaled dot-product attention work?",
            createdAt: ago(12), updatedAt: ago(12)
        )
        chat1.project = project

        let m1u = Message(content: "Can you explain scaled dot-product attention in simple terms?", role: .user, timestamp: ago(12))
        let m1a = Message(content: """
        Scaled dot-product attention is the core operation in Transformers — and it's more intuitive than it looks.

        **The three inputs: Q, K, V**
        Think of it like a search engine. You have a **Query** (what you're looking for), **Keys** (labels on each item in a database), and **Values** (the actual content of each item).

        **The computation:**
        1. Compute similarity between Q and every K using the dot product
        2. Divide by √d_k to prevent very large values that kill gradients
        3. Apply softmax → a probability distribution (how much to weight each item)
        4. Multiply weights by V → a weighted average of values

        The formula: `Attention(Q, K, V) = softmax(QKᵀ / √d_k) · V`

        **Why scale by √d_k?** When d_k is large, dot products grow large and push softmax into regions with near-zero gradients. Scaling keeps training stable.
        """, role: .assistant, timestamp: ago(12))

        let cit1 = Citation(
            sourceID: paperSource.id.uuidString, sourceTitle: "Attention is All You Need (Paper)",
            sourceType: "document",
            excerpt: "Scaled Dot-Product Attention: The input consists of queries and keys of dimension dk...",
            relevanceScore: 0.94, pageNumber: 4
        )
        m1a.citations = [cit1]; cit1.message = m1a

        let m2u = Message(content: "What's the difference between self-attention and cross-attention?", role: .user, timestamp: ago(12))
        let m2a = Message(content: """
        Great follow-up! The difference is where Q, K, and V come from.

        **Self-Attention** (encoder and decoder)
        Q, K, and V all come from the *same* sequence. Every token attends to every other token in the same input. This lets the model build contextual representations — "bank" knows whether it's a river bank or a financial institution based on surrounding words.

        **Cross-Attention** (decoder only)
        Q comes from the *decoder* (what the model is currently generating), while K and V come from the *encoder* output. This is how the decoder "reads" the source sentence when generating each target word.

        In the classical Transformer:
        - Encoder: self-attention only
        - Decoder: masked self-attention + cross-attention
        """, role: .assistant, timestamp: ago(12))

        m1u.chatSession = chat1; m1a.chatSession = chat1
        m2u.chatSession = chat1; m2a.chatSession = chat1
        chat1.messages = [m1u, m1a, m2u, m2a]
        context.insert(chat1)
        context.insert(m1u); context.insert(m1a); context.insert(m2u); context.insert(m2a); context.insert(cit1)

        let chat2 = ChatSession(
            title: "Why do Transformers need positional encodings?",
            createdAt: ago(8), updatedAt: ago(8),
            branchLabel: "Branch: positional encoding deep dive"
        )
        chat2.project = project

        let m3u = Message(content: "Transformers have no recurrence — how do they know word order?", role: .user, timestamp: ago(8))
        let m3a = Message(content: """
        You've spotted one of the most elegant design decisions in the Transformer paper.

        **The problem:** RNNs process tokens sequentially so order is baked in. Transformers process all tokens *in parallel* — "The cat sat" and "The sat cat" would look identical without extra information.

        **The solution: Positional Encodings**
        A unique vector is added to each token embedding encoding its position. The original paper uses sinusoidal functions:

        ```
        PE(pos, 2i)   = sin(pos / 10000^(2i/d_model))
        PE(pos, 2i+1) = cos(pos / 10000^(2i/d_model))
        ```

        Why sinusoidal?
        - Works for sequences *longer* than seen in training (no upper bound)
        - Relative positions can be expressed as a linear function of the encodings
        - Values bounded between −1 and 1, so they don't distort embeddings

        Modern models (BERT, GPT) use **learned positional embeddings** which tend to work better in practice but lose the length-generalisation property.
        """, role: .assistant, timestamp: ago(8))

        m3u.chatSession = chat2; m3a.chatSession = chat2
        chat2.messages = [m3u, m3a]
        context.insert(chat2); context.insert(m3u); context.insert(m3a)

        // ── Concept Nodes ─────────────────────────────────────────────────────

        let cTransformer   = ConceptNode(name: "Transformer", description: "Neural network architecture based entirely on attention mechanisms, introduced in 'Attention is All You Need' (2017).", nodeType: .technology)
        let cAttention     = ConceptNode(name: "Attention Mechanism", description: "Technique allowing a model to selectively focus on parts of the input. Core to the Transformer.", nodeType: .definition)
        let cSelfAttn      = ConceptNode(name: "Self-Attention", description: "Attention where Q, K, V come from the same sequence. Enables each token to attend to all others.", nodeType: .definition)
        let cMHA           = ConceptNode(name: "Multi-Head Attention", description: "Running attention h times in parallel with different learned projections, then concatenating.", nodeType: .definition)
        let cPosEnc        = ConceptNode(name: "Positional Encoding", description: "Vectors added to embeddings to inject position information since Transformers lack recurrence.", nodeType: .definition)
        let cEncoder       = ConceptNode(name: "Encoder", description: "Processes input tokens with self-attention, building contextual representations.", nodeType: .technology)
        let cDecoder       = ConceptNode(name: "Decoder", description: "Generates output autoregressively, using masked self-attention and cross-attention to encoder outputs.", nodeType: .technology)
        let cQKV          = ConceptNode(name: "Query-Key-Value", description: "Three components of attention: Q (what to search for), K (what to match against), V (what to return).", nodeType: .definition)

        for node in [cTransformer, cAttention, cSelfAttn, cMHA, cPosEnc, cEncoder, cDecoder, cQKV] {
            node.project = project
            context.insert(node)
        }

        let tLinks: [(ConceptNode, ConceptNode, ConceptLinkType)] = [
            (cTransformer, cAttention,  .partOf),
            (cMHA,         cAttention,  .partOf),
            (cSelfAttn,    cAttention,  .partOf),
            (cAttention,   cQKV,        .partOf),
            (cEncoder,     cTransformer, .partOf),
            (cDecoder,     cTransformer, .partOf),
            (cPosEnc,      cTransformer, .partOf),
            (cMHA,         cSelfAttn,   .related),
        ]
        for (src, tgt, type) in tLinks {
            let link = ConceptLink(source: src, target: tgt, linkType: type, strength: 0.9)
            src.outgoingLinks.append(link); tgt.incomingLinks.append(link)
            context.insert(link)
        }

        // ── Flashcards ────────────────────────────────────────────────────────

        let tCards: [(String, String, Int, Int, Int)] = [
            ("What does Q, K, V stand for in attention?", "Query, Key, Value. Q = what you're looking for; K = labels on items; V = item content.", 2, 7, -3),
            ("Write the scaled dot-product attention formula.", "Attention(Q, K, V) = softmax(QKᵀ / √d_k) · V", 4, 14, -7),
            ("Why scale by √d_k in attention?", "To prevent large dot products pushing softmax into near-zero gradient regions, which destabilises training.", 3, 3, -1),
            ("Self-attention vs cross-attention?", "Self: Q, K, V from same sequence. Cross: Q from decoder, K & V from encoder.", 3, 7, -4),
            ("How does a Transformer preserve word order?", "Positional encodings (sinusoidal or learned) are added to token embeddings before the first layer.", 3, 4, -2),
            ("What is multi-head attention and why use it?", "Running attention h times with different projections. Each head can specialise in different relationships.", 2, 1, 0),
            ("Role of the encoder in a Transformer?", "Processes input tokens in parallel with self-attention, building contextual representations.", 3, 3, -1),
            ("Role of the decoder in a Transformer?", "Generates output autoregressively; uses masked self-attention + cross-attention to encoder outputs.", 4, 7, -5),
        ]
        for (i, (front, back, diff, interval, nextOffset)) in tCards.enumerated() {
            let card = LearningCard(front: front, back: back, cardType: .basic, difficulty: diff)
            card.project = project
            card.repetitions = i % 3; card.interval = interval
            card.nextReviewDate = inDays(-nextOffset)
            card.totalReviews = i + 1; card.correctReviews = max(0, i)
            context.insert(card)
        }

        // ── Learning Path ─────────────────────────────────────────────────────

        let path = LearningPath(
            title: "Deep Learning Mastery",
            description: "From ML fundamentals to building Transformer-based applications.",
            targetCompletionDate: inMonths(3)
        )
        path.project = project

        let ms1 = PathMilestone(title: "Complete ML Fundamentals", description: "Linear algebra, calculus, probability — the mathematical foundations.", orderIndex: 0)
        ms1.isCompleted = true; ms1.completedAt = ago(30)

        let ms2 = PathMilestone(title: "Understand RNNs and LSTMs", description: "Learn sequential models before studying why Transformers replace them.", orderIndex: 1)
        ms2.isCompleted = true; ms2.completedAt = ago(15)

        let ms3 = PathMilestone(title: "Master the Transformer Architecture", description: "Read the paper, work through the Illustrated Transformer, implement attention.", orderIndex: 2, dueDate: inDays(14))

        let ms4 = PathMilestone(title: "Build a Transformer Application", description: "Use a pre-trained model to build something useful.", orderIndex: 3, dueDate: inMonths(2))

        for ms in [ms1, ms2, ms3, ms4] { ms.learningPath = path; context.insert(ms) }
        path.milestones = [ms1, ms2, ms3, ms4]
        context.insert(path)

        // ── Daily Notes ───────────────────────────────────────────────────────

        let dailyData: [(Int, String, String, Int)] = [
            (6, "# Day 1 – Starting the Transformer Journey\nRead the abstract and introduction. The core idea — \"Attention is All You Need\" — is bold. Replaces recurrence entirely with attention. A foundational paper.", "curious", 7),
            (5, "# Day 2 – Encoder Architecture\nWorked through the encoder stack. Each layer: multi-head attention + feed-forward network, wrapped with residual connections and layer norm.", "focused", 8),
            (4, "# Day 3 – Attention Deep Dive\nSpent 2 hours on the attention section. Q, K, V finally clicked when I thought of it as a soft database lookup. Used Aetherium to ask for an explanation — it cited the paper directly.", "excited", 9),
            (3, "# Day 4 – Decoder & Cross-Attention\nThe decoder has an extra attention layer — cross-attention that looks at encoder outputs. This is how translation works: the decoder queries the encoded representation of the source sentence.", "focused", 7),
            (2, "# Day 5 – Positional Encodings\nSinusoidal encodings are elegant. Plotted them in a notebook — you can see the different frequencies across embedding dimensions. Learned positions are used in GPT but sinusoidal generalises better to longer sequences.", "calm", 8),
            (1, "# Day 6 – Multi-Head Attention\nFinally understand why multiple heads are useful. Each head can focus on different relationships — syntactic in one, semantic in another. Paper uses h=8 with d_model=512, so each head has d_k=64.", "happy", 9),
            (0, "# Day 7 – Review & Consolidation\nGone through all flashcards. Still shaky on the exact forward pass dimensions. Will spend tomorrow doing a Python implementation to cement understanding. Massive week!", "productive", 10),
        ]
        for (daysAgo, content, mood, productivity) in dailyData {
            let dn = DailyNote(date: ago(daysAgo), content: content, mood: mood, productivity: productivity)
            dn.project = project
            dn.completedTasks = daysAgo == 0 ? ["Review flashcards", "Write daily note"] : ["Read paper section", "Take notes"]
            dn.learningHighlights = ["Attention mechanism insight"]
            context.insert(dn)
        }
    }

    // MARK: - Project 2: Building a SaaS Product

    private static func seedSaaS(into context: ModelContext) {
        let project = Workspace(
            title: "Building a SaaS Product",
            description: "Notes and research for launching an indie SaaS product — market validation, tech stack decisions, and growth strategies.",
            createdAt: ago(45),
            updatedAt: ago(1)
        )
        context.insert(project)

        // ── Learning Goals ────────────────────────────────────────────────────

        let g1 = LearningGoal(title: "Define MVP Feature Set", description: "Use customer discovery to identify the three features that solve the core problem.", progress: 1.0, createdAt: ago(40))
        let g2 = LearningGoal(title: "Understand Key SaaS Metrics", description: "Learn CAC, LTV, churn rate, MRR, and ARR and how they interrelate.", progress: 0.65, createdAt: ago(35))
        let g3 = LearningGoal(title: "Launch Beta to 10 Users", description: "Soft launch with a small cohort and gather structured feedback.", progress: 0.0, createdAt: ago(20))
        g1.project = project; g2.project = project; g3.project = project
        g3.addPrerequisite(g1.id)
        context.insert(g1); context.insert(g2); context.insert(g3)

        // ── Sources ───────────────────────────────────────────────────────────

        let meetingNote = ProjectNote(
            title: "Product Kickoff Meeting — Notes",
            content: """
            # Product Kickoff Meeting
            **Date:** {{date}}
            **Attendees:** Founder, Advisor (Sarah), Designer (Marcus)

            ## Goals Discussed
            - Target market: indie developers & small SaaS teams
            - Core problem: too much context switching between tools (Notion, Slack, Linear)
            - Our angle: unified knowledge + AI, 100% local

            ## MVP Decision
            After 90 minutes of debate, we aligned on **three core features** for the first release:
            1. AI-assisted note-taking with source grounding
            2. Knowledge graph for connecting ideas
            3. Spaced repetition for learning retention

            ## Action Items
            - [ ] Sarah to share competitor analysis by Friday
            - [ ] Marcus to wireframe the knowledge graph view
            - [ ] Founder to set up Ollama integration prototype

            ## Next Steps
            Ship a working prototype in 4 weeks and test with 5 beta users.
            """,
            noteType: .manual,
            tags: ["meeting", "product", "mvp"]
        )
        let meetingSource = ProjectSource(sourceType: .note, title: "Product Kickoff Meeting — Notes", createdAt: ago(40))
        meetingSource.note = meetingNote; meetingSource.project = project
        meetingSource.processedAt = ago(40); meetingNote.source = meetingSource
        context.insert(meetingNote); context.insert(meetingSource)

        let metricsCapture = WebCapture(
            url: "https://baremetrics.com/saas-metrics",
            pageTitle: "The SaaS Metrics Dashboard – Baremetrics",
            extractedContent: "Monthly Recurring Revenue (MRR) is the normalized, predictable revenue from all active subscriptions in a month. Customer Acquisition Cost (CAC) measures the total sales and marketing spend per new customer. Lifetime Value (LTV) estimates the total revenue from a customer over their entire relationship.",
            capturedAt: ago(30)
        )
        let metricsSource = ProjectSource(sourceType: .webpage, title: "The SaaS Metrics Dashboard – Baremetrics", createdAt: ago(30))
        metricsSource.webpage = metricsCapture; metricsSource.project = project
        metricsSource.processedAt = ago(30); metricsCapture.source = metricsSource
        context.insert(metricsCapture); context.insert(metricsSource)

        // ── Chat Session ──────────────────────────────────────────────────────

        let chat = ChatSession(
            title: "What metrics should I track at launch?",
            createdAt: ago(25), updatedAt: ago(25)
        )
        chat.project = project

        let mu1 = Message(content: "I'm about to launch a SaaS. What are the most important metrics to track from day one?", role: .user, timestamp: ago(25))
        let ma1 = Message(content: """
        Congrats on the upcoming launch! Starting with the right metrics sets you up for data-driven decisions.

        **The launch trinity (track from day 1):**
        1. **MRR** (Monthly Recurring Revenue) — your financial heartbeat. Track it weekly.
        2. **Churn Rate** — % of customers who cancel each month. High churn kills growth. Aim for < 2% monthly for SMB SaaS.
        3. **Activation Rate** — % of signups who hit your "aha moment". This reveals whether your onboarding works.

        **Add these once you have 20+ customers:**
        4. **CAC** (Customer Acquisition Cost) — total spend ÷ new customers acquired.
        5. **LTV** (Lifetime Value) — ARPU ÷ churn rate. The golden rule: **LTV ≥ 3× CAC**.
        6. **NPS** — quarterly "how likely are you to recommend us?" Score > 50 is excellent.

        At launch you likely won't have enough data for CAC/LTV to be meaningful. Focus on activation and churn first — they tell you whether your product actually solves the problem.
        """, role: .assistant, timestamp: ago(25))

        let cit2 = Citation(
            sourceID: metricsSource.id.uuidString, sourceTitle: "The SaaS Metrics Dashboard – Baremetrics",
            sourceType: "webpage",
            excerpt: "Monthly Recurring Revenue (MRR) is the normalized, predictable revenue from all active subscriptions...",
            relevanceScore: 0.88
        )
        ma1.citations = [cit2]; cit2.message = ma1

        mu1.chatSession = chat; ma1.chatSession = chat
        chat.messages = [mu1, ma1]
        context.insert(chat); context.insert(mu1); context.insert(ma1); context.insert(cit2)

        // ── Concepts ──────────────────────────────────────────────────────────

        let cMVP   = ConceptNode(name: "MVP", description: "Minimum Viable Product — the smallest version that lets you test a core assumption.", nodeType: .definition)
        let cMRR   = ConceptNode(name: "MRR", description: "Monthly Recurring Revenue — predictable monthly revenue from subscriptions.", nodeType: .definition)
        let cCAC   = ConceptNode(name: "CAC", description: "Customer Acquisition Cost — total acquisition spend ÷ new customers.", nodeType: .definition)
        let cLTV   = ConceptNode(name: "LTV", description: "Lifetime Value — estimated total revenue from one customer. Rule: LTV ≥ 3× CAC.", nodeType: .definition)
        let cChurn = ConceptNode(name: "Churn Rate", description: "% of customers who cancel in a given period. Target < 2% monthly for SMB SaaS.", nodeType: .definition)
        let cPMF   = ConceptNode(name: "Product-Market Fit", description: "When a product satisfies a strong market demand and growth becomes self-sustaining.", nodeType: .insight)

        for node in [cMVP, cMRR, cCAC, cLTV, cChurn, cPMF] {
            node.project = project; context.insert(node)
        }

        let sLinks: [(ConceptNode, ConceptNode, ConceptLinkType)] = [
            (cLTV,  cMRR,   .related),
            (cLTV,  cChurn, .related),
            (cCAC,  cLTV,   .related),
            (cPMF,  cChurn, .related),
            (cMVP,  cPMF,   .prerequisite),
        ]
        for (src, tgt, type) in sLinks {
            let link = ConceptLink(source: src, target: tgt, linkType: type, strength: 0.85)
            src.outgoingLinks.append(link); tgt.incomingLinks.append(link)
            context.insert(link)
        }

        // ── Flashcards ────────────────────────────────────────────────────────

        let sCards: [(String, String, Int, Int)] = [
            ("What is the LTV:CAC golden ratio?", "LTV should be at least 3× CAC. Below 3× means you're spending too much to acquire customers relative to their lifetime value.", 1, 0),
            ("What is a healthy monthly churn rate for SMB SaaS?", "Below 2% monthly churn. Above 5% is a serious problem — inspect onboarding and value delivery.", 2, 4),
            ("What is MRR and why does it matter?", "Monthly Recurring Revenue — the predictable monthly revenue from subscriptions. It's your financial pulse.", 2, 8),
            ("Define 'Activation Rate'.", "% of signups who reach your product's 'aha moment'. High = good onboarding. Low = users don't see value fast enough.", 3, 0),
            ("What is Product-Market Fit?", "When a product satisfies strong market demand — users love it, growth accelerates via word-of-mouth, churn drops.", 3, 5),
        ]
        for (i, (front, back, diff, nextOffset)) in sCards.enumerated() {
            let card = LearningCard(front: front, back: back, cardType: .basic, difficulty: diff)
            card.project = project
            card.interval = [1, 4, 8][i % 3]
            card.nextReviewDate = inDays(nextOffset)
            context.insert(card)
        }
    }

    // MARK: - Project 3: History of the Roman Empire

    private static func seedRome(into context: ModelContext) {
        let project = Workspace(
            title: "History of the Roman Empire",
            description: "A personal deep-dive into Roman history: the Republic, the Principate, and the fall of the Western Empire.",
            createdAt: ago(60),
            updatedAt: ago(3)
        )
        context.insert(project)

        // ── Learning Goals ────────────────────────────────────────────────────

        let g1 = LearningGoal(title: "Understand the Roman Republic", description: "The SPQR era: Senate, magistrates, the Punic Wars, and Caesar's crossing of the Rubicon.", progress: 0.6, createdAt: ago(55))
        let g2 = LearningGoal(title: "Study the Principate (27 BC – 284 AD)", description: "From Augustus to the Crisis of the Third Century.", progress: 0.25, createdAt: ago(40))
        let g3 = LearningGoal(title: "Understand the Fall of Rome", description: "Why did the Western Empire collapse in 476 AD? Internal and external causes.", progress: 0.0, createdAt: ago(20))
        g1.project = project; g2.project = project; g3.project = project
        g2.addPrerequisite(g1.id); g3.addPrerequisite(g2.id)
        context.insert(g1); context.insert(g2); context.insert(g3)

        // ── Sources ───────────────────────────────────────────────────────────

        let wikiCapture = WebCapture(
            url: "https://en.wikipedia.org/wiki/Roman_Empire",
            pageTitle: "Roman Empire – Wikipedia",
            extractedContent: "The Roman Empire was the post-Republican period of ancient Rome. Its first two centuries are known as the Pax Romana, a period of relative peace and stability. At its peak under Trajan (98–117 AD), the Empire controlled approximately 5 million km² of land.",
            capturedAt: ago(55)
        )
        let wikiSource = ProjectSource(sourceType: .webpage, title: "Roman Empire – Wikipedia", createdAt: ago(55))
        wikiSource.webpage = wikiCapture; wikiSource.project = project
        wikiSource.processedAt = ago(55); wikiCapture.source = wikiSource
        context.insert(wikiCapture); context.insert(wikiSource)

        let rubiconNote = ProjectNote(
            title: "The Rubicon — Caesar's Decisive Moment",
            content: """
            # The Rubicon — Caesar's Decisive Moment

            ## Background
            [[Julius Caesar]] crossed the Rubicon on January 10, 49 BC with a single legion (XIII Gemina).

            - Under Roman law, a general was forbidden from entering Italy proper with his army
            - The Rubicon marked the boundary between Cisalpine Gaul and Italy
            - Crossing with an army was an act of war against the Senate

            ## Why He Did It
            The Senate, led by [[Pompey]], ordered Caesar to disband his army. Caesar faced:
            1. Comply → certain prosecution and political death
            2. Cross → civil war, but with a loyal, battle-hardened army

            In his own words: *"Alea iacta est"* — "The die is cast."

            ## Consequences
            - Triggered the Roman Civil War (49–45 BC)
            - Caesar emerged victorious; became Dictator Perpetuo
            - His assassination in 44 BC led to end of the Republic

            ## Linked concepts
            - [[Pompey]] — his nemesis and former ally
            - [[Senate of Rome]]
            - [[Augustus]] — who inherited the chaos and built the Empire
            """,
            noteType: .manual,
            tags: ["rome", "caesar", "civil-war", "republic"]
        )
        let rubiconSource = ProjectSource(sourceType: .note, title: "The Rubicon — Caesar's Decisive Moment", createdAt: ago(50))
        rubiconSource.note = rubiconNote; rubiconSource.project = project
        rubiconSource.processedAt = ago(50); rubiconNote.source = rubiconSource
        context.insert(rubiconNote); context.insert(rubiconSource)

        // ── Chat Session ──────────────────────────────────────────────────────

        let chat = ChatSession(
            title: "Why did the Roman Republic collapse?",
            createdAt: ago(45), updatedAt: ago(45)
        )
        chat.project = project

        let ru1 = Message(content: "What were the key reasons the Roman Republic collapsed into Empire?", role: .user, timestamp: ago(45))
        let ra1 = Message(content: """
        The fall of the Republic (roughly 133–27 BC) was a slow-motion constitutional crisis. Several interlocking factors drove it:

        **1. Professional armies loyal to commanders, not Rome**
        Marius's reforms (107 BC) opened the legions to landless volunteers who depended on their *general* for land grants. Soldiers followed Marius, Sulla, Caesar — not the Senate.

        **2. Breakdown of the cursus honorum**
        The traditional ladder of magistracies (quaestor → aedile → praetor → consul) kept ambition structured. When ambitious men bypassed it via military force or popular tribunes, the unwritten rules that held the system together dissolved.

        **3. Economic inequality and the Gracchi**
        The Gracchi brothers (133 & 123 BC) pushed land reform to help displaced farmers. When Tiberius Gracchus was murdered on the Senate floor, it proved that political violence had entered Roman life — and it never left.

        **4. Caesar's final act**
        Crossing the Rubicon in 49 BC was the coup de grâce. The civil war that followed ended with his dictatorship. His assassination in 44 BC didn't restore the Republic — it triggered another civil war that ended with Augustus outmanoeuvring everyone.
        """, role: .assistant, timestamp: ago(45))

        let cit3 = Citation(
            sourceID: wikiSource.id.uuidString, sourceTitle: "Roman Empire – Wikipedia",
            sourceType: "webpage",
            excerpt: "The Roman Empire was the post-Republican period of ancient Rome...",
            relevanceScore: 0.82
        )
        let cit4 = Citation(
            sourceID: rubiconSource.id.uuidString, sourceTitle: "The Rubicon — Caesar's Decisive Moment",
            sourceType: "note",
            excerpt: "Caesar crossed the Rubicon on January 10, 49 BC with a single legion...",
            relevanceScore: 0.91
        )
        ra1.citations = [cit3, cit4]; cit3.message = ra1; cit4.message = ra1

        ru1.chatSession = chat; ra1.chatSession = chat
        chat.messages = [ru1, ra1]
        context.insert(chat); context.insert(ru1); context.insert(ra1)
        context.insert(cit3); context.insert(cit4)

        // ── Concepts ──────────────────────────────────────────────────────────

        let cCaesar    = ConceptNode(name: "Julius Caesar", description: "Roman general and statesman; played a critical role in the fall of the Republic. Crossed the Rubicon 49 BC; assassinated 44 BC.", nodeType: .person)
        let cAugustus  = ConceptNode(name: "Augustus", description: "First Roman Emperor (27 BC–14 AD). Transformed the Republic into the Principate while maintaining republican forms.", nodeType: .person)
        let cPompey    = ConceptNode(name: "Pompey", description: "Roman general; Caesar's ally turned enemy. Defeated at Pharsalus (48 BC).", nodeType: .person)
        let cSenate    = ConceptNode(name: "Senate of Rome", description: "Governing body of the Roman Republic and early Empire. Composed of the highest-property class.", nodeType: .topic)
        let cPaxRomana = ConceptNode(name: "Pax Romana", description: "~200 years of relative peace (27 BC–180 AD), beginning with Augustus.", nodeType: .definition)
        let cLegion    = ConceptNode(name: "Roman Legion", description: "The basic military unit of Rome. ~5,000 heavy infantry. Professionalised under Marius's reforms.", nodeType: .topic)
        let cRepublic  = ConceptNode(name: "Roman Republic", description: "Period of ancient Rome from 509 BC to 27 BC, governed by elected magistrates and the Senate.", nodeType: .topic)

        for node in [cCaesar, cAugustus, cPompey, cSenate, cPaxRomana, cLegion, cRepublic] {
            node.project = project; context.insert(node)
        }

        let rLinks: [(ConceptNode, ConceptNode, ConceptLinkType)] = [
            (cCaesar,    cRepublic,   .related),
            (cAugustus,  cRepublic,   .related),
            (cPompey,    cCaesar,     .related),
            (cCaesar,    cSenate,     .related),
            (cAugustus,  cPaxRomana,  .exemplifies),
            (cLegion,    cCaesar,     .related),
            (cRepublic,  cSenate,     .partOf),
        ]
        for (src, tgt, type) in rLinks {
            let link = ConceptLink(source: src, target: tgt, linkType: type, strength: 0.8)
            src.outgoingLinks.append(link); tgt.incomingLinks.append(link)
            context.insert(link)
        }

        // ── Flashcards ────────────────────────────────────────────────────────

        let rCards: [(String, String, Int, Int)] = [
            ("When did Caesar cross the Rubicon and why was it significant?", "January 49 BC. Crossing with an army violated Roman law, triggering civil war and effectively ending the Republic's constitutional order.", 2, 0),
            ("What were Marius's military reforms?", "107 BC: opened the military to landless citizens. Soldiers became loyal to commanders who promised land grants — not to the state.", 4, 7),
            ("Who were the Gracchi brothers?", "Tiberius (133 BC) and Gaius (123 BC) — tribunes who tried to redistribute public land. Both were murdered by political opponents.", 3, 3),
            ("What is the Pax Romana?", "~200 years of relative peace and stability (27 BC–180 AD) across the Roman Empire, beginning with Augustus.", 2, 0),
            ("What title did Augustus use instead of 'King'?", "Princeps ('first citizen'). Also held tribunicia potestas and imperium proconsulare — total authority without appearing to be a monarch.", 4, 5),
            ("What was the cursus honorum?", "The traditional sequence of Roman magistracies: quaestor → aedile → praetor → consul. It regulated political ambition during the Republic.", 3, 1),
            ("When did the Western Roman Empire fall, and to whom?", "476 AD, when the Germanic leader Odoacer deposed Romulus Augustulus, the last Western Roman Emperor.", 2, 0),
        ]
        for (i, (front, back, diff, nextOffset)) in rCards.enumerated() {
            let card = LearningCard(front: front, back: back, cardType: .basic, difficulty: diff)
            card.project = project
            card.interval = [1, 2, 4, 7][i % 4]
            card.nextReviewDate = inDays(nextOffset)
            card.totalReviews = max(0, 3 - i % 3)
            card.correctReviews = max(0, 2 - i % 3)
            context.insert(card)
        }

        // ── Daily Notes ───────────────────────────────────────────────────────

        let rDailyData: [(Int, String, String, Int)] = [
            (5, "# Roman History Day 1\nStarted with the founding myths and the early Republic. The system of two consuls elected annually — each with veto power over the other — is a fascinating design for preventing tyranny.", "curious", 7),
            (3, "# The Punic Wars\nSpent the morning on Carthage. Three wars, ~120 years. Hannibal crossing the Alps with elephants is still one of history's great military gambits. Rome's persistence despite Cannae (216 BC) is remarkable.", "focused", 8),
            (1, "# Caesar's Civil War\nRead through the Rubicon crossing in detail. 'The die is cast' is so good. The political analysis — why he had no choice — makes it feel less like hubris and more like a calculated survival decision.", "excited", 9),
        ]
        for (daysAgo, content, mood, productivity) in rDailyData {
            let dn = DailyNote(date: ago(daysAgo), content: content, mood: mood, productivity: productivity)
            dn.project = project
            dn.completedTasks = ["Read chapter", "Update flashcards"]
            dn.learningHighlights = ["New concept linked in graph"]
            context.insert(dn)
        }
    }

    // MARK: - Global Templates

    private static func seedTemplates(into context: ModelContext) {
        let paperReview = NoteTemplate(
            name: "Paper Review",
            description: "Template for annotating academic papers",
            content: """
            # Paper Review: {{title}}
            **Date:** {{date}}
            **Authors:**
            **Venue:**

            ## Summary


            ## Key Contributions
            1.
            2.
            3.

            ## Methodology


            ## Results & Evidence


            ## Limitations


            ## My Take


            ## Connections to my knowledge
            - [[]]
            - [[]]
            """,
            category: .learning,
            isBuiltIn: false,
            tags: ["academic", "research"],
            variables: ["title", "date"]
        )

        let weeklyReview = NoteTemplate(
            name: "Weekly Review",
            description: "End-of-week reflection and planning",
            content: """
            # Weekly Review — Week of {{date}}

            ## What I Accomplished
            -

            ## What I Learned
            -

            ## What Didn't Go Well
            -

            ## Top 3 Priorities for Next Week
            1.
            2.
            3.

            ## How I'm Feeling
            Energy level (1–10):
            Mood:

            ## Random Thoughts

            """,
            category: .retrospective,
            isBuiltIn: false,
            tags: ["review", "reflection"],
            variables: ["date"]
        )

        context.insert(paperReview)
        context.insert(weeklyReview)
    }
}
