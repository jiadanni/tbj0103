import json
import re
import hashlib
from pathlib import Path

def clean_text(text, max_len=320):
    if not text:
        return ""
    lines = [line.strip() for line in text.splitlines() if line.strip() and not line.startswith("```")]
    cleaned = " ".join(lines)
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len-3] + "..."
    return cleaned

def clean_title(title):
    title = re.sub(r'^(how to|what is|explain|difference between|how do|understanding)\s+', '', title, flags=re.IGNORECASE)
    return title.strip().capitalize()

def calculate_difficulty_and_level(front, back, topic, combined):
    """
    Score difficulty 1-5 and assign standard software engineering personas:
      1: Novice (Syntax, basic operations, fundamental definitions)
      2: Junior (Standard APIs, basic patterns, common data structures)
      3: Intermediate (Design patterns, concurrency, state, caching, migrations)
      4: Staff / Lead (System architecture, trade-offs, security, distributed systems)
      5: Principal / Fellow (Zero-downtime scale, compiler/runtime internals, deep resilience)
    """
    t = combined.lower()
    text_len = len(front) + len(back)

    # 5: Principal / Fellow
    principal_terms = [
        'zero-downtime', 'cap theorem', 'raft', 'paxos', 'saga pattern', 'cqrs',
        'event sourcing', 'virtual thread', 'project loom', 'jit', 'hotspot',
        'garbage collection cyclic', 'cpython memory', 'btree internals',
        'sharding key', 'microservices trade-off', 'wal log', 'distributed consensus',
        'memory model', 'atomic', 'memory safety without a garbage collector',
        'high-concurrency', 'zero-cost abstraction', 'lock-free', 'kernel'
    ]
    if any(k in t for k in principal_terms):
        return 5, "Principal / Fellow"

    # 4: Staff / Lead
    staff_terms = [
        'architecture', 'circuit breaker', 'event-driven', 'microservices', 'strangler fig',
        'read-heavy', 'write-heavy', 'kubernetes', 'terraform', 'infrastructure as code',
        'dora', 'observability', 'csrf', 'xss', 'jwt', 'oauth', 'acid', 'isolation level',
        'phantom read', 'security risk', 'vulnerability', 'distributed', 'scalability',
        'high availability', 'load balancer', 'failover', 'monolith vs', 'disaster recovery'
    ]
    if any(k in t for k in staff_terms):
        return 4, "Staff / Lead"

    # 3: Intermediate
    intermediate_terms = [
        'solid', 'design pattern', 'strategy', 'adapter', 'observer', 'factory',
        'asyncio', 'decorator', 'usememo', 'usecallback', 'reconciliation', 'fiber',
        'stream api', 'reentrantlock', 'b-tree', 'n+1', 'multi-stage', 'git bisect',
        'git reflog', 'tdd', 'testing pyramid', 'concurrency', 'multithreading',
        'transaction', 'migration', 'indexing', 'refactoring', 'code smell',
        'context manager', 'lifetime', 'trait', 'smart pointer', 'mutex', 'props drilling'
    ]
    if any(k in t for k in intermediate_terms):
        return 3, "Intermediate"

    # 2: Junior
    junior_terms = [
        'list comprehension', 'generator', 'hashmap', 'dict', 'interface', 'class',
        'props', 'state', 'select', 'join', 'dockerfile', 'branch', 'merge',
        'cherry-pick', 'status code', 'rest api', 'http', 'query', 'table',
        'regex', 'script', 'endpoint', 'json', 'payload', 'parameter', 'argument',
        'slice', 'tuple', 'set', 'inheritance', 'polymorphism', 'exception', 'try', 'catch'
    ]
    if any(k in t for k in junior_terms) or text_len > 250:
        return 2, "Junior"

    # 1: Novice
    return 1, "Novice"

def generate_1000_se_deck():
    with open('Samples/2026-07-18/conversations.json', 'r') as f:
        conversations = json.load(f)

    workspaces_config = [
        ('ws-se-arch-001', '🏗️ Software Architecture & System Design', ['architecture', 'microservice', 'monolith', 'system design', 'cqrs', 'event-driven', 'saga', 'gateway', 'cap theorem', 'scalability', 'distributed', 'load balancer', 'performance', 'latency']),
        ('ws-se-patterns-002', '🧩 Design Patterns & Refactoring', ['design pattern', 'solid', 'gof', 'factory', 'singleton', 'observer', 'strategy', 'decorator', 'adapter', 'refactoring', 'code smell', 'principle', 'clean code', 'oop', 'class']),
        ('ws-se-python-003', '🐍 Python Engineering & Async', ['python', 'asyncio', 'pandas', 'pytest', 'flask', 'django', 'pip', 'virtualenv', 'generator', 'comprehension', 'gil', 'lambda', 'script']),
        ('ws-se-rust-004', '🦀 Rust & Systems Programming', ['rust', 'cargo', 'tokio', 'ownership', 'borrowing', 'lifetime', 'trait', 'smart pointer', 'mutex', 'serde', 'clippy']),
        ('ws-se-java-005', '☕ Java & Enterprise Architecture', ['java', 'spring', 'jvm', 'hibernate', 'maven', 'gradle', 'stream api', 'jackson', 'autowired', 'bean', 'corretto', 'sdkman', 'jarvis']),
        ('ws-se-react-006', '⚛️ React, TypeScript & Web Frontend', ['react', 'typescript', 'javascript', 'js', 'ts', 'vite', 'next', 'redux', 'zustand', 'css', 'html', 'dom', 'component', 'hook', 'props', 'amd']),
        ('ws-se-db-007', '🗄️ Databases, SQL & Data Modeling', ['sql', 'database', 'postgres', 'mysql', 'sqlite', 'mongodb', 'redis', 'orm', 'index', 'migration', 'acid', 'transaction', 'datagrip', 'query']),
        ('ws-se-devops-008', '🐳 DevOps, Docker & Cloud Infra', ['docker', 'kubernetes', 'k8s', 'aws', 'cloud', 'terraform', 'ci/cd', 'github actions', 'nginx', 'bash', 'shell', 'linux', 'daemon', 'credential']),
        ('ws-se-git-009', '🛠️ Git, Tooling & Software Craftsmanship', ['git', 'github', 'gitlab', 'vs code', 'ide', 'lint', 'commit', 'branch', 'merge', 'rebase', 'pr', 'repository', 'ignore', 'head']),
        ('ws-se-security-010', '🛡️ Web Security, API Design & Testing', ['security', 'xss', 'csrf', 'jwt', 'oauth', 'auth', 'rest', 'graphql', 'grpc', 'api', 'http', 'testing', 'unit test', 'integration test', 'vulnerability', 'cybersecurity', 'coverage'])
    ]

    cards_per_ws = {ws[0]: [] for ws in workspaces_config}
    seen_fronts = set()

    for c in conversations:
        title = c.get('name', '').strip()
        msgs = c.get('chat_messages', [])
        
        for i in range(len(msgs)-1):
            m1, m2 = msgs[i], msgs[i+1]
            if isinstance(m1, dict) and m1.get('sender') == 'human' and isinstance(m2, dict) and m2.get('sender') == 'assistant':
                q_text = m1.get('text', '').strip()
                a_text = m2.get('text', '').strip()

                if not q_text or not a_text or 'not supported' in a_text or len(a_text) < 25:
                    continue

                if len(q_text) <= 140:
                    front = q_text
                elif title and len(title) <= 90:
                    front = f"What is the key explanation for '{clean_title(title)}'?"
                else:
                    front = clean_text(q_text, 110)
                    if not front.endswith('?'):
                        front += '?'

                if front in seen_fronts:
                    continue

                back = clean_text(a_text, 350)
                if len(back) < 25:
                    continue

                combined = (title + ' ' + q_text + ' ' + a_text[:200]).lower()

                # Find matching workspace
                matched_ws_ids = []
                for ws_id, ws_name, keywords in workspaces_config:
                    if any(kw in combined for kw in keywords):
                        matched_ws_ids.append(ws_id)

                if not matched_ws_ids:
                    matched_ws_ids = ['ws-se-git-009', 'ws-se-arch-001']

                matched_ws_ids.sort(key=lambda wid: len(cards_per_ws[wid]))
                chosen_ws_id = matched_ws_ids[0]

                if len(cards_per_ws[chosen_ws_id]) < 110:
                    seen_fronts.add(front)
                    topic = title[:40] if title else "Software Engineering"
                    card_id = 'card-' + hashlib.md5((chosen_ws_id + front).encode('utf-8')).hexdigest()[:12]
                    
                    difficulty_score, level_label = calculate_difficulty_and_level(front, back, topic, combined)

                    cards_per_ws[chosen_ws_id].append({
                        'id': card_id,
                        'kind': 'flashcard',
                        'front': front,
                        'back': back,
                        'topic': topic,
                        'workspace_id': chosen_ws_id,
                        'difficulty': difficulty_score,
                        'difficulty_preset': 'software_engineering',
                        'difficulty_label': level_label
                    })

    # Collect round-robin across workspaces to maintain balanced 1000 cards
    all_cards = []
    max_count = max(len(cards_per_ws[wid]) for wid in cards_per_ws)

    for i in range(max_count):
        for ws_id, ws_name, keywords in workspaces_config:
            if i < len(cards_per_ws[ws_id]):
                all_cards.append(cards_per_ws[ws_id][i])
                if len(all_cards) == 1000:
                    break
        if len(all_cards) == 1000:
            break

    workspaces = []
    for ws_id, ws_name, keywords in workspaces_config:
        workspaces.append({
            'id': ws_id,
            'name': ws_name,
            'card_count': sum(1 for c in all_cards if c['workspace_id'] == ws_id),
            'preset': 'software_engineering'
        })

    deck = {
        "format": "aetherium.boomscroll.deck",
        "version": 3,
        "exported_at": "2026-08-16T16:04:00Z",
        "card_count": len(all_cards),
        "workspaces": workspaces,
        "cards": all_cards
    }

    output_path = Path('boomscroll/public/my_deck.json')
    output_path.write_text(json.dumps(deck, indent=2))
    print(f"Successfully generated calibrated v3 deck with {len(all_cards)} cards across {len(workspaces)} workspaces in {output_path}!")

if __name__ == '__main__':
    generate_1000_se_deck()
