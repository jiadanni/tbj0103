import re
with open("Samples/Gemini Apps/My Activity.html", "r", encoding="utf-8") as f:
    text = f.read()

items = re.findall(r'<div class="outer-cell.*?>(.*?)</div></div></div>', text, flags=re.S)
for i in range(min(3, len(items))):
    print(f"--- ITEM {i} ---")
    print(items[i][:300])
