// Defensive JSON extraction from Claude's text output.
//
// Claude usually returns clean JSON when asked, but sometimes wraps it in a
// fenced code block or adds preamble/postamble. This tries three strategies
// in order and returns null on failure rather than throwing.

export function extractJsonObject<T = unknown>(text: string): T | null {
  // 1. Direct parse — works when Claude obeyed "ONLY JSON".
  try {
    return JSON.parse(text) as T;
  } catch {
    // fall through
  }

  // 2. Fenced code block (```json ... ``` or just ``` ... ```).
  const fence = text.match(/```(?:json|javascript)?\s*([\s\S]*?)\s*```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]) as T;
    } catch {
      // fall through
    }
  }

  // 3. Bracket-matched first object — find `{`, scan for the matching `}` while
  //    respecting strings and escapes.
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
