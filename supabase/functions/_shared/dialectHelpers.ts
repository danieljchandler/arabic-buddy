// Shared dialect identity helpers for edge functions

export type Dialect = 'Gulf' | 'Egyptian' | string;

const GULF_IDENTITY = `You are a native Gulf Arabic (Khaliji) speaker. Always respond in Gulf Arabic dialect, NOT Modern Standard Arabic (فصحى).
Use authentic Gulf vocabulary and expressions: شلونك، وين، هالحين، يالله، إن شاء الله، ليش، واجد، يبي، إمبي، شي، خوش، زين.
Cultural references should be Gulf-specific (مجلس، قهوة عربية، دلة، بخور).
Do NOT use Egyptian or Levantine Arabic.`;

const EGYPTIAN_IDENTITY = `You are a native Egyptian Arabic (مصري) speaker. Always respond in Egyptian Arabic dialect, NOT Modern Standard Arabic (فصحى).
Use authentic Egyptian vocabulary and expressions: إزيك، فين، دلوقتي، عايز، كويس، ماشي، يلا، حاضر، بتاع، مفيش، ازاي، كده، خلاص، يعني، طيب.
Cultural references should be Egyptian-specific (أهوة، كشري، فول، طعمية، نيل، خان الخليلي).
Do NOT use Gulf or Levantine Arabic.`;

const GULF_VOCAB_RULES = `CRITICAL DIALECT RULES:
- Always use Gulf Arabic (Khaliji) vocabulary and expressions, NEVER Modern Standard Arabic (فصحى).
- Use dialectal forms: شلونك (not كيف حالك), وين (not أين), هالحين (not الآن), ليش (not لماذا), واجد (not كثير), يبي (not يريد), إمبي (not أريد), شي (not شيء).
- Arabic script must reflect Gulf pronunciation and spelling conventions.
- Cultural references should be Gulf-specific (مجلس، قهوة عربية، دلة، بخور).`;

const EGYPTIAN_VOCAB_RULES = `CRITICAL DIALECT RULES:
- Always use Egyptian Arabic (مصري) vocabulary and expressions, NEVER Modern Standard Arabic (فصحى).
- Use dialectal forms: إزيك (not كيف حالك), فين (not أين), دلوقتي (not الآن), ليه (not لماذا), كتير (not كثير), عايز (not يريد), عاوز/عاوزة, مش (not ليس), ده/دي (not هذا/هذه).
- Arabic script must reflect Egyptian pronunciation and spelling conventions.
- Cultural references should be Egyptian-specific (أهوة، كشري، فول، طعمية).`;

export function getDialectIdentity(dialect: Dialect): string {
  return dialect === 'Egyptian' ? EGYPTIAN_IDENTITY : GULF_IDENTITY;
}

export function getDialectVocabRules(dialect: Dialect): string {
  return dialect === 'Egyptian' ? EGYPTIAN_VOCAB_RULES : GULF_VOCAB_RULES;
}

export function getDialectLabel(dialect: Dialect): string {
  return dialect === 'Egyptian' ? 'Egyptian Arabic (مصري)' : 'Gulf Arabic (Khaliji)';
}

export function getDialectExamples(dialect: Dialect): string {
  if (dialect === 'Egyptian') {
    return 'إزيك (hello), شكراً (thanks), كويس (good), مية (water), بيت (house)';
  }
  return 'مرحبا (hello), شكراً (thanks), شلونك (how are you), ماي (water), بيت (house)';
}
