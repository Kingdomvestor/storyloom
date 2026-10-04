/**
 * feedback.js — private user feedback, written and read through the server API.
 */
import { admin } from './supabase.js';

export const FEEDBACK_CATEGORIES = ['suggestion', 'bug', 'question', 'other'];
export const FEEDBACK_STATUSES = ['new', 'reviewing', 'planned', 'resolved', 'declined'];
export const FEEDBACK_MESSAGE_LIMIT = 4000;

const FIELDS = 'id, user_id, user_email, category, message, context_page, deck_id, status, created_at, updated_at';

export function validateSubmission(input = {}) {
  const category = String(input.category ?? '');
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  const contextPage = input.context_page == null ? null : String(input.context_page);
  const deckId = input.deck_id == null || input.deck_id === '' ? null : String(input.deck_id);
  const errors = [];

  if (!FEEDBACK_CATEGORIES.includes(category)) errors.push('Choose a valid feedback category.');
  if (!message || message.length > FEEDBACK_MESSAGE_LIMIT) {
    errors.push(`Message must be 1-${FEEDBACK_MESSAGE_LIMIT} characters.`);
  }
  if (contextPage !== null
    && (contextPage.length > 200 || !contextPage.startsWith('/') || contextPage.startsWith('//') || contextPage.includes('\\'))) {
    errors.push('Page context must be a same-site path of at most 200 characters.');
  }
  if (deckId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deckId)) {
    errors.push('Deck context must be a valid deck ID.');
  }

  return {
    valid: errors.length === 0,
    errors,
    value: {
      category,
      message,
      context_page: contextPage,
      deck_id: deckId,
    },
  };
}

export async function create(user, input) {
  const client = admin();
  if (!client) throw new Error('Feedback storage is not configured on this server.');
  const { data, error } = await client.from('feedback')
    .insert({
      user_id: user.id,
      user_email: user.email ?? null,
      ...input,
    })
    .select(FIELDS)
    .single();
  if (error) throw new Error(`feedback.create: ${error.message}`);
  return data;
}

export async function listAdmin() {
  const client = admin();
  if (!client) throw new Error('Feedback storage is not configured on this server.');
  const { data, error } = await client.from('feedback')
    .select(FIELDS)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`feedback.listAdmin: ${error.message}`);
  return data ?? [];
}

export async function updateStatus(id, status) {
  const client = admin();
  if (!client) throw new Error('Feedback storage is not configured on this server.');
  const { data, error } = await client.from('feedback')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(FIELDS)
    .maybeSingle();
  if (error) throw new Error(`feedback.updateStatus: ${error.message}`);
  return data;
}
