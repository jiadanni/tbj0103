const lucide = require("lucide-react");
Object.keys(lucide).forEach(k => {
  if (/toggle/i.test(k) || /sidebar/i.test(k) || /panel/i.test(k)) {
    console.log(k);
  }
});
