/**
 * ============================================================================
 * ADVANCED ANTI-SLUR, PROFANITY & BYPASS DETECTION ENGINE
 * ============================================================================
 * Protects game chat and player usernames against hate speech, toxic slurs,
 * profanities, and evasive bypass attempts (e.g. "sh!t", "s h ! t", "n!gger",
 * "f*ck", "f.u.c.k", homoglyphs, repeated chars, leetspeak, zero-width chars).
 * ============================================================================
 */

// Common unicode homoglyphs & confusable substitutions (Cyrillic, Greek, etc.)
// Note: Lowercase 'l' is the letter L in English, not 'i'.
const HOMOGLYPHS = {
  'а': 'a', 'а́': 'a', 'а̀': 'a', 'а̌': 'a', 'α': 'a', 'д': 'a', 'ª': 'a',
  'в': 'b', 'β': 'b', 'ь': 'b', 'б': 'b',
  'с': 'c', 'ç': 'c', 'ć': 'c', 'č': 'c', '¢': 'c',
  'ԁ': 'd', 'ð': 'd',
  'е': 'e', 'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ё': 'e', 'є': 'e', 'ε': 'e', '3': 'e',
  'ғ': 'f', 'ƒ': 'f',
  'ɡ': 'g', 'г': 'g', '9': 'g',
  'һ': 'h',
  'і': 'i', 'ї': 'i', 'ı': 'i', 'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i', '1': 'i', '!': 'i', '|': 'i', '¡': 'i',
  'ј': 'j',
  'к': 'k', 'κ': 'k',
  'ӏ': 'l', 'ł': 'l',
  'м': 'm', 'μ': 'm',
  'п': 'n', 'ñ': 'n', 'и': 'n',
  'о': 'o', 'ó': 'o', 'ò': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o', '0': 'o', 'ø': 'o', 'θ': 'o', 'ο': 'o',
  'р': 'p', 'ρ': 'p',
  'г': 'r', 'я': 'r',
  'ѕ': 's', 'š': 's', 'ś': 's', '$': 's', '5': 's',
  'т': 't', 'τ': 't', '7': 't',
  'у': 'u', 'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u', 'μ': 'u', 'v': 'u',
  'ѡ': 'w', 'ш': 'w', 'щ': 'w',
  'х': 'x', 'χ': 'x',
  'у': 'y', 'ý': 'y', 'ÿ': 'y',
  'z': 'z', 'ž': 'z', 'ź': 'z', '2': 'z'
};

// Leetspeak character map
const LEET_MAP = {
  '@': 'a', '4': 'a', '^': 'a',
  '8': 'b',
  '(': 'c', '<': 'c', '{': 'c', '[': 'c',
  '3': 'e', '€': 'e',
  '1': 'i', '!': 'i', '|': 'i', '¡': 'i',
  '0': 'o',
  '5': 's', '$': 's',
  '7': 't',
  '9': 'g',
  'v': 'u'
};

// High-priority severe hate speech, racial slurs, homophobic slurs, suicide encouragement
// Checked anywhere in text (even if surrounded by punctuation or joined)
const SEVERE_SLURS = [
  // Racial / Ethnic slurs
  /n+[i!1|*#+]+g+g+[e3a4]+r*/i,
  /n+[i!1|*#+]+g+g+[a4]/i,
  /n+i+g+g+u+h/i,
  /n+i+g+l+e+t/i,
  /k+[i!1|*#]+k+e+/i,
  /c+h+[i!1|*#]+n+k+/i,
  /s+p+[i!1|*#]+c+/i,
  /w+e+t+b+a+c+k+/i,
  /c+o+o+n+s*/i,
  /g+o+o+k+/i,
  /g+y+p+s+y+/i,

  // LGBTQ+ slurs
  /f+[a@4*#]+g+g+[o0e3]*t*s*/i,
  /f+[a@4*#]+g+s*/i,
  /d+y+k+e+s*/i,
  /t+r+a+n+n+y+/i,
  /t+r+a+n+n+i+e+s*/i,
  /s+h+e+m+a+l+e+/i,

  // Ableist slurs
  /r+[e3*#]+t+[a@4*#]+r+d+s*/i,
  /r+[e3*#]+t+[a@4*#]+r+d+e+d+/i,
  /s+p+a+s+t+i+c+/i,

  // Suicide / Self-Harm encouragement
  /k+[i!1|]+l+l+\s*y+o+u+r+\s*s+e+l+f+/i,
  /\bk+[i!1|]?y+s+\b/i,
  /s+l+[i!1|]+t+\s*y+o+u+r+\s*w+r+[i!1|]+s+t+s*/i,
  /c+o+m+m+[i!1|]+t+\s*s+u+[i!1|]+c+[i!1|]+d+e+/i,
  /g+o+\s*d+[i!1|]+e+/i,
  /d+r+[i!1|]+n+k+\s*b+l+e+a+c+h+/i
];

// General profanities & insults (detected with leetspeak/bypass resistance and word boundaries)
const PROFANITY_PATTERNS = [
  // Shit & variations (sh!t, sh1t, s.h.i.t, shyte, sh*t, sh+t, etc.)
  /\bs+h+[i!1|*#\+]+t+s*\b/i,
  /\bs+h+[i!1|*#\+]+t+t+e+r+s*\b/i,
  /\bs+h+[i!1|*#\+]+t+t+y+\b/i,
  /\bs+h+y+t+e*\b/i,
  /\bb+u+l+l+s+h+[i!1|*#\+]+t+\b/i,
  /\bd+[i!1|]+p+s+h+[i!1|*#\+]+t+\b/i,
  /\bs+h+t+\b/i,

  // Fuck & variations (f*ck, f u c k, fvck, fuk, fck, etc.)
  /\bf+[u*#_ov]+c+k+s*\b/i,
  /\bf+[u*#_ov]+c+k+[i!1|]+n+g*\b/i,
  /\bf+[u*#_ov]+c+k+e+r+s*\b/i,
  /\bf+[u*#_ov]+c+k+e+d+\b/i,
  /\bf+[u*#_ov]+k+\b/i,
  /\bf+c+k+s*\b/i,
  /\bm+o+t+h+e+r+f+[u*#_ov]+c+k+e+r*\b/i,
  /\bw+t+f+\b/i,

  // Bitch & variations (b!tch, b1tch, b*tch, btch, etc.)
  /\bb+[i!1|*#+]+t+c+h+e*s*\b/i,
  /\bb+[i!1|*#+]+t+c+h+[i!1|]+n+g*\b/i,
  /\bb+t+c+h+\b/i,

  // Cunt & variations (c*nt, cvnt, cnt, etc.)
  /\bc+[u*#_ov]+n+t+s*\b/i,
  /\bc+n+t+s*\b/i,

  // Whore / Slut
  /\bw+h+[o0*#]+r+e+s*\b/i,
  /\bs+l+[u*#_ov]+t+s*\b/i,

  // Dick / Cock / Pussy
  /\bd+[i!1|*#+]+c+k+s*\b/i,
  /\bd+[i!1|*#+]+c+k+h+e+a+d+s*\b/i,
  /\bc+[o0*#]+c+k+s*\b/i,
  /\bc+[o0*#]+c+k+s+[u*#_ov]+c+k+e+r*s*\b/i,
  /\bp+[u*#_ov]+s+s+y+\b/i,
  /\bp+[u*#_ov]+s+s+[i!1|]+e+s*\b/i,

  // Ass / Asshole (strictly bounded to prevent Scunthorpe false positives)
  /\ba+s+s+h+[o0*#]+l+e+s*\b/i,
  /\ba+s+s+w+[i!1|]+p+e+s*\b/i,
  /\bj+a+c+k+a+s+s+e*s*\b/i,
  /\bd+[u*#_ov]+m+b+a+s+s+e*s*\b/i,
  /\ba+s+s+\b/i,

  // Bastard
  /\bb+a+s+t+a+r+d+s*\b/i,

  // Wanker / Twat
  /\bw+a+n+k+e+r+s*\b/i,
  /\bt+w+a+t+s*\b/i,

  // Motherfucker / son of a bitch
  /\bs+o+b+\b/i,
  /\bs+o+n+\s*o+f+\s*a+\s*b+[i!1|*#+]+t+c+h+\b/i
];

// Whitelist of legitimate common words that contain innocent substrings
const INNOCENT_WHITELIST = new Set([
  'classic', 'class', 'classes', 'glass', 'glasses', 'grass', 'pass', 'passed',
  'passing', 'passage', 'compass', 'mass', 'massive', 'bass', 'asset', 'assets',
  'assign', 'assignment', 'assist', 'assistant', 'assistance', 'assume', 'association',
  'butter', 'button', 'buttons', 'butterfly',
  'title', 'titles', 'subtitle', 'subtitles', 'entity', 'entities',
  'sheet', 'sheets', 'shirt', 'shirts', 'shift', 'shifts',
  'cocktail', 'cocktails', 'peacock', 'hancock',
  'hello', 'shell', 'seashell',
  'donut', 'medonut', 'flappy', 'bird', 'game', 'score', 'player'
]);

/**
 * Normalizes input text by removing zero-width characters, decomposing diacritics,
 * converting confusable homoglyphs, and translating leetspeak.
 */
function normalizeText(text) {
  if (!text) return '';

  // 1. Strip zero-width & invisible format characters
  let clean = String(text)
    .replace(/[\u200B-\u200D\uFEFF\u00A0\u180E\u2000-\u200A\u202F\u205F]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  // 2. Map homoglyphs and unicode confusable symbols
  let mapped = '';
  for (const ch of clean) {
    if (HOMOGLYPHS[ch]) {
      mapped += HOMOGLYPHS[ch];
    } else if (LEET_MAP[ch]) {
      mapped += LEET_MAP[ch];
    } else {
      mapped += ch;
    }
  }

  // 3. Compress consecutive identical characters (e.g. "shiiiiiiit" -> "shiit", "fuuuuck" -> "fuuck")
  const compressed = mapped.replace(/(.)\1{2,}/g, '$1$1');

  return compressed;
}

/**
 * Creates an aggressive "stripped" version that collapses spaces and punctuation
 * to catch evasive spacing bypasses like "s h ! t", "f.u.c.k", "n_i_g_g_e_r".
 * Keeps '*' and '#' so wildcard masks can still be recognized.
 */
function stripSeparators(normalized) {
  // Map '+' to 'i' if in sh+t context or strip otherwise
  const withPlus = normalized.replace(/sh\+t/g, 'shit');
  return withPlus.replace(/[\s\.\-_/\\,;:~`'!()+=<>?[\]{}|]/g, '');
}

/**
 * Scans text for slurs, profanities, and evasive bypass attempts.
 *
 * @param {string} text - Message or username to inspect
 * @returns {{ isBlocked: boolean, reason: string | null, flagged: string | null }}
 */
function checkProhibitedLanguage(text) {
  if (!text || typeof text !== 'string') {
    return { isBlocked: false, reason: null, flagged: null };
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return { isBlocked: false, reason: null, flagged: null };
  }

  // Check against legitimate whitelist word match first
  const words = trimmed.toLowerCase().split(/\s+/);
  const allWhitelisted = words.length > 0 && words.every(w => {
    const strippedWord = w.replace(/[^a-z]/g, '');
    return INNOCENT_WHITELIST.has(strippedWord);
  });
  if (allWhitelisted && words.length <= 3) {
    return { isBlocked: false, reason: null, flagged: null };
  }

  const normalized = normalizeText(trimmed);
  const stripped = stripSeparators(normalized);

  // 1. Check Severe Slurs & Hate Speech (checked on raw, normalized, and stripped)
  for (const regex of SEVERE_SLURS) {
    if (regex.test(trimmed) || regex.test(normalized) || regex.test(stripped)) {
      return {
        isBlocked: true,
        reason: 'Hate speech or severe harassment detected.',
        flagged: 'severe_slur'
      };
    }
  }

  // 2. Check Separator-Bypass Profanities on the stripped string
  // (Catches "s h ! t", "f.u.c.k", "b-i-t-c-h", "c*u*n*t", "f*ck", "c*nt", etc.)
  const strippedBypassPatterns = [
    /s+h+[i*#_!1+]t+/i,
    /s+h+t+/i,
    /f+[u*#_ov]?c+k+/i,
    /f+c+k+/i,
    /b+[i*#_!1+]?t+c+h+/i,
    /b+t+c+h+/i,
    /c+[u*#_ov]?n+t+/i,
    /w+h+[o*#0]r+e+/i,
    /s+l+[u*#_ov]t+/i,
    /d+[i*#_!1+]c+k+/i,
    /c+[o*#0]c+k+/i,
    /p+[u*#_ov]s+s+y+/i,
    /a+s+s+h+[o*#0]l+e+/i,
    /b+a+s+t+a+r+d+/i
  ];

  for (const regex of strippedBypassPatterns) {
    const match = stripped.match(regex);
    if (match) {
      let isFalsePositive = false;
      for (const whiteWord of INNOCENT_WHITELIST) {
        if (trimmed.toLowerCase().includes(whiteWord)) {
          const innocentStripped = stripSeparators(whiteWord);
          if (innocentStripped.includes(match[0]) && stripped.length <= innocentStripped.length + 3) {
            isFalsePositive = true;
            break;
          }
        }
      }

      if (!isFalsePositive) {
        return {
          isBlocked: true,
          reason: 'Prohibited language or bypass attempt detected.',
          flagged: match[0]
        };
      }
    }
  }

  // 3. Check General Profanities on normalized tokenized words
  for (const regex of PROFANITY_PATTERNS) {
    if (regex.test(normalized) || regex.test(trimmed)) {
      return {
        isBlocked: true,
        reason: 'Prohibited language detected.',
        flagged: 'profanity'
      };
    }
  }

  return { isBlocked: false, reason: null, flagged: null };
}

/**
 * Sanitizes and masks any profanities in text if display is required rather than hard block.
 */
function maskProhibitedLanguage(text) {
  if (!text) return '';
  const result = checkProhibitedLanguage(text);
  if (!result.isBlocked) return text;

  let masked = text;
  for (const regex of PROFANITY_PATTERNS) {
    masked = masked.replace(regex, '****');
  }
  for (const regex of SEVERE_SLURS) {
    masked = masked.replace(regex, '****');
  }
  return masked;
}

module.exports = {
  checkProhibitedLanguage,
  maskProhibitedLanguage,
  normalizeText,
  stripSeparators,
  SEVERE_SLURS,
  PROFANITY_PATTERNS,
  INNOCENT_WHITELIST
};
