/* ----------------------------------------------------------------------------
   CLIDesk — tiny dependency-free syntax highlighter (VS Code "Dark+" palette).
   Good enough for snippets: commands, JS/TS, Python, shell, JSON, CSS, HTML, SQL.
---------------------------------------------------------------------------- */

export const LANGUAGES = [
  'plaintext', 'javascript', 'typescript', 'python', 'bash',
  'json', 'html', 'css', 'sql', 'go', 'rust', 'java', 'cpp',
] as const;
export type Language = (typeof LANGUAGES)[number];

const KEYWORDS: Record<string, string[]> = {
  common: ['if', 'else', 'for', 'while', 'return', 'function', 'class', 'const', 'let', 'var',
    'import', 'export', 'from', 'new', 'try', 'catch', 'finally', 'throw', 'await', 'async',
    'def', 'lambda', 'pass', 'with', 'as', 'in', 'is', 'not', 'and', 'or', 'elif', 'yield',
    'public', 'private', 'protected', 'static', 'void', 'int', 'float', 'double', 'bool',
    'string', 'struct', 'enum', 'interface', 'type', 'fn', 'let', 'mut', 'pub', 'use', 'fn',
    'package', 'func', 'go', 'defer', 'select', 'switch', 'case', 'default', 'break', 'continue',
    'do', 'extends', 'implements', 'super', 'this', 'self', 'null', 'nil', 'true', 'false',
    'None', 'True', 'False', 'echo', 'cd', 'sudo', 'apt', 'npm', 'npx', 'git', 'docker', 'curl',
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'DELETE', 'JOIN', 'ON',
    'GROUP', 'ORDER', 'BY', 'LIMIT', 'CREATE', 'TABLE', 'ALTER', 'DROP', 'AND', 'OR', 'NOT'],
};

const CONTROL = new Set(['if', 'else', 'for', 'while', 'return', 'switch', 'case', 'break',
  'continue', 'try', 'catch', 'finally', 'throw', 'await', 'yield', 'elif', 'do', 'default']);

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

const KW = new Set(KEYWORDS.common);

// Master tokenizer regex. Order matters: comments, strings, numbers, then words.
const TOKEN_RE = new RegExp(
  [
    '(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*|<!--[\\s\\S]*?-->|#[^\\n]*)', // 1 comment
    '("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`)', // 2 string
    '\\b(0x[0-9a-fA-F]+|\\d+\\.?\\d*(?:[eE][+-]?\\d+)?)\\b', // 3 number
    '([A-Za-z_$][\\w$]*)(?=\\s*\\()', // 4 function call
    '([A-Za-z_$][\\w$]*)', // 5 word
    '([{}()\\[\\];,.:=+\\-*/%<>!&|^~?])', // 6 punctuation / operator
  ].join('|'),
  'g'
);

/**
 * Highlight `code` and return HTML (already escaped). `lang` only tweaks the
 * keyword palette; the tokenizer itself is language-agnostic.
 */
export function highlight(code: string, _lang: Language = 'plaintext'): string {
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;

  while ((m = TOKEN_RE.exec(code)) !== null) {
    if (m.index > last) out += escapeHtml(code.slice(last, m.index));
    const [full, comment, str, num, fn, word, punct] = m;

    if (comment !== undefined) {
      out += `<span class="tok-comment">${escapeHtml(comment)}</span>`;
    } else if (str !== undefined) {
      out += `<span class="tok-string">${escapeHtml(str)}</span>`;
    } else if (num !== undefined) {
      out += `<span class="tok-number">${escapeHtml(num)}</span>`;
    } else if (fn !== undefined) {
      out += KW.has(fn)
        ? `<span class="${CONTROL.has(fn) ? 'tok-control' : 'tok-keyword'}">${escapeHtml(fn)}</span>`
        : `<span class="tok-function">${escapeHtml(fn)}</span>`;
    } else if (word !== undefined) {
      if (KW.has(word)) {
        out += `<span class="${CONTROL.has(word) ? 'tok-control' : 'tok-keyword'}">${escapeHtml(word)}</span>`;
      } else if (/^[A-Z]/.test(word) && word.length > 1) {
        out += `<span class="tok-type">${escapeHtml(word)}</span>`;
      } else {
        out += escapeHtml(word);
      }
    } else if (punct !== undefined) {
      out += `<span class="tok-operator">${escapeHtml(punct)}</span>`;
    }
    last = TOKEN_RE.lastIndex;
  }
  if (last < code.length) out += escapeHtml(code.slice(last));
  return out;
}

/** Heuristic: does this text look like code/a command rather than prose? */
export function looksLikeCode(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const signals = [
    /[;{}<>]/, /=>/, /\bfunction\b|\bdef\b|\bclass\b|\bconst\b|\blet\b|\bvar\b|\bimport\b/,
    /^\s*[$#>]\s/m, /\b(npm|npx|git|docker|sudo|apt|curl|cd|cargo|pip|brew)\b/,
    /[A-Za-z_]+\([^)]*\)/, /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE)\b/im,
    /[-]{1,2}[a-z]+/, /\$\{?\w+/,
  ];
  const hits = signals.reduce((n, re) => n + (re.test(t) ? 1 : 0), 0);
  return hits >= 2 || /[;{}]\s*$/m.test(t);
}

/** Best-effort language guess for a code snippet. */
export function detectLanguage(text: string): Language {
  const t = text.trim();
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/im.test(t)) return 'sql';
  if (/^\s*[{[]/.test(t) && /[}\]]\s*$/.test(t) && /[":]/.test(t)) return 'json';
  if (/\bdef\b|\bimport\b.*\n|\bprint\(|\belif\b|:\s*$/m.test(t) && !/[;{}]/.test(t)) return 'python';
  if (/<\/?[a-z][\s\S]*>/i.test(t)) return 'html';
  if (/[.#][\w-]+\s*\{[\s\S]*:/.test(t)) return 'css';
  if (/^\s*[$#>]\s|\b(npm|npx|git|docker|sudo|apt|curl|cd|echo|mkdir|chmod)\b/m.test(t)) return 'bash';
  if (/\binterface\b|\btype\b\s+\w+\s*=|: (string|number|boolean)/.test(t)) return 'typescript';
  if (/\bfunc\b|\bpackage\b\s+\w+/.test(t)) return 'go';
  if (/\bfn\b|\blet mut\b|::/.test(t)) return 'rust';
  if (/=>|\bconst\b|\blet\b|\bfunction\b|console\./.test(t)) return 'javascript';
  return 'plaintext';
}
