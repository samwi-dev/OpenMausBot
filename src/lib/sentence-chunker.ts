const MIN_VISIBLE = 4;
const HARD_END = /[。！？!?；;\n]/;

function visibleLength(text: string): number {
  return text.replace(/\s/g, "").length;
}

/** Cuts finished sentences off the front of a streaming buffer; `rest` is the unfinished tail. A "." only ends a
 * sentence when whitespace follows, so "3.5" survives, and pieces under 4 visible characters ride along with the next
 * one instead of being spoken alone. */
export function takeSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let pending = "";
  let start = 0;
  let i = 0;
  while (i < buffer.length) {
    const ch = buffer[i];
    let end = -1;
    if (HARD_END.test(ch)) {
      end = i + 1;
      while (end < buffer.length && /[。！？!?；;]/.test(buffer[end])) end++;
    } else if (ch === "." && i + 1 < buffer.length && /\s/.test(buffer[i + 1])) {
      end = i + 1;
    }
    if (end < 0) {
      i++;
      continue;
    }
    const piece = pending + buffer.slice(start, end);
    if (visibleLength(piece) === 0) {
      pending = "";
    } else if (visibleLength(piece) < MIN_VISIBLE) {
      pending = piece;
    } else {
      sentences.push(piece.trim());
      pending = "";
    }
    start = end;
    i = end;
  }
  return { sentences, rest: (pending + buffer.slice(start)).replace(/^\s+/, "") };
}
