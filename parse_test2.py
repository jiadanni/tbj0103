import re

with open("Samples/Gemini Apps/My Activity.html", "r", encoding="utf-8") as f:
    text = f.read()

divs = re.findall(r'<div class="content-cell.*?>(.*?)</div></div></div>', text, flags=re.S)

for div in divs[:3]:
    print("------- DIV -------")
    print(repr(div[:150]))
