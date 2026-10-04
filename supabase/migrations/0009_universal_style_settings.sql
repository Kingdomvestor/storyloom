-- Layout is part of a template's composition, not a reusable style preset.
-- Existing decks keep their copied theme.layout for backwards compatibility.

update public.styles
set settings = case
      when jsonb_typeof(settings) = 'object' then settings - 'layout'
      else settings
    end,
    draft = case
      when jsonb_typeof(draft->'settings') = 'object'
        then jsonb_set(draft, '{settings}', (draft->'settings') - 'layout')
      else draft
    end
where (jsonb_typeof(settings) = 'object' and settings ? 'layout')
   or (jsonb_typeof(draft->'settings') = 'object' and draft->'settings' ? 'layout');
