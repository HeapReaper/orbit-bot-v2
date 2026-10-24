import OpenAI from 'openai';
import { getEnv } from './env';

// Created lazily: the constructor throws when OPENAI_API_KEY is missing, which
// must not take down every module that merely imports this file.
let client: OpenAI | null = null;

const DEFAULT_MODEL = 'gpt-4o-mini';

export type AiResult =
  | { status: 'success'; data: { response: string }; error?: undefined }
  | { status: 'error'; error: unknown; data: null };

/**
 * Returns a discriminated result so callers can rely on `data.response` being a
 * non-empty string whenever `status === 'success'`. It used to hand back
 * `response.choices[0].message.content`, which is nullable, so an empty
 * completion surfaced as the literal text "null" in Discord.
 */
export async function runAI(prompt: string, system: string): Promise<AiResult> {
  try {
    client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.chat.completions.create({
      model: getEnv('AI_MODEL') || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();

    if (!content) {
      return { status: 'error', error: new Error('Empty completion'), data: null };
    }

    return { status: 'success', data: { response: content } };
  } catch (e) {
    return { status: 'error', error: e, data: null };
  }
}
