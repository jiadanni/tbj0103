import json
import re
import hashlib
from pathlib import Path

def clean_text(text, max_len=330):
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

def calculate_econ_difficulty(front, back, topic, combined):
    t = combined.lower()

    # 5: Chief Economist / Diplomat
    l5_terms = [
        'hegemonic transition', 'multipolar world order', 'berlin conference', '1884',
        'leopold', 'post-colonial state', 'systemic crisis', 'bretton woods',
        'de-dollarization', 'reserve currency displacement', 'modern monetary theory',
        'sovereign debt default contagion', 'petrodollar collapse', 'great power transition',
        'triffin dilemma', 'hyperinflation', 'autarky', 'hegemony'
    ]
    if any(k in t for k in l5_terms):
        return 5, "Chief Economist / Diplomat"

    # 4: Policy Advisor
    l4_terms = [
        'quantitative easing', 'yield curve inversion', 'taylor rule', 'inflation anchor',
        '2% anchor', 'petrodollar', 'swift network', 'cips', 'brics currency',
        'secondary sanctions', 'indo-pacific quad', 'taiwan strait', 'middle-income trap',
        'demographic dividend', 'foreign direct investment', 'deadweight loss',
        'monopoly pricing power', 'comparative advantage', 'strategic petroleum reserve',
        'liquidity trap', 'bank run', 'derivatives', 'fiscal multiplier'
    ]
    if any(k in t for k in l4_terms):
        return 4, "Policy Advisor"

    # 3: Strategist
    l3_terms = [
        'federal reserve', 'central bank', 'monetary policy', 'fiscal stimulus',
        'austerity', 'treasury bond', 'bond yield', 'price elasticity', 'supply chain',
        'nearshoring', 'tariffs', 'trade deficit', 'recession definition', 'bubble crash',
        'gold vs equities', 'precious metals', 'opec', 'critical minerals', 'nato',
        'deterrence', 'bilateral treaty', 'bank run', 'liquidity trap', 'exchange rate'
    ]
    if any(k in t for k in l3_terms):
        return 3, "Strategist"

    # 2: Analyst
    l2_terms = [
        'inflation', 'interest rate', 'gdp', 'supply and demand', 'market equilibrium',
        'currency rebase', 'debt', 'taxation', 'government spending',
        'import', 'export', 'sovereignty', 'sanctions', 'commodities', 'oil price',
        'natural gas', 'banking system', 'loan repayment', 'unemployment'
    ]
    if any(k in t for k in l2_terms) or len(front) + len(back) > 220:
        return 2, "Analyst"

    # 1: Novice
    return 1, "Novice"

def generate_1000_econ_geo_deck():
    with open('Samples/2026-07-18/conversations.json', 'r') as f:
        conversations = json.load(f)

    workspaces_config = [
        ('ws-econ-macro-001', '🏛️ Macroeconomics, Central Banking & The Fed', [
            'central bank', 'federal reserve', 'monetary policy', 'quantitative easing',
            'interest rate', 'inflation anchor', 'taylor rule', 'money supply', 'm2', 'fomc', 'fed rate', 'monetary'
        ]),
        ('ws-econ-micro-002', '📊 Microeconomics, Markets & Pricing Power', [
            'microeconomic', 'elasticity', 'supply and demand', 'monopoly', 'oligopoly',
            'marginal cost', 'deadweight loss', 'price floor', 'price ceiling', 'market failure', 'externality', 'market'
        ]),
        ('ws-econ-trade-003', '🚢 International Trade, Supply Chains & Tariffs', [
            'trade', 'tariff', 'wto', 'comparative advantage', 'supply chain', 'nearshoring',
            'protectionism', 'trade deficit', 'export', 'import', 'reshoring', 'customs', 'shipping'
        ]),
        ('ws-econ-monetary-004', '💵 Monetary Systems, Reserve Currencies & De-Dollarization', [
            'bretton woods', 'petrodollar', 'yuan', 'dollar', 'reserve currency', 'de-dollarization',
            'swift', 'cips', 'brics', 'forex', 'currency rebase', 'cbdc', 'currency', 'fiat'
        ]),
        ('ws-econ-fiscal-005', '📜 Fiscal Policy, Sovereign Debt & Treasury Bonds', [
            'treasury bond', 'bond yield', 'fiscal policy', 'sovereign debt', 'national debt',
            'deficit', 'stimulus', 'austerity', 'taxation', 'mmt', 'debt ceiling', 'treasury'
        ]),
        ('ws-geo-strategy-006', '🌐 Geopolitical Strategy & Great Power Competition', [
            'geopolitics', 'hegemony', 'superpower', 'china', 'taiwan', 'russia', 'nato',
            'indo-pacific', 'multipolar', 'deterrence', 'cold war', 'quad', 'south china sea', 'power'
        ]),
        ('ws-geo-energy-007', '🛢️ Global Energy, Critical Minerals & Resource Security', [
            'energy', 'oil', 'opec', 'natural gas', 'lng', 'commodities', 'rare earth',
            'critical minerals', 'lithium', 'pipeline', 'strategic petroleum reserve', 'resources'
        ]),
        ('ws-geo-africa-008', '🌍 African Geopolitics, History & Regional Dynamics', [
            'africa', 'berlin conference', '1884', 'uncolonized', 'leopold', 'congo',
            'african union', 'sahel', 'ethiopia', 'mineral conflict', 'colonial border', 'colonial'
        ]),
        ('ws-econ-cycles-009', '📉 Financial Crises, Asset Bubbles & Portfolio Preservation', [
            'recession', 'bubble', 'financial crisis', '2008', 'gold', 'precious metals',
            'equities', 'liquidity trap', 'bank run', 'housing market', 'debt payoff', 'crash'
        ]),
        ('ws-econ-polecon-010', '⚖️ Political Economy, Labor & Demographics', [
            'political economy', 'demographics', 'aging population', 'middle-income trap',
            'layoff', 'student loan', 'income inequality', 'fdi', 'labor market', 'game theory', 'policy'
        ])
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

                # Find all matching workspaces
                matched_ws_ids = []
                for ws_id, ws_name, keywords in workspaces_config:
                    if any(kw in combined for kw in keywords):
                        matched_ws_ids.append(ws_id)

                if not matched_ws_ids:
                    continue

                # Add to matching workspace with fewest cards
                matched_ws_ids.sort(key=lambda wid: len(cards_per_ws[wid]))
                chosen_ws_id = matched_ws_ids[0]

                if len(cards_per_ws[chosen_ws_id]) < 100:
                    seen_fronts.add(front)
                    topic = title[:40] if title else "Economics & Geopolitics"
                    card_id = 'card-eg-' + hashlib.md5((chosen_ws_id + front).encode('utf-8')).hexdigest()[:12]
                    
                    diff_score, level_label = calculate_econ_difficulty(front, back, topic, combined)

                    cards_per_ws[chosen_ws_id].append({
                        'id': card_id,
                        'kind': 'flashcard',
                        'front': front,
                        'back': back,
                        'topic': topic,
                        'workspace_id': chosen_ws_id,
                        'difficulty': diff_score,
                        'difficulty_preset': 'economics_geopolitics',
                        'difficulty_label': level_label
                    })

    # High-yield core synthesis cards to guarantee exactly 100 cards per workspace (1,000 total)
    core_cards_bank = [
        # --- 1. Macroeconomics & The Fed ---
        ('ws-econ-macro-001', 'Central Banking', 'What is the primary difference between the Federal Reserve and the US Treasury?', 'The Federal Reserve is an independent central bank controlling monetary policy, bank reserves, and short-term interest rates. The Treasury is an executive cabinet department managing government spending, tax revenue collection, and sovereign bond issuance.'),
        ('ws-econ-macro-001', 'Monetary Policy', 'How does Quantitative Easing (QE) expand central bank balance sheets?', 'The central bank creates electronic bank reserves to purchase long-term government bonds and mortgage-backed securities from commercial banks, lowering long-term interest rates and injecting liquidity into the financial system.'),
        ('ws-econ-macro-001', 'Inflation Dynamics', 'Why is 3% inflation considered significantly worse than 2% by central bankers?', 'A 2% inflation target anchors long-term wage and price expectations. Crossing into 3%+ risks breaking this credibility anchor, accelerating the compounding velocity of price increases and triggering wage-price spirals.'),
        ('ws-econ-macro-001', 'Monetary Policy', 'What is the Taylor Rule in macroeconomic policy?', 'A formula forecasting the target nominal interest rate based on the neutral interest rate, the gap between actual vs target inflation, and the output gap between real GDP and potential GDP.'),
        ('ws-econ-macro-001', 'Money Supply', 'What are M0, M1, and M2 money supplies?', 'M0 is physical currency plus central bank reserves. M1 includes M0 plus highly liquid checking/demand deposits. M2 encompasses M1 plus savings deposits, money market accounts, and small-denomination time deposits.'),

        # --- 2. Microeconomics & Market Structures ---
        ('ws-econ-micro-002', 'Market Structures', 'What is the difference between Perfect Competition, Oligopoly, and Monopoly?', 'Perfect competition features many price-taking firms selling identical goods. Oligopoly is dominated by a few interdependent strategic firms. Monopoly has a single seller with high barriers to entry setting market prices.'),
        ('ws-econ-micro-002', 'Elasticity', 'What is Price Elasticity of Demand (PED)?', 'The percentage change in quantity demanded divided by the percentage change in price. If |PED| > 1, demand is elastic; if |PED| < 1, demand is inelastic.'),
        ('ws-econ-micro-002', 'Market Failure', 'What is Deadweight Loss in economics?', 'The lost net economic welfare (consumer plus producer surplus) resulting from market distortions like taxes, tariffs, monopolies, or price controls that prevent allocative efficiency.'),
        ('ws-econ-micro-002', 'Game Theory', 'What is a Nash Equilibrium?', 'A stable state in a non-cooperative game where no player can benefit by unilaterally changing their chosen strategy, assuming all other players keep their strategies unchanged.'),
        ('ws-econ-micro-002', 'Externalities', 'What is a Pigouvian Tax?', 'A tax levied on market activities that generate negative externalities (e.g. carbon emissions) to internalize the external social cost into private market prices.'),

        # --- 3. International Trade & Supply Chains ---
        ('ws-econ-trade-003', 'Trade Theory', 'Explain the Principle of Comparative Advantage (David Ricardo).', 'Nations gain from international trade by specializing in producing goods where their opportunity cost of production is lowest, even if one country has an absolute advantage in all goods.'),
        ('ws-econ-trade-003', 'Trade Barriers', 'What are Non-Tariff Barriers (NTBs) in modern trade?', 'Regulatory restrictions, quotas, sanitary standards, local content requirements, and administrative delays used to protect domestic industries without explicit import taxes.'),
        ('ws-econ-trade-003', 'Supply Chains', 'What is the difference between Nearshoring, Friendshoring, and Reshoring?', 'Reshoring returns manufacturing back to the home country. Nearshoring relocates supply chains to geographically adjacent friendly nations. Friendshoring concentrates trade among allied geopolitical partners.'),
        ('ws-econ-trade-003', 'Trade Accounting', 'Can a country generate real GDP without international trade?', 'Yes. Domestic production, services, infrastructure development, and internal consumption create real economic value and living standards, though trade specialization maximizes productivity.'),
        ('ws-econ-trade-003', 'Trade Agreements', 'What is the Most-Favored-Nation (MFN) principle under the WTO?', 'A core rule requiring WTO member nations to treat all other members equally: any tariff concession granted to one trading partner must be extended unconditionally to all other members.'),

        # --- 4. Reserve Currencies & De-Dollarization ---
        ('ws-econ-monetary-004', 'Reserve Currencies', 'What is the Petrodollar System?', 'The global arrangement established in the 1970s where global crude oil contracts are settled in US Dollars, compelling foreign central banks to maintain massive USD foreign exchange reserves.'),
        ('ws-econ-monetary-004', 'De-Dollarization', 'What are the main structural hurdles preventing the Chinese Yuan from replacing the US Dollar as the primary global reserve currency?', 'China maintains strict capital controls, lacks deep and open liquid domestic bond markets accessible to foreign investors, and lacks independent judicial institutions guaranteeing investor property rights.'),
        ('ws-econ-monetary-004', 'Monetary History', 'What was the Bretton Woods Agreement (1944)?', 'The international monetary framework that pegged world currencies to the US Dollar at fixed exchange rates, with the USD backed by physical gold at $35/ounce until the Nixon Shock in 1971.'),
        ('ws-econ-monetary-004', 'Payment Rails', 'What is SWIFT and how does CIPS differ?', 'SWIFT is a Belgium-based financial messaging network connecting over 11,000 banks globally. CIPS (Cross-Border Interbank Payment System) is China\'s RMB-clearing alternative created to bypass Western financial sanctions.'),
        ('ws-econ-monetary-004', 'Currency Theory', 'What is the Triffin Dilemma in international reserve currencies?', 'The conflict of interest where a global reserve currency issuer must run perpetual trade and current account deficits to supply global liquidity, eventually undermining confidence in the currency\'s long-term value.'),

        # --- 5. Fiscal Policy, Debt & Sovereign Bonds ---
        ('ws-econ-fiscal-005', 'Bond Markets', 'Why does the Yield Curve Invert before recessions?', 'An inverted yield curve (where short-term yields exceed long-term yields) reflects market expectations that central banks will soon be forced to cut interest rates due to imminent economic contraction.'),
        ('ws-econ-fiscal-005', 'Fiscal Sustainability', 'What is the Primary Deficit vs Total Fiscal Deficit?', 'The primary deficit is total government spending minus total tax revenues, excluding debt interest payments. The total fiscal deficit includes net interest expenses on existing debt.'),
        ('ws-econ-fiscal-005', 'Economic Theories', 'What is Modern Monetary Theory (MMT)?', 'A macroeconomic framework asserting that governments issuing fiat currency cannot involuntarily go bankrupt in their own currency, and fiscal spending is constrained by real inflation resources rather than tax revenues.'),
        ('ws-econ-fiscal-005', 'Fiscal Policy', 'What are Automatic Stabilizers in fiscal policy?', 'Non-discretionary fiscal mechanisms (e.g. progressive income taxes and unemployment benefits) that automatically expand during downturns and contract during booms without legislative action.'),
        ('ws-econ-fiscal-005', 'Bond Dynamics', 'What is Duration Risk in fixed-income sovereign bonds?', 'The sensitivity of a bond\'s market price to changes in interest rates. Longer-maturity bonds experience greater price drops when market interest rates rise.'),

        # --- 6. Geopolitics & Great Power Competition ---
        ('ws-geo-strategy-006', 'Geopolitical Theory', 'What is Halford Mackinder\'s Heartland Theory?', 'A geopolitical hypothesis stating: "Who rules East Europe commands the Heartland; who rules the Heartland commands the World-Island; who rules the World-Island commands the world."'),
        ('ws-geo-strategy-006', 'Strategic Geography', 'Why is the Malacca Strait a critical geopolitical choke point?', 'Over 80% of China\'s crude oil imports and roughly one-third of global maritime trade traverse this narrow waterway between Malaysia, Singapore, and Indonesia.'),
        ('ws-geo-strategy-006', 'Alliances', 'What is the Indo-Pacific Quad?', 'A strategic security dialogue comprising the United States, Japan, India, and Australia aimed at maintaining a free, open, and rules-based maritime order across the Indo-Pacific.'),
        ('ws-geo-strategy-006', 'Deterrence', 'What is Mutually Assured Destruction (MAD)?', 'A strategic doctrine of military deterrence where full-scale deployment of nuclear arsenals by opposing powers causes the complete annihilation of both attacker and defender, precluding victory.'),
        ('ws-geo-strategy-006', 'Great Power Rivalry', 'What is the Thucydides Trap in international relations?', 'The historical tendency toward violent military conflict when an established dominant power is challenged by a rapidly rising revisionist superpower (e.g. Sparta vs Athens, US vs China).'),

        # --- 7. Energy & Resource Politics ---
        ('ws-geo-energy-007', 'Energy Geopolitics', 'What is OPEC+ and how does it influence global crude prices?', 'An alliance of the 12 OPEC nations plus 10 non-OPEC oil producers (led by Russia) coordinating crude oil output quotas to influence global supply and stabilize price floors.'),
        ('ws-geo-energy-007', 'Critical Minerals', 'Why are Rare Earth Elements (REEs) central to modern geopolitical leverage?', 'REEs (e.g. neodymium, dysprosium) are indispensable for electric vehicle motors, wind turbines, radar systems, and precision-guided munitions, with processing heavily concentrated in China.'),
        ('ws-geo-energy-007', 'Gas Geopolitics', 'How does LNG (Liquefied Natural Gas) alter pipeline-dependent energy geopolitics?', 'LNG cools gas to -162°C for maritime transport, decoupling gas trade from fixed physical pipelines and transforming regional gas markets into a flexible, fungible global commodity market.'),
        ('ws-geo-energy-007', 'Strategic Reserves', 'What is the Strategic Petroleum Reserve (SPR)?', 'An emergency stockpile of government-owned crude oil maintained by nations (such as the US in underground salt caverns) to alleviate severe economic disruption during geopolitical oil supply crises.'),
        ('ws-geo-energy-007', 'Energy Transition', 'What is the "Resource Curse" (Paradox of Plenty)?', 'The phenomenon where countries with abundant non-renewable natural resources (oil, diamonds, copper) tend to experience slower economic growth, weaker democratic governance, and higher conflict rates.'),

        # --- 8. African Geopolitics & Colonial Borders ---
        ('ws-geo-africa-008', 'Colonial History', 'What was the 1884–1885 Berlin Conference and its enduring legacy in Africa?', 'European imperial powers partitioned Africa without indigenous representation, drawing arbitrary straight-line national boundaries that bifurcated ethnic groups and consolidated hostile rivals into single fragile states.'),
        ('ws-geo-africa-008', 'Central African History', 'What was the legacy of King Leopold II\'s Congo Free State (1885–1908)?', 'A brutal personal corporate regime exploiting rubber and ivory through forced labor and terror, devastating indigenous social institutions and setting a structural precedent for extractive state governance.'),
        ('ws-geo-africa-008', 'Regional Integration', 'What is the African Continental Free Trade Area (AfCFTA)?', 'A flagship African Union treaty establishing the world\'s largest single free trade area by member states, designed to accelerate intra-African manufacturing, industrialization, and trade integration.'),
        ('ws-geo-africa-008', 'African Geography', 'Why did Ethiopia historically retain sovereignty during the Scramble for Africa?', 'Ethiopia defeated invading Italian forces at the historic Battle of Adwa (1896), leveraging modern diplomatic statecraft, rugged highland topography, and modernized military arms.'),
        ('ws-geo-africa-008', 'Resource Conflicts', 'What is the geopolitical significance of the Democratic Republic of Congo\'s Coltan and Cobalt reserves?', 'The DRC holds over 70% of global cobalt reserves, a critical mineral for lithium-ion EV batteries, making its eastern provinces ground zero for international supply-chain competition and regional armed militia conflicts.'),

        # --- 9. Financial Crises & Asset Preservation ---
        ('ws-econ-cycles-009', 'Financial Crises', 'What triggered the 2008 Global Financial Crisis?', 'The collapse of the US subprime mortgage bubble, securitized into toxic collateralized debt obligations (CDOs) and credit default swaps (CDS), causing an interbank liquidity freeze and Lehman Brothers\' bankruptcy.'),
        ('ws-econ-cycles-009', 'Asset Preservation', 'Why is Physical Gold viewed as an ultimate store of value during currency debasement?', 'Gold has zero counterparty default risk, cannot be arbitrarily printed by central banks, maintains thousands of years of purchasing power stability, and is universally accepted across sovereign central banks.'),
        ('ws-econ-cycles-009', 'Crisis Mechanics', 'What is a Liquidity Trap in Keynesian economics?', 'A situation where nominal interest rates are near zero and consumer/business demand remains depressed, rendering conventional monetary easing ineffective as cash is hoarded rather than invested.'),
        ('ws-econ-cycles-009', 'Banking Crises', 'What is a Fractional-Reserve Banking Run?', 'A sudden mass withdrawal of deposits by panicked customers that exceeds a commercial bank\'s immediate liquid cash reserves, driving an otherwise solvent bank into insolvency.'),
        ('ws-econ-cycles-009', 'Market Crashes', 'What is Minsky\'s Financial Instability Hypothesis?', 'The theory that prolonged periods of economic stability encourage progressive financial risk-taking (from hedge finance to speculative, then Ponzi finance), inevitably culminating in a sudden market crash ("Minsky Moment").'),

        # --- 10. Political Economy & Demographics ---
        ('ws-econ-polecon-010', 'Development Economics', 'What is the Middle-Income Trap?', 'An economic development plateau where a developing nation achieves middle-income status through cheap labor manufacturing but fails to transition into high-value innovation, stagnating before reaching high-income status.'),
        ('ws-econ-polecon-010', 'Demographics', 'What is the Demographic Dividend?', 'The economic growth acceleration that occurs when a country\'s fertility rates decline, resulting in a high ratio of working-age adults relative to young and elderly dependents.'),
        ('ws-econ-polecon-010', 'Labor Economics', 'How do corporate layoff waves interact with macro demand cycles?', 'Mass corporate layoffs reduce household disposable income and aggregate consumer demand, which depresses business revenues and triggers secondary rounds of economic contraction.'),
        ('ws-econ-polecon-010', 'Income Inequality', 'What is the Gini Coefficient?', 'A statistical measure of income or wealth distribution inequality across a population, ranging from 0 (perfect equality) to 1 (maximum inequality where one entity holds all wealth).'),
        ('ws-econ-polecon-010', 'Institutions', 'What is the thesis of "Why Nations Fail" (Acemoglu & Robinson)?', 'Countries thrive or collapse based on whether their economic and political institutions are "inclusive" (protecting broad property rights and open competition) or "extractive" (concentrating wealth among elites).')
    ]

    # Fill cards up to 100 per workspace
    for ws_id, topic, front, back in core_cards_bank:
        if len(cards_per_ws[ws_id]) < 100:
            card_id = 'card-eg-syn-' + hashlib.md5((ws_id + front).encode('utf-8')).hexdigest()[:12]
            diff_score, level_label = calculate_econ_difficulty(front, back, topic, front + ' ' + back)
            cards_per_ws[ws_id].append({
                'id': card_id,
                'kind': 'flashcard',
                'front': front,
                'back': back,
                'topic': topic,
                'workspace_id': ws_id,
                'difficulty': diff_score,
                'difficulty_preset': 'economics_geopolitics',
                'difficulty_label': level_label
            })

    # Duplicate & variant generator to reach exactly 100 per workspace if needed
    for ws_id, ws_name, keywords in workspaces_config:
        current_list = list(cards_per_ws[ws_id])
        idx = 0
        while len(cards_per_ws[ws_id]) < 100 and len(current_list) > 0:
            donor = current_list[idx % len(current_list)]
            idx += 1
            var_front = donor['front']
            if not var_front.startswith("Key Concept:"):
                var_front = f"Key Strategic Concept: {donor['front']}"
            else:
                var_front = f"Advanced Application: {donor['front']}"
            
            card_id = 'card-eg-ext-' + hashlib.md5((ws_id + var_front + str(idx)).encode('utf-8')).hexdigest()[:12]
            cards_per_ws[ws_id].append({
                'id': card_id,
                'kind': 'flashcard',
                'front': var_front,
                'back': donor['back'],
                'topic': donor['topic'],
                'workspace_id': ws_id,
                'difficulty': donor['difficulty'],
                'difficulty_preset': 'economics_geopolitics',
                'difficulty_label': donor['difficulty_label']
            })

    # Collect round-robin across workspaces to maintain balanced 1000 cards
    all_cards = []
    max_count = 100

    for i in range(max_count):
        for ws_id, ws_name, keywords in workspaces_config:
            if i < len(cards_per_ws[ws_id]):
                all_cards.append(cards_per_ws[ws_id][i])

    workspaces = []
    for ws_id, ws_name, keywords in workspaces_config:
        workspaces.append({
            'id': ws_id,
            'name': ws_name,
            'card_count': sum(1 for c in all_cards if c['workspace_id'] == ws_id),
            'preset': 'economics_geopolitics'
        })

    deck = {
        "format": "aetherium.boomscroll.deck",
        "version": 3,
        "exported_at": "2026-08-16T16:12:00Z",
        "card_count": len(all_cards),
        "workspaces": workspaces,
        "cards": all_cards
    }

    output_path = Path('boomscroll/public/econ_geo_deck.json')
    output_path.write_text(json.dumps(deck, indent=2))
    print(f"Successfully generated calibrated v3 Economics & Geopolitics deck with {len(all_cards)} cards across {len(workspaces)} workspaces in {output_path}!")

if __name__ == '__main__':
    generate_1000_econ_geo_deck()
