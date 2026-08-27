import { readFileSync } from 'node:fs';
import { detectProductConfig } from '../src/services/trackingConfig/detectionEngine.js';


const target = process.argv[2] ?? 'https://online-fish-market-six.vercel.app/products/rui/';
const html = target.endsWith('.html')
  ? readFileSync(target, 'utf8')
  : await (await fetch(target, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; detect-debug)' } })).text();
console.error(`[input] ${target.slice(0, 80)} (${html.length} bytes)`);
try {
  const cfg = detectProductConfig(html, target.startsWith('http') ? target : 'https://example.com' + new URL(`https://x${target}`).pathname);
  console.log('[result] OK', JSON.stringify(cfg, null, 2));
} catch (error) {
  console.log(`[result] THREW ${error.name} reason=${error.reason}\n${error.message}`);
}
