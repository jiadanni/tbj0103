import re

with open('tauri/src/views/ChatView.tsx', 'r') as f:
    content = f.read()

# Add WaterfallSuggestions import
import_stmt = 'import { WaterfallSuggestions } from "../components/WaterfallSuggestions";\n'
content = content.replace('import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";\n', 'import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";\n' + import_stmt)

# Prepare waterfall suggestions
waterfall_code = """
  // Extract all suggestions for the waterfall background
  const waterfallSuggestions = useMemo(() => {
    if (activeChatId) return [];
    return composerSuggestionRows.flatMap(row => row.suggestions);
  }, [activeChatId, composerSuggestionRows]);
"""

# Insert before render
content = content.replace('const isComparePanelOpen = activeSubView === "compare";', waterfall_code + '\n  const isComparePanelOpen = activeSubView === "compare";')

# Add to the Empty State UI
empty_state_target = """{!activeChatId ? (
                <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-4 text-center">"""

empty_state_replacement = """{!activeChatId ? (
                <div className="relative flex-1 min-w-0 flex flex-col items-center justify-center gap-4 text-center overflow-hidden">
                  <WaterfallSuggestions
                    suggestions={waterfallSuggestions}
                    onSelect={(suggestion) => handleSuggestionClick(suggestion, false)}
                  />
                  <div className="relative z-10 flex flex-col items-center gap-4">"""

content = content.replace(empty_state_target, empty_state_replacement)

# Close the new z-10 div
close_target = """                      </div>
                    )}
                  </div>
                </div>
              ) : ("""

close_replacement = """                      </div>
                    )}
                  </div>
                  </div>
                </div>
              ) : ("""

content = content.replace(close_target, close_replacement)

with open('tauri/src/views/ChatView.tsx', 'w') as f:
    f.write(content)
