import Foundation

/// Provides pre-scripted AI responses for demo mode.
/// Responses are matched on simple keyword heuristics so users exploring any of the
/// three seeded projects get a plausible, contextual answer.
struct DemoResponseProvider {

    static func response(for prompt: String) -> String {
        let lower = prompt.lowercased()

        // ── Transformers / Attention ──────────────────────────────────────────
        if lower.contains("attention") || lower.contains("transformer") ||
           lower.contains("query") || lower.contains("key") || lower.contains("value") ||
           lower.contains("positional") || lower.contains("encoder") || lower.contains("decoder") ||
           lower.contains("multi-head") || lower.contains("self-attention") {
            return transformerResponse(for: lower)
        }

        // ── SaaS / Product ────────────────────────────────────────────────────
        if lower.contains("saas") || lower.contains("mrr") || lower.contains("churn") ||
           lower.contains("cac") || lower.contains("ltv") || lower.contains("mvp") ||
           lower.contains("startup") || lower.contains("metric") || lower.contains("product") ||
           lower.contains("launch") || lower.contains("customer") {
            return saasResponse(for: lower)
        }

        // ── Roman History ─────────────────────────────────────────────────────
        if lower.contains("roman") || lower.contains("rome") || lower.contains("caesar") ||
           lower.contains("augustus") || lower.contains("senate") || lower.contains("republic") ||
           lower.contains("empire") || lower.contains("legion") || lower.contains("rubicon") ||
           lower.contains("pompey") || lower.contains("pax romana") {
            return romanResponse(for: lower)
        }

        // ── Generic fallback ──────────────────────────────────────────────────
        return """
        That's a great question! In demo mode I'm using pre-scripted responses to show you \
        what Aetherium looks like in action — no Ollama installation required.

        In a real session your local model would analyse all of your uploaded sources, \
        find the most relevant passages using semantic search, and produce a grounded answer \
        with citations pointing back to the exact excerpt it drew from.

        Feel free to explore the Knowledge Graph, flip some flashcards, or check the \
        Learning Path to get a feel for how everything connects.
        """
    }

    // MARK: - Transformer responses

    private static func transformerResponse(for lower: String) -> String {
        if lower.contains("positional") {
            return """
            **Positional Encodings — why they matter**

            Transformers process all tokens in parallel rather than sequentially, which is \
            what makes them fast. But that also means they don't inherently know *"this token \
            came before that one"* — every position looks the same.

            To fix this, the original paper adds a **positional encoding vector** to each token \
            embedding before it enters the first layer. The encoding uses sinusoidal functions at \
            different frequencies:

            ```
            PE(pos, 2i)   = sin(pos / 10000^(2i/d_model))
            PE(pos, 2i+1) = cos(pos / 10000^(2i/d_model))
            ```

            **Why sinusoidal?**
            - The model can represent any relative offset as a linear transformation of the \
            encodings — useful for generalisation.
            - Values are always bounded between −1 and 1, so they can't distort the embeddings.
            - Works at lengths never seen during training, unlike learned position embeddings.

            Modern models (GPT, BERT) use *learned* embeddings instead, which tend to work \
            better in practice but don't generalise beyond the training context length.

            *[Source: "Attention is All You Need" — Vaswani et al., Section 3.5]*
            """
        }

        if lower.contains("multi-head") {
            return """
            **Multi-Head Attention**

            Rather than running attention once, the Transformer runs it **h times in parallel** \
            (h = 8 in the original paper), each on a *different learned projection* of Q, K, V.

            ```
            MultiHead(Q, K, V) = Concat(head_1, ..., head_h) · W_O
            where head_i = Attention(Q·W_i^Q, K·W_i^K, V·W_i^V)
            ```

            **Why is this useful?**
            Each head can specialise in a different kind of relationship:
            - One head might focus on **syntactic dependencies** (subject → verb agreement).
            - Another might track **coreference** ("he" referring to "Julius Caesar" three \
            sentences earlier).
            - Another might handle **positional proximity** patterns.

            With a single head, all those signals would be averaged together and muddied. \
            Multiple heads let the model attend to diverse aspects simultaneously.

            *[Source: "Attention is All You Need" — Vaswani et al., Section 3.2.2]*
            """
        }

        // Default transformer response
        return """
        **Scaled Dot-Product Attention — a soft database lookup**

        Think of attention as a *fuzzy search engine*. You have three inputs:
        - **Query (Q)** — what you're searching for
        - **Keys (K)** — the labels on each item in the database
        - **Values (V)** — the actual content of each item

        **The four steps:**
        1. Compute similarity between Q and every K using the dot product: Q · Kᵀ
        2. Scale by √d_k to prevent huge values that kill gradients
        3. Apply softmax → a probability distribution ("how much attention to each item")
        4. Multiply weights by V → a weighted average of all values

        The formula: `Attention(Q, K, V) = softmax(QKᵀ / √d_k) · V`

        **Self-attention vs cross-attention:**
        - *Self-attention* — Q, K, V all come from the same sequence. Each token can "look at" \
        every other token in the same sentence to build context.
        - *Cross-attention* — Q comes from the decoder, K and V from the encoder. This is how \
        the decoder "reads" the source sentence while generating each output token.

        *[Source: "Attention is All You Need" — Vaswani et al., Section 3.2.1]*
        """
    }

    // MARK: - SaaS responses

    private static func saasResponse(for lower: String) -> String {
        if lower.contains("churn") {
            return """
            **Understanding and reducing churn**

            Churn rate = (customers lost in period) ÷ (customers at start of period).

            A healthy monthly churn rate for SMB SaaS is **below 2%**. Above 5% is a red flag — \
            you're filling a leaky bucket. At 10% monthly churn your average customer stays only \
            ten months, and you need to replace your entire customer base every year just to \
            stand still.

            **The three most common churn causes:**
            1. **Failed onboarding** — users never reach the "aha moment". Fix: shorten \
            time-to-value, add in-app guidance.
            2. **Missing features** — they outgrow you. Fix: roadmap conversations with at-risk \
            accounts.
            3. **Budget cuts** — they can't afford it. Fix: flexible pricing tiers.

            **Metric to track alongside churn:** *Net Revenue Retention (NRR)*. If expansion \
            revenue from existing customers offsets churn, NRR > 100% — you can grow even with \
            some churn.

            *[Source: Baremetrics SaaS Metrics Dashboard]*
            """
        }

        if lower.contains("mrr") || lower.contains("arr") {
            return """
            **MRR — your financial heartbeat**

            **Monthly Recurring Revenue (MRR)** is the normalised, predictable monthly revenue \
            from all active subscriptions. Annual plans are divided by 12.

            **Why it matters more than total revenue:**
            - Strips out one-time payments and seasonal noise.
            - Makes month-over-month growth comparable.
            - Drives valuation: SaaS companies are often valued at 8–15× ARR.

            **MRR decomposition (the "MRR waterfall"):**
            ```
            New MRR      + from new customers this month
            Expansion MRR + from upsells / plan upgrades
            Churned MRR  − from cancellations
            Contraction MRR − from downgrades
            ─────────────────────────────────────────
            Net New MRR  = MRR change for the month
            ```

            Tracking expansion vs. churned MRR separately tells you whether your growth problem \
            is acquisition, retention, or upsell.

            *[Source: Baremetrics SaaS Metrics Dashboard]*
            """
        }

        // Default SaaS response
        return """
        **Key SaaS metrics to track from day one**

        **The launch trinity (track from day 1):**
        1. **Activation Rate** — % of signups who reach your "aha moment". Low activation = \
        onboarding problem, not a marketing problem.
        2. **Churn Rate** — % of customers who cancel each month. Target < 2% for SMB SaaS.
        3. **MRR** — Monthly Recurring Revenue. Your financial pulse.

        **Add these once you have 20+ customers:**
        4. **CAC** — total acquisition spend ÷ new customers. If it takes $500 to acquire a \
        customer who pays $20/month and churns after 6 months, you're underwater.
        5. **LTV** — Average Revenue Per User ÷ churn rate. The golden rule: **LTV ≥ 3× CAC**.
        6. **NPS** — Net Promoter Score. A quarterly "how likely are you to recommend us?" \
        survey. Score > 50 is excellent.

        At launch, activation and churn tell you whether your product *works*. Revenue metrics \
        tell you whether your *business* works.

        *[Source: Baremetrics SaaS Metrics Dashboard]*
        """
    }

    // MARK: - Roman history responses

    private static func romanResponse(for lower: String) -> String {
        if lower.contains("caesar") || lower.contains("rubicon") {
            return """
            **Julius Caesar and the Rubicon crossing (49 BC)**

            The Rubicon was a shallow river in northern Italy that marked the boundary between \
            the Roman province of **Cisalpine Gaul** and Italy proper. Roman law forbade any \
            general from crossing into Italy with his army — to do so was an act of war against \
            the Senate and the Roman people.

            **Why Caesar crossed:**
            The Senate, led by Pompey, had ordered Caesar to disband his army. Caesar faced an \
            impossible choice: comply and face certain prosecution (his enemies had charges ready), \
            or cross and fight. With his loyal veterans at his back, he crossed.

            His reported words: ***"Alea iacta est"*** — "The die is cast."

            **The aftermath:**
            - Caesar's army marched south; Pompey and the Senate fled Rome without a fight.
            - A three-year civil war followed, ending with Caesar as **Dictator Perpetuo**.
            - His assassination on the Ides of March (44 BC) did not restore the Republic — \
            it triggered another civil war that ended with Augustus becoming the first Emperor.

            *[Source: "The Rubicon — Caesar's Decisive Moment" — research notes]*
            """
        }

        if lower.contains("fall") || lower.contains("collapse") || lower.contains("476") {
            return """
            **Why did the Western Roman Empire fall?**

            Historians still debate this, but several interacting causes are well-established:

            **Military pressure:**
            - Successive waves of invaders (Visigoths, Vandals, Huns, Ostrogoths) stretched \
            the frontier beyond what the Empire could defend.
            - The army increasingly relied on Germanic *foederati* who owed loyalty to their \
            commanders, not to Rome.

            **Economic strain:**
            - Defending a 10,000 km frontier was ruinously expensive.
            - Debasement of the silver denarius caused inflation; trade contracted.
            - Tax burden crushed the farming class that fed the army.

            **Political fragmentation:**
            - The 3rd-century Crisis (235–284 AD) saw 50+ emperors in 50 years, most killed by \
            their own soldiers.
            - Diocletian split the Empire administratively (285 AD); it never truly reunified.

            **The conventional end date:** 476 AD, when the Germanic chieftain **Odoacer** deposed \
            the last Western Emperor, Romulus Augustulus. The Eastern Empire (Byzantine) continued \
            for another thousand years.

            *[Source: Roman Empire – Wikipedia]*
            """
        }

        // Default Roman response
        return """
        **The Roman Republic to Empire transition**

        The Republic (509–27 BC) operated on an unwritten constitution: power was shared between \
        elected magistrates and the Senate, with no single person allowed to hold too much for \
        too long. It worked for centuries — until it didn't.

        **Three systemic cracks that caused the Republic to fail:**

        1. **Professional armies loyal to commanders, not the state.** Marius's reforms (107 BC) \
        opened the legions to landless volunteers. Soldiers now depended on their general for \
        land grants at discharge — creating armies that followed *Marius*, *Sulla*, *Caesar*, \
        not Rome.

        2. **The cursus honorum collapsed.** The traditional ladder of offices kept ambition \
        structured. When generals used military force to bypass it, the system of checks \
        dissolved.

        3. **Economic inequality.** The Gracchi brothers tried to redistribute ager publicus \
        (public land illegally occupied by the rich). When Tiberius Gracchus was murdered on the \
        Senate floor in 133 BC, political violence entered Roman life and never left.

        Caesar's crossing of the Rubicon in 49 BC was the final act. Augustus's genius was \
        keeping all the Republican *forms* while concentrating all real power — a velvet \
        autocracy that lasted two centuries.

        *[Source: Roman Empire – Wikipedia; The Rubicon research notes]*
        """
    }
}
