import json
import hashlib

def main():
    # Load existing demo deck
    with open('boomscroll/public/demo.json', 'r') as f:
        deck = json.load(f)

    # Define Software Engineering Workspaces
    se_workspaces = [
        {
            'id': 'ws-se-arch-001',
            'name': '🏗️ Software Architecture & System Design',
            'card_count': 0
        },
        {
            'id': 'ws-se-patterns-002',
            'name': '🧩 Design Patterns & Refactoring',
            'card_count': 0
        },
        {
            'id': 'ws-se-python-003',
            'name': '🐍 Python Engineering & Mastery',
            'card_count': 0
        },
        {
            'id': 'ws-se-rust-004',
            'name': '🦀 Rust & Systems Performance',
            'card_count': 0
        },
        {
            'id': 'ws-se-java-005',
            'name': '☕ Java & Enterprise Architecture',
            'card_count': 0
        },
        {
            'id': 'ws-se-react-006',
            'name': '⚛️ React & Modern Frontend',
            'card_count': 0
        },
        {
            'id': 'ws-se-db-007',
            'name': '🗄️ Databases & Data Modeling',
            'card_count': 0
        },
        {
            'id': 'ws-se-devops-008',
            'name': '🐳 DevOps, Docker & Cloud Infra',
            'card_count': 0
        },
        {
            'id': 'ws-se-git-009',
            'name': '🛠️ Git & Software Craftsmanship',
            'card_count': 0
        },
        {
            'id': 'ws-se-security-010',
            'name': '🛡️ Web Security & Testing Strategies',
            'card_count': 0
        }
    ]

    # Add missing workspaces
    existing_ws_ids = {w['id'] for w in deck['workspaces']}
    for w in se_workspaces:
        if w['id'] not in existing_ws_ids:
            deck['workspaces'].append(w)

    cards_data = [
        # --- 1. Software Architecture & System Design ---
        ('ws-se-arch-001', 'Architectural Patterns', 'What is the primary trade-off of Microservices vs Monolith?', 'Monoliths prioritize deployment simplicity and transactional consistency. Microservices trade operational complexity for independent scalability, decoupled stacks, and team autonomy.'),
        ('ws-se-arch-001', 'Architectural Patterns', 'What is Event-Driven Architecture (EDA)?', 'A design where decoupled services communicate asynchronously by emitting and consuming events through message brokers (Kafka/RabbitMQ), improving fault isolation and throughput.'),
        ('ws-se-arch-001', 'System Design', 'What is CQRS (Command Query Responsibility Segregation)?', 'Separates write operations (Commands) from read operations (Queries) into distinct models/databases, optimizing read performance and write throughput independently.'),
        ('ws-se-arch-001', 'System Design', 'What is Event Sourcing?', 'Persisting state changes as an immutable sequence of events rather than saving only current state. Replaying events reconstructs past states and provides auditability.'),
        ('ws-se-arch-001', 'Scalability', 'Explain the CAP Theorem in Distributed Systems.', 'A distributed system can guarantee at most two of three properties simultaneously: Consistency (all nodes see same data), Availability (every request receives response), Partition Tolerance (system functions despite network drops).'),
        ('ws-se-arch-001', 'Scalability', 'What is the difference between Vertical and Horizontal Scaling?', 'Vertical scaling (scaling up) adds resources (RAM/CPU) to a single machine. Horizontal scaling (scaling out) adds more machine instances behind a load balancer.'),
        ('ws-se-arch-001', 'System Design', 'What is the Saga Pattern in Microservices?', 'Manages distributed transactions across microservices as a sequence of local transactions. If a step fails, compensation transactions roll back preceding changes.'),
        ('ws-se-arch-001', 'System Design', 'What is the API Gateway pattern?', 'A single entry point that routes client requests to appropriate downstream microservices, handling cross-cutting concerns like authentication, rate limiting, and SSL termination.'),
        ('ws-se-arch-001', 'System Design', 'What is the Strangler Fig Pattern?', 'Incrementally refactoring a legacy monolithic application by replacing specific functional modules with microservices until the monolith can be safely decommissioned.'),
        ('ws-se-arch-001', 'System Design', 'Explain Read-Heavy vs Write-Heavy system optimizations.', 'Read-heavy systems leverage caching (Redis), CDNs, and read replicas. Write-heavy systems utilize write-ahead logs, message queues, and LSM-tree databases (Cassandra/RocksDB).'),

        # --- 2. Design Patterns & Refactoring ---
        ('ws-se-patterns-002', 'SOLID Principles', 'What does the Single Responsibility Principle (SRP) dictate?', 'A class or module should have one, and only one, reason to change, meaning it should fulfill a single focused responsibility.'),
        ('ws-se-patterns-002', 'SOLID Principles', 'Explain the Open/Closed Principle (OCP).', 'Software entities (classes, modules) should be open for extension (via polymorphism or interfaces) but closed for modification of existing source code.'),
        ('ws-se-patterns-002', 'SOLID Principles', 'What is Liskov Substitution Principle (LSP)?', 'Subtypes must be substitutable for their base types without altering correctness or breaking contract expectations of the program.'),
        ('ws-se-patterns-002', 'SOLID Principles', 'What is Interface Segregation Principle (ISP)?', 'Clients should not be forced to depend on interfaces they do not use. Prefer fine-grained, role-specific interfaces over bloated monolithic ones.'),
        ('ws-se-patterns-002', 'SOLID Principles', 'What is Dependency Inversion Principle (DIP)?', 'High-level business modules should not depend on low-level implementation details; both should depend on abstractions (interfaces).'),
        ('ws-se-patterns-002', 'Behavioral Patterns', 'How does the Strategy Pattern work?', 'Encapsulates algorithms into interchangeable classes sharing a common interface, allowing dynamic runtime behavior switching without altering client code.'),
        ('ws-se-patterns-002', 'Resilience Patterns', 'What problem does the Circuit Breaker Pattern solve?', 'Prevents cascading system failures by tripping open when downstream calls fail repeatedly, returning instant fallback responses while allowing periodic recovery checks.'),
        ('ws-se-patterns-002', 'Creational Patterns', 'What is the Factory Method Pattern?', 'Defines an interface for creating objects, delegating instantiation logic to subclasses based on runtime arguments or configuration.'),
        ('ws-se-patterns-002', 'Structural Patterns', 'What is the Adapter Pattern?', 'Converts the interface of a class into another interface expected by clients, enabling incompatible interfaces to collaborate seamlessly.'),
        ('ws-se-patterns-002', 'Behavioral Patterns', 'What is the Observer Pattern?', 'Establishes a one-to-many dependency where subjects notify registered subscriber objects automatically whenever state changes occur.'),

        # --- 3. Python Engineering & Mastery ---
        ('ws-se-python-003', 'Python Internals', 'What is the Global Interpreter Lock (GIL) in CPython?', 'A mutex that prevents multiple native threads from executing Python bytecode simultaneously, protecting CPython memory management but limiting multithreaded CPU-bound parallelism.'),
        ('ws-se-python-003', 'Python Internals', 'How do Python Decorators `@decorator` work?', 'Decorators are higher-order functions that accept a function object, wrap/augment its execution behavior, and return the modified callable.'),
        ('ws-se-python-003', 'Python Memory', 'How does Python handle Memory Management & Garbage Collection?', 'Uses reference counting as the primary mechanism, supplemented by a cyclic garbage collector to detect and reclaim reference cycles.'),
        ('ws-se-python-003', 'Python Fundamentals', 'Difference between Generators and List Comprehensions?', 'List comprehensions evaluate immediately and store the full result in memory. Generators evaluate lazily, yielding items one-by-one via iterators to save RAM.'),
        ('ws-se-python-003', 'Python Concurrency', 'How does Python `asyncio` event loop work?', 'A single-threaded cooperative event loop that executes tasks, pausing at `await` yield points to run other pending I/O tasks while waiting for non-blocking I/O operations.'),
        ('ws-se-python-003', 'Python OOP', 'What is the difference between `__str__` and `__repr__`?', '`__str__` provides a readable, user-friendly string representation. `__repr__` yields an unambiguous, developer-focused representation (ideally valid Python code).'),
        ('ws-se-python-003', 'Python Datastructures', 'Why are Python dictionaries deterministic in insertion order since Python 3.7?', 'Dicts use a compact array of indices pointing to a key-value hash table array, preserving insertion order as a side effect of memory optimization.'),
        ('ws-se-python-003', 'Python Advanced', 'What are `*args` and `**kwargs` in Python functions?', '`*args` gathers positional arguments into a tuple. `**kwargs` collects keyword arguments into a dictionary, enabling flexible parameter signatures.'),
        ('ws-se-python-003', 'Python Advanced', 'What is Context Manager (`with` statement) and `__enter__`/`__exit__`?', 'Guarantees resource setup and teardown (e.g. closing files or releasing locks) regardless of whether exceptions occur inside the block.'),
        ('ws-se-python-003', 'Python Performance', 'When should you use `slots` in Python classes?', '`__slots__` explicitly declares instance attributes, preventing dynamic `__dict__` creation to significantly reduce memory footprint when instantiating millions of objects.'),

        # --- 4. Rust & Systems Performance ---
        ('ws-se-rust-004', 'Rust Core', 'How does Rust guarantee memory safety without a Garbage Collector?', 'Through Ownership rules enforced at compile time: each value has one owner, and borrowing allows either multiple immutable references OR one mutable reference at a time.'),
        ('ws-se-rust-004', 'Rust Error Handling', 'How does `Result<T, E>` and the `?` operator work in Rust?', '`Result` is an enum representing `Ok(T)` or `Err(E)`. The `?` operator unwraps `Ok` values or early-returns `Err` to caller functions cleanly.'),
        ('ws-se-rust-004', 'Rust Concurrency', 'What do `Send` and `Sync` traits signify in Rust?', '`Send` indicates a type can safely transfer ownership across thread boundaries. `Sync` means immutable references (`&T`) can be safely shared across multiple threads.'),
        ('ws-se-rust-004', 'Rust Memory', 'What is the difference between `String` and `&str` in Rust?', '`String` is an owned, heap-allocated, growable UTF-8 string buffer. `&str` is an immutable string slice borrowing view into string data.'),
        ('ws-se-rust-004', 'Rust Lifetimes', 'What are Lifetime Annotations (`\'a`) in Rust?', 'Compile-time generic parameters indicating to the borrow checker how long references remain valid, preventing dangling pointer references.'),
        ('ws-se-rust-004', 'Rust Smart Pointers', 'What is `Arc<Mutex<T>>` used for in Rust multithreading?', '`Arc` (Atomic Reference Counting) enables shared thread-safe ownership across threads, while `Mutex` provides mutual exclusion for thread-safe mutation.'),
        ('ws-se-rust-004', 'Rust Zero Cost', 'What does Zero-Cost Abstractions mean in Rust?', 'What you don\'t use, you don\'t pay for. High-level abstractions (iterators, closures) compile down to low-level assembly equivalent to hand-written C code.'),
        ('ws-se-rust-004', 'Rust Enums', 'How do Rust Enums differ from Java/C++ Enums?', 'Rust enums are algebraic data types (tagged unions) where variants can hold distinct embedded data payloads of varying types.'),
        ('ws-se-rust-004', 'Rust Macros', 'What is the difference between Declarative (`macro_rules!`) and Procedural Macros in Rust?', 'Declarative macros match AST patterns for syntax expansion. Procedural macros run arbitrary Rust code on input token streams to generate output code (e.g. `#[derive(Serialize)]`).'),
        ('ws-se-rust-004', 'Rust Performance', 'What is the role of `tokio` in async Rust?', 'An asynchronous runtime providing event loop, multi-threaded work-stealing task scheduler, and non-blocking network/IO primitives for high-concurrency systems.'),

        # --- 5. Java & Enterprise Architecture ---
        ('ws-se-java-005', 'Java Streams', 'How do Java 8+ Streams differ from Collections?', 'Collections are in-memory data structures storing elements. Streams are lazy computational pipelines processing data without storing underlying elements.'),
        ('ws-se-java-005', 'Java Memory', 'What is the JVM Heap structure (Young vs Old Generation)?', 'Young Gen (Eden + Survivor spaces) holds short-lived objects collected by minor GC. Old Gen holds long-surviving objects collected by major/full GC.'),
        ('ws-se-java-005', 'Spring Framework', 'What is Dependency Injection (DI) and Inversion of Control (IoC) in Spring?', 'Spring IoC container manages bean lifecycles and automatically injects dependencies via constructors or annotations (`@Autowired`), decoupling application components.'),
        ('ws-se-java-005', 'Java Concurrency', 'Difference between `synchronized` keyword and `ReentrantLock`?', '`synchronized` is implicit block-scoped locking. `ReentrantLock` offers explicit lock/unlock control, fairness policies, interruptible lock acquisition, and condition variables.'),
        ('ws-se-java-005', 'Java Concurrency', 'What are Java Virtual Threads (Project Loom)?', 'Lightweight JVM-managed user-mode threads mapping thousands of virtual threads onto few OS carrier threads, eliminating thread-per-request throughput bottlenecks.'),
        ('ws-se-java-005', 'Spring Boot', 'What is `@Transactional` annotation propagation in Spring?', 'Configures database transaction boundaries. Propagation rules (REQUIRED, REQUIRES_NEW, MANDATORY) control whether methods join existing transactions or open new ones.'),
        ('ws-se-java-005', 'Java Reflection', 'What are the risks of using Java Reflection (`java.lang.reflect`)?', 'Bypasses compile-time type safety, incurs CPU performance overhead, breaks encapsulation, and requires explicit SecurityManager / Module opens permissions in modern JDKs.'),
        ('ws-se-java-005', 'Java Collections', 'How does `HashMap` work internally in Java 8+?', 'Uses an array of buckets containing linked lists. When bucket collisions exceed a threshold (8 elements), linked lists convert into balanced Red-Black trees (`O(log n)` lookups).'),
        ('ws-se-java-005', 'Java Core', 'Difference between Abstract Classes and Interfaces in Java 8+?', 'Abstract classes support instance fields and constructor state. Interfaces define contract methods and can provide `default` and `static` implementations without instance state.'),
        ('ws-se-java-005', 'Java JVM', 'What is JIT (Just-In-Time) compilation in JVM HotSpot?', 'Monitors executing bytecode at runtime, compiling heavily executed hot code paths into optimized native machine code instructions dynamically.'),

        # --- 6. React & Modern Frontend ---
        ('ws-se-react-006', 'React Reconciliation', 'How does React Virtual DOM and Diffing Algorithm work?', 'React builds an in-memory virtual tree representation. Diffing reconciles old and new trees in `O(n)` time using element keys and component types to update real DOM selectively.'),
        ('ws-se-react-006', 'React Hooks', 'What are the rules of React Hooks?', 'Hooks must only be called at the top level of React function components or custom hooks, never inside loops, conditions, or nested functions.'),
        ('ws-se-react-006', 'React Performance', 'Difference between `useMemo` and `useCallback`?', '`useMemo` caches the calculated result of a expensive function computation. `useCallback` caches the function reference itself between renders.'),
        ('ws-se-react-006', 'React State', 'Why must State in React be treated as Immutable?', 'Immutability allows fast shallow reference comparison (`prevProps !== nextProps`) for render triggering, ensuring predictable state transitions and component re-renders.'),
        ('ws-se-react-006', 'React Architecture', 'What is Component Composition vs Prop Drilling?', 'Prop drilling passes state through intermediate unconcerned components. Composition passes components as children or slots (`props.children`), avoiding deep prop hierarchies.'),
        ('ws-se-react-006', 'React Hooks', 'How does `useEffect` cleanup function prevent memory leaks?', 'Returning a cleanup function from `useEffect` unsubscribes listeners, aborts pending HTTP fetch requests, or clears timers before component unmount or effect re-execution.'),
        ('ws-se-react-006', 'React Concurrent', 'What is React Fiber architecture?', 'A complete rewrite of React\'s core engine that breaks rendering work into incremental units, allowing the browser main thread to pause, prioritize, or abort render work.'),
        ('ws-se-react-006', 'Frontend Modules', 'Difference between ESM (ES Modules) and CommonJS?', 'ESM (`import`/`export`) evaluates dependencies statically at build time enabling tree-shaking. CommonJS (`require`/`module.exports`) resolves modules dynamically at runtime.'),
        ('ws-se-react-006', 'Modern CSS', 'What are Container Queries in modern CSS?', 'CSS rules that inspect the size/style of a parent container element rather than screen viewport dimensions, enabling modular component-level responsiveness.'),
        ('ws-se-react-006', 'Browser APIs', 'What is the event loop task queue vs microtask queue in JavaScript?', 'Microtasks (Promises, MutationObserver) execute immediately after current script completion before rendering. Macrotasks (`setTimeout`, I/O) run on subsequent loop iterations.'),

        # --- 7. Databases & Data Modeling ---
        ('ws-se-db-007', 'Database ACID', 'What do ACID properties stand for in Relational Databases?', 'Atomicity (all-or-nothing transactions), Consistency (valid schema state), Isolation (concurrent transaction safety), Durability (committed writes persist).'),
        ('ws-se-db-007', 'Database Indexing', 'How do B-Tree Indexes speed up SQL queries?', 'B-Trees maintain self-balancing sorted data structures allowing range queries and lookups in `O(log n)` time instead of `O(n)` full table scans.'),
        ('ws-se-db-007', 'Database Migrations', 'Explain the Expand-Contract Schema Migration pattern.', 'Phase 1 (Expand): Add new columns/tables side-by-side with old ones. Phase 2: Dual-write from app logic. Phase 3 (Contract): Remove deprecated legacy columns without downtime.'),
        ('ws-se-db-007', 'Database Isolation', 'What is Phantom Read vs Non-Repeatable Read in SQL transactions?', 'Non-repeatable read occurs when re-reading a row yields modified data. Phantom read occurs when re-executing a range query returns newly inserted rows.'),
        ('ws-se-db-007', 'Database Optimization', 'What is the N+1 Query Problem in ORMs?', 'Executing 1 query to fetch parent records, followed by N separate queries to fetch associated child records. Fixed using SQL `JOIN` or `IN(...)` batching.'),
        ('ws-se-db-007', 'NoSQL', 'Difference between Relational (RDBMS) and Document (MongoDB) Databases?', 'RDBMS enforces strict normalized schemas with SQL JOINs. Document DBs store flexible denormalized JSON structures optimized for horizontal scale and fast read access.'),
        ('ws-se-db-007', 'Database Indexing', 'What is a Composite Index and Index Prefix Rule in SQL?', 'An index on multiple columns `(A, B, C)`. Queries benefit from the index if filter conditions include leftmost index prefix columns (`A` or `A, B`).'),
        ('ws-se-db-007', 'Database Locking', 'Difference between Optimistic and Pessimistic Locking?', 'Pessimistic locking locks rows in DB upfront (`SELECT FOR UPDATE`). Optimistic locking checks version/timestamp columns during update, failing if modified.'),
        ('ws-se-db-007', 'Database Scaling', 'What is Database Sharding?', 'Horizontally partitioning database tables across independent DB instances based on a shard key (e.g. `user_id`), distributing storage and throughput load.'),
        ('ws-se-db-007', 'Database Performance', 'Why are WAL (Write-Ahead Logging) logs crucial for databases?', 'Changes are written sequentially to an immutable disk log before updating data pages, ensuring crash recovery durability and fast sequential write speeds.'),

        # --- 8. DevOps, Docker & Cloud Infra ---
        ('ws-se-devops-008', 'Docker Architecture', 'Difference between Docker Containers and Virtual Machines?', 'VMs virtualize hardware including a full Guest OS. Docker containers share the host OS kernel and isolate process namespaces, consuming vastly fewer resources.'),
        ('ws-se-devops-008', 'Docker Optimization', 'What is Multi-Stage Docker Builds?', 'Using multiple `FROM` statements in one Dockerfile to compile artifacts in a build stage, copying only minimal production binaries to tiny final scratch images.'),
        ('ws-se-devops-008', 'Container Orchestration', 'What are Kubernetes Pods?', 'The smallest deployable compute unit in Kubernetes, hosting one or more co-located containers sharing storage, network IP namespace, and port mappings.'),
        ('ws-se-devops-008', 'CI/CD Pipelines', 'Difference between Continuous Integration (CI) and Continuous Deployment (CD)?', 'CI automatically builds, tests, and validates code changes on commit. CD automatically deploys validated code artifacts into production environments.'),
        ('ws-se-devops-008', 'Cloud Infra', 'What is Infrastructure as Code (IaC) like Terraform?', 'Defining and provisioning cloud infrastructure (servers, VPCs, DBs) using declarative code files, enabling version control and repeatable automated deploys.'),
        ('ws-se-devops-008', 'Cloud Security', 'What is the Least Privilege Principle in IAM (AWS/GCP)?', 'Granting user accounts, roles, and automated service tokens only the minimum specific permissions required to perform designated tasks.'),
        ('ws-se-devops-008', 'Docker Storage', 'Difference between Docker Bind Mounts and Named Volumes?', 'Bind mounts map arbitrary absolute host directories into containers. Named volumes are fully managed by Docker engine on the host filesystem.'),
        ('ws-se-devops-008', 'Networking', 'What is Reverse Proxy vs Forward Proxy?', 'Forward proxy acts on behalf of clients (hiding client IP). Reverse proxy acts on behalf of servers (load balancing, caching, routing inbound requests).'),
        ('ws-se-devops-008', 'DevOps Metrics', 'What are DORA Metrics for software delivery performance?', 'Deployment Frequency, Lead Time for Changes, Change Failure Rate, and Time to Restore Service (MTTR).'),
        ('ws-se-devops-008', 'Observability', 'What are the Three Pillars of Observability?', 'Metrics (numeric aggregations over time), Logs (structured discrete event records), and Traces (end-to-end request flow paths across microservices).'),

        # --- 9. Git & Software Craftsmanship ---
        ('ws-se-git-009', 'Git Internals', 'How does Git store commit history internally?', 'Git stores objects in a DAG (Directed Acyclic Graph): Blobs (file contents), Trees (directories), Commits (pointers to root tree, metadata, parent commit hashes).'),
        ('ws-se-git-009', 'Git Workflows', 'Difference between Git Merge vs Git Rebase?', '`git merge` creates a non-destructive merge commit combining branches. `git rebase` rewrites history by replaying feature commits on top of target branch.'),
        ('ws-se-git-009', 'Git Commands', 'What is `git cherry-pick`?', 'Applies the exact changes introduced by specific existing commits from another branch onto your current working HEAD branch as new commits.'),
        ('ws-se-git-009', 'Git Diagnostics', 'What is `git bisect` and how does it locate bugs?', 'Uses binary search across commit history to quickly isolate the exact commit that introduced a bug or test regression.'),
        ('ws-se-git-009', 'Git Craftsmanship', 'What makes a clean atomic Git Commit?', 'A commit that contains a single logical unit of change with passing tests, allowing isolated reversion, cherry-picking, and clean code review.'),
        ('ws-se-git-009', 'Git Internals', 'What is Git Reflog (`git reflog`)?', 'Records every local movement of `HEAD` pointer, allowing recovery of deleted commits, lost rebased commits, or uncommitted branch states.'),
        ('ws-se-git-009', 'Code Review', 'What is the purpose of Git Hooks (`pre-commit`, `pre-push`)?', 'Custom executable scripts triggered automatically by Git lifecycle events to run linters, formatters, or unit test checks before commits/pushes succeed.'),
        ('ws-se-git-009', 'Software Quality', 'What is Technical Debt and how should it be managed?', 'Implied cost of additional rework caused by choosing expedient quick solutions over well-architected designs. Managed via continuous refactoring sprints.'),
        ('ws-se-git-009', 'Refactoring', 'What is Code Smell in Software Development?', 'Surface characteristics in code (e.g. huge classes, long parameter lists, duplicated logic) that indicate deeper architectural weaknesses or refactoring needs.'),
        ('ws-se-git-009', 'Software Craftsmanship', 'What is the Boy Scout Rule in coding?', 'Always leave the codebase cleaner than you found it—refactoring small bad smells whenever touching a module.'),

        # --- 10. Web Security & Testing Strategies ---
        ('ws-se-security-010', 'Web Security', 'What is Cross-Site Scripting (XSS) and how is it mitigated?', 'Attackers inject malicious client-side scripts executed by victim browsers. Mitigated via context-aware output encoding, Content Security Policy (CSP), and sanitized input.'),
        ('ws-se-security-010', 'Web Security', 'What is Cross-Site Request Forgery (CSRF)?', 'Forces authenticated user browsers to submit unauthorized HTTP requests to target applications. Mitigated using Anti-CSRF tokens and `SameSite=Strict` cookie flags.'),
        ('ws-se-security-010', 'Web Security', 'What is SQL Injection (SQLi) and how is it prevented?', 'Infecting database queries by injecting untrusted user input into dynamic SQL strings. Prevented using Parameterized Queries (Prepared Statements) or ORMs.'),
        ('ws-se-security-010', 'Testing Strategy', 'What is the Testing Pyramid concept?', 'A testing ratio strategy: large base of fast, cheap Unit Tests, fewer integration tests, and minimal slow, expensive End-to-End (E2E) UI tests.'),
        ('ws-se-security-010', 'Testing Strategy', 'Difference between Mocking, Stubbing, and Spying in Unit Tests?', 'Stubs return hardcoded canned data. Mocks expect and verify specific method calls/arguments. Spies record actual function interactions while wrapping real implementations.'),
        ('ws-se-security-010', 'Web Security', 'What is CORS (Cross-Origin Resource Sharing)?', 'A browser security mechanism using HTTP headers to restrict cross-origin HTTP requests initiated from scripts running in foreign domains.'),
        ('ws-se-security-010', 'Web Security', 'What is JWT (JSON Web Token) structure and security risks?', 'Consists of Header, Payload, and Signature encoded in Base64Url. Risks include storing sensitive secrets in payload, using algorithm `none`, and improper signature validation.'),
        ('ws-se-security-010', 'Web Security', 'What is Content Security Policy (CSP)?', 'An HTTP response header allowing site operators to restrict resources (JS, CSS, images) browsers are allowed to load for a given page, blocking inline XSS execution.'),
        ('ws-se-security-010', 'Testing Strategy', 'What is Test-Driven Development (TDD) cycle (Red-Green-Refactor)?', 'Write a failing unit test (Red), write minimal production code to pass the test (Green), then clean up and optimize code structure (Refactor).'),
        ('ws-se-security-010', 'Security Auth', 'What is OAuth 2.0 vs OpenID Connect (OIDC)?', 'OAuth 2.0 is an authorization framework delegating API resource permissions via Access Tokens. OIDC adds an authentication layer on top yielding ID Tokens for identity verification.')
    ]

    # Insert generated cards
    existing_card_ids = {c['id'] for c in deck['cards']}

    for ws_id, topic, front, back in cards_data:
        card_id = 'card-' + hashlib.md5((ws_id + front).encode('utf-8')).hexdigest()[:12]
        if card_id not in existing_card_ids:
            deck['cards'].append({
                'id': card_id,
                'kind': 'flashcard',
                'front': front,
                'back': back,
                'topic': topic,
                'workspace_id': ws_id
            })

    # Update card counts per workspace
    for ws in deck['workspaces']:
        ws['card_count'] = sum(1 for c in deck['cards'] if c['workspace_id'] == ws['id'])

    deck['card_count'] = len(deck['cards'])

    with open('boomscroll/public/my_deck.json', 'w') as f:
        json.dump(deck, f, indent=2)

    print(f'Successfully built extensive Software Engineering deck! Total Workspaces: {len(deck["workspaces"])}, Total Cards: {deck["card_count"]}')

if __name__ == '__main__':
    main()
