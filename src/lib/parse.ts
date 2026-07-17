/** Split pasted / uploaded text into candidate lines. */
export function parseInputLines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    if (line.includes(',')) line = line.split(',')[0]!.trim();
    if (line.includes('\t')) line = line.split('\t')[0]!.trim();
    if (line.includes(' ') && !line.startsWith('0x')) {
      const token = line.split(/\s+/).find((t) => t.length >= 26);
      if (token) line = token;
    }
    if (line.includes('=') && !line.startsWith('0x')) {
      const parts = line.split('=');
      line = parts[parts.length - 1]!.trim();
    }

    line = line.replace(/^["']|["']$/g, '');
    if (line.startsWith('0x') || line.startsWith('0X')) {
      const body = line.slice(2);
      line = body.length === 40 ? `0x${body.toLowerCase()}` : body;
    }

    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }

  return out;
}

export function classifyLine(line: string): {
  kind: 'privkey_hex' | 'wif' | 'address' | 'invalid';
} {
  if (/^[0-9a-fA-F]{64}$/.test(line)) return { kind: 'privkey_hex' };
  if (/^[5KL9c][1-9A-HJ-NP-Za-km-z]{50,52}$/.test(line)) return { kind: 'wif' };
  if (/^0x[0-9a-fA-F]{40}$/.test(line) || /^[0-9a-fA-F]{40}$/.test(line)) return { kind: 'address' };
  if (/^(1|3|bc1|ltc1|t1|t3|T|L|M|X|D|A)[0-9A-Za-z]+/.test(line)) return { kind: 'address' };
  return { kind: 'invalid' };
}
